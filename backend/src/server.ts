import WebSocket from 'ws';
import { createGame, makeBid, playCards, attemptReverse, skipReverse, switchDealerOnTimeout } from './rules/gameEngine';
import { BidOption } from './rules/bidding';
import { GameState, RoundResult } from './rules/scoring';
import { Card } from './models/card';

// ============================================
// 绫诲瀷瀹氫箟
// ============================================

interface PlayerSocket {
  ws: WebSocket | null;
  name: string;
  nickname: string;
  avatar: string;
  playerId: string;   // 客户端生成的稳定标识（UUID），断线重连优先用它匹配
  roomId: string;
  playerIndex: number; // 0-3
  ready: boolean;
  disconnectedAt?: number; // 断线时间戳，undefined=在线
}

interface Room {
  id: string;
  players: PlayerSocket[];
  observers: any[];   // 站起后仍在房间旁观的客户端（不入座、不参与发牌）
  inGame: boolean;    // 是否正在进行一局（对局中禁止坐下/站起，避免座位与手牌错位）
  session: any; // GameSession
  gameState: string;
  lastStartAt?: number; // 上次开局时间，用于防止 4 个客户端兜底请求导致重复发牌
}

type ClientMessage = {
  type: string;
  [key: string]: any;
};

// ============================================
// 鐘舵€佺鐞?
// ============================================

const rooms = new Map<string, Room>();
const playerRooms = new Map<WebSocket, PlayerSocket>();

let nextRoomId = 1;

// 离线玩家保留 5 分钟，之后才真正清出房间
const DISCONNECT_GRACE_MS = 5 * 60 * 1000;

function generateRoomId(): string {
  return String(nextRoomId++).padStart(4, '0');
}

// ============================================
// 鎴块棿绠＄悊
// ============================================

function createRoom(hostName: string, nickname: string, avatar: string, ws: WebSocket, playerId: string = ''): Room | null {
  // 防止同一连接重复创建/拥有多个房间：若已在房间，直接拒绝
  if (playerRooms.has(ws)) {
    const existing = playerRooms.get(ws)!;
    sendToWs(ws, { type: 'error', message: '你已经在房间 ' + existing.roomId + ' 中，无法创建新房间' });
    console.log('[Server] Duplicate createRoom attempt by ' + existing.name + ' (already in room ' + existing.roomId + ')');
    return null;
  }
  const roomId = generateRoomId();
  const session = createGame({ numDecks: 2 });
  
  const room: Room = {
    id: roomId,
    players: [],
    observers: [],
    inGame: false,
    session,
    gameState: session.state,
  };

  room.players.push({
    ws,
    name: hostName || '玩家1',
    nickname: nickname || '',
    avatar: avatar || '',
    playerId: playerId || '',
    roomId,
    playerIndex: 0,
    ready: false,
  });

  rooms.set(roomId, room);
  playerRooms.set(ws, room.players[0]);

  // 单发：告知该客户端自己的座位号 + 权威 playerId
  sendToWs(ws, { type: 'joined', roomId, playerIndex: 0, playerId: playerId || '' });
  broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
  // 通知所有大厅客户端：出现了一个新房间
  broadcastRoomList();

  console.log('[Server] Room ' + roomId + ' created by ' + room.players[0].name);
  return room;
}

function joinRoom(roomId: string, msg: any, ws: WebSocket): Room | null {
  const room = rooms.get(roomId);
  if (!room) {
    sendToWs(ws, { type: 'error', message: '房间不存在' });
    return null;
  }

  // 防止同一个 WebSocket 连接重复加入房间
  const existingPlayer = playerRooms.get(ws);
  if (existingPlayer && existingPlayer.roomId === roomId) {
    sendToWs(ws, { type: 'error', message: '你已在房间 ' + roomId + ' 中' });
    console.log('[Server] Duplicate join attempt by ' + existingPlayer.name + ' in room ' + roomId);
    return null;
  }

  const playerName = msg.name || ('玩家' + (room.players.length + 1));
  const playerId = msg.playerId || '';

  // ====== 断线重连 / 重复进入：恢复原座位与准备状态 ======
  // 优先用 playerId 匹配（最可靠，跨越在线/离线两种状态），
  // 退而求其次用 房间+昵称 匹配。无论旧连接是"已离线"还是"仍是鬼魂(Alive但未心跳)"，
  // 都直接替换其 socket，从而支持"刚退出又立刻回来"的即时重连。
  // ★ 关键：只有当旧座位「已离线 / 连接已死 / 就是当前这条连接」时才允许接管。
  // 微信开发者工具多开（或同一台电脑多个调试窗口）时，多个客户端会共享同一份 storage，
  // 从而带同一个 playerId。若不加这个判断，后加入的人会把先加入的人直接顶掉，
  // 房间永远只剩 1 人 —— 表现就是「四人同不了桌、四人都准备了也不开局」。
  let rejoinMatch = -1;
  if (playerId) {
    rejoinMatch = room.players.findIndex(p =>
      p.playerId === playerId && p.roomId === roomId &&
      (p.disconnectedAt !== undefined || !p.ws || p.ws === ws || p.ws.readyState !== WebSocket.OPEN)
    );
  }
  if (rejoinMatch < 0) {
    // 同名重连仅在该玩家"当前离线"时成立，避免把同名在线玩家误判为重连而踢掉
    // （默认昵称都是"玩家"，不及时加 disconnectedAt 判断会互相顶替座位）
    rejoinMatch = room.players.findIndex(p => p.name === playerName && p.roomId === roomId && p.disconnectedAt !== undefined);
  }
  // 若该 playerId 已被房内另一个「在线」客户端占用，给新客户端分配房间内唯一 ID，
  // 并通过 joined 消息回写，客户端会覆盖本地 storage，之后重连就不会再撞车。
  let effectivePlayerId = playerId;
  if (playerId && rejoinMatch < 0 &&
      room.players.some(p => p.playerId === playerId && p.roomId === roomId && p.ws !== ws && p.disconnectedAt === undefined)) {
    effectivePlayerId = playerId + '_' + roomId + '_' + (room.players.length + 1);
    console.log('[Server] playerId 冲突，为 ' + playerName + ' 分配新 ID: ' + effectivePlayerId);
  }

  if (rejoinMatch >= 0) {
    const old = room.players[rejoinMatch];
    console.log('[Server] ' + playerName + ' 重连恢复房间 ' + roomId + ' 座位 ' + (old.playerIndex + 1) + ' (ready=' + old.ready + ', 之前离线=' + (old.disconnectedAt !== undefined) + ')');
    // 替换 socket（关掉旧鬼魂连接，避免双连接）
    if (old.ws && old.ws !== ws) {
      // 先解除旧 ws 与玩家的绑定，否则旧连接稍后 close 时会误把已重连的玩家标记离线
      playerRooms.delete(old.ws);
      try { old.ws.close(); } catch (e) {}
    }
    old.ws = ws;
    old.disconnectedAt = undefined;
    old.nickname = msg.nickname || old.nickname;
    old.avatar = msg.avatar || old.avatar;
    old.name = playerName || old.name;
    old.playerId = playerId || old.playerId;
    playerRooms.set(ws, old);
    sendToWs(ws, { type: 'joined', roomId, playerIndex: old.playerIndex, playerId: old.playerId });
    broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
    // 如果对局已经在进行，把当前 session 也推给重连者，让其恢复手牌/状态
    if (room.session) {
      sendToWs(ws, { type: 'gameReconnect', session: serializeSession(room.session) });
    }
    return room;
  }

  // 如果这个 ws 之前在其他房间，先清理
  if (existingPlayer) {
    const oldRoom = rooms.get(existingPlayer.roomId);
    if (oldRoom) {
      oldRoom.players = oldRoom.players.filter(p => p.ws !== ws && p !== existingPlayer);
      // 重新编号
      oldRoom.players.forEach((p, i) => { p.playerIndex = i; });
      broadcastRoom(oldRoom, { type: 'roomUpdate', room: getRoomInfo(oldRoom), players: getRoomInfo(oldRoom).players });
      broadcastRoomList();
      console.log('[Server] Removed player ' + existingPlayer.name + ' from old room ' + existingPlayer.roomId);
    }
  }

  if (room.players.length >= 4) {
    sendToWs(ws, { type: 'error', message: '房间已满' });
    return null;
  }

  const playerIndex = room.players.length;
  const player: PlayerSocket = {
    ws,
    name: playerName,
    nickname: msg.nickname || '',
    avatar: msg.avatar || '',
    playerId: effectivePlayerId || '',
    roomId,
    playerIndex,
    ready: false,
  };
  room.players.push(player);
  playerRooms.set(ws, player);
  console.log('[Server] ' + player.name + ' joined room ' + roomId + ' as player ' + (playerIndex + 1));
  // 单发：告知该客户端自己的座位号 + 权威 playerId
  sendToWs(ws, { type: 'joined', roomId, playerIndex, playerId: effectivePlayerId || '' });
  broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
  // 通知所有大厅客户端：该房间人数 +1
  broadcastRoomList();
  return room;
}

// 显式退出房间（用户点"退出房间"）：立即从房间移除并重新编号，
// 让出座位，其他玩家可立即加入或开始。
function leaveRoom(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) {
    // 旁观者点「退出房间」：从旁观列表移除即可
    removeObserver(ws);
    return;
  }

  const room = rooms.get(player.roomId);
  playerRooms.delete(ws);
  if (!room) return;

  const before = room.players.length;
  room.players = room.players.filter(p => p.ws !== ws && p !== player);
  room.observers = room.observers.filter(o => o.ws !== ws);
  room.players.forEach((p, i) => { p.playerIndex = i; });

  console.log('[Server] ' + player.name + ' 主动退出房间 ' + room.id);

  if (room.players.length === 0 && room.observers.length === 0) {
    rooms.delete(room.id);
    console.log('[Server] Room ' + room.id + ' deleted (empty after leave)');
    // 通知大厅：该房间已消失
    broadcastRoomList();
    return;
  }

  // 通知剩余玩家重新编号 + 广播最新状态
  room.players.forEach(p => {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) {
      sendToWs(p.ws, { type: 'joined', roomId: room.id, playerIndex: p.playerIndex });
    }
  });
  broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
  // 通知大厅：该房间人数 -1
  broadcastRoomList();
  void before;
}

// ============================================
// 坐下 / 站起 / 旁观（房间座位管理）
// 站起的玩家保留在房间里成为「旁观者」：不入座、不参与发牌，界面继续可见；
// 再点「坐下」即可重新占座。对局进行中禁止换座，避免座位号与手牌错位。
// ============================================

function findObserverRoom(ws: WebSocket): Room | null {
  for (const room of rooms.values()) {
    if (room.observers.some(o => o.ws === ws)) return room;
  }
  return null;
}

function removeObserver(ws: WebSocket): void {
  for (const room of rooms.values()) {
    const before = room.observers.length;
    room.observers = room.observers.filter(o => o.ws !== ws);
    if (room.observers.length === before) continue;
    if (room.players.length === 0 && room.observers.length === 0) {
      rooms.delete(room.id);
      broadcastRoomList();
      continue;
    }
    broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
    broadcastRoomList();
  }
}

function handleStandUp(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) {
    sendToWs(ws, { type: 'error', message: '你当前没有入座' });
    return;
  }
  const room = rooms.get(player.roomId);
  if (!room) return;
  if (room.inGame) {
    sendToWs(ws, { type: 'error', message: '本局进行中，暂不能站起（可点「回大厅」结束本局）' });
    return;
  }

  playerRooms.delete(ws);
  room.players = room.players.filter(p => p !== player);
  room.players.forEach((p, i) => { p.playerIndex = i; });
  room.observers = room.observers.filter(o => o.ws !== ws);
  room.observers.push({
    ws, name: player.name, nickname: player.nickname, avatar: player.avatar,
    playerId: player.playerId, roomId: room.id,
  });

  // 单发给站起者：切换成旁观态
  sendToWs(ws, { type: 'seatState', seated: false, roomId: room.id, playerIndex: -1, reason: 'standUp' });
  // 其余玩家座位可能重编号，下发权威座位号
  room.players.forEach(p => sendToWs(p.ws, {
    type: 'joined', roomId: room.id, playerIndex: p.playerIndex, playerId: p.playerId,
  }));
  broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
  broadcastRoom(room, { type: 'playerStoodUp', playerName: player.name });
  broadcastRoomList();
  console.log('[Server] ' + player.name + ' 站起，房间 ' + room.id + ' 座位 ' + room.players.length + '/4，旁观 ' + room.observers.length + ' 人');
}

function handleSitDown(ws: WebSocket, msg: any): void {
  const already = playerRooms.get(ws);
  if (already) {
    sendToWs(ws, { type: 'joined', roomId: already.roomId, playerIndex: already.playerIndex, playerId: already.playerId });
    return;
  }
  const obsRoom = findObserverRoom(ws);
  const roomId = msg.roomId || (obsRoom ? obsRoom.id : '');
  const room = rooms.get(roomId);
  if (!room) {
    sendToWs(ws, { type: 'error', message: '房间不存在，请返回大厅重新加入' });
    return;
  }
  if (room.inGame) {
    sendToWs(ws, { type: 'error', message: '本局进行中，请等回大厅后再坐下' });
    return;
  }
  if (room.players.length >= 4) {
    sendToWs(ws, { type: 'error', message: '四个座位已满，请先旁观等待空位' });
    return;
  }

  const obs = obsRoom && obsRoom.id === room.id ? obsRoom.observers.find(o => o.ws === ws) : null;
  if (obsRoom) {
    obsRoom.observers = obsRoom.observers.filter(o => o.ws !== ws);
  }
  const profile: any = obs || msg;
  const playerIndex = room.players.length;
  const player: PlayerSocket = {
    ws,
    name: msg.name || profile.name || ('玩家' + (playerIndex + 1)),
    nickname: msg.nickname || profile.nickname || '',
    avatar: msg.avatar || profile.avatar || '',
    playerId: msg.playerId || profile.playerId || '',
    roomId,
    playerIndex,
    ready: false,
  };
  room.players.push(player);
  playerRooms.set(ws, player);

  // joined 是前端切换回「已入座」的权威信号
  sendToWs(ws, { type: 'joined', roomId, playerIndex, playerId: player.playerId });
  broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
  broadcastRoom(room, { type: 'playerSatDown', playerName: player.name });
  broadcastRoomList();
  console.log('[Server] ' + player.name + ' 坐下，房间 ' + roomId + ' 座位 ' + (playerIndex + 1) + '/4');
}

// 断线重连时，若本地处于旁观态，用 observeRoom 恢复旁观而不是自动占座
function handleObserveRoom(ws: WebSocket, msg: any): void {
  if (playerRooms.has(ws)) return;
  const room = rooms.get(msg.roomId || '');
  if (!room) return;
  room.observers = room.observers.filter(o => o.ws !== ws);
  room.observers.push({
    ws, name: msg.name || '旁观者', nickname: msg.nickname || '',
    avatar: msg.avatar || '', playerId: msg.playerId || '', roomId: room.id,
  });
  sendToWs(ws, { type: 'seatState', seated: false, roomId: room.id, playerIndex: -1, reason: 'reconnect' });
  broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
}

// 「回大厅」：结束当前对局、清空准备状态，让所有人可以重新坐下/站起/准备下一局
function handleBackToLobby(ws: WebSocket): void {
  const p = playerRooms.get(ws) || null;
  const room = p ? rooms.get(p.roomId) : findObserverRoom(ws);
  if (!room) return;
  room.inGame = false;
  room.lastStartAt = undefined;
  room.session = createGame({ numDecks: 2 });
  room.gameState = room.session.state;
  room.players.forEach(x => { x.ready = false; });
  broadcastRoom(room, { type: 'roomLobby', room: getRoomInfo(room), players: getRoomInfo(room).players });
  broadcastRoomList();
  console.log('[Server] 房间 ' + room.id + ' 回到等待大厅');
}

// 断线（socket 意外关闭）：保留座位一段时间(grace)，以便重连恢复；
// 期间其他玩家看到该玩家"离线"。心跳会先把真正的死连接 terminate 成 close，
// 再由本函数处理，所以不会出现"鬼魂占位"。
function markDisconnected(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) {
    // 旁观者断线：只从旁观列表移除，不影响座位
    removeObserver(ws);
    return;
  }

  const room = rooms.get(player.roomId);
  if (!room) {
    playerRooms.delete(ws);
    return;
  }

  player.disconnectedAt = Date.now();
  player.ws = null;
  playerRooms.delete(ws);

  console.log('[Server] ' + player.name + ' disconnected from room ' + room.id + ' (seat ' + (player.playerIndex + 1) + ' 保留 ' + Math.round(DISCONNECT_GRACE_MS / 1000) + ' 秒)');

  // 广播最新的房间状态（其他玩家能看到该玩家"离线"标记）
  broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
  broadcastRoom(room, { type: 'playerOffline', playerIndex: player.playerIndex, playerName: player.name });
  // 大厅房间人数不变，但保持列表一致（含离线占位），顺手刷新
  broadcastRoomList();
}

// 定期清理：超过宽限期的离线玩家才真正从房间移除
function cleanupDisconnectedPlayers() {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    const before = room.players.length;
    // 保留在线的 + 未到期的离线玩家
    room.players = room.players.filter(p => {
      if (p.disconnectedAt === undefined) return true;
      if (now - p.disconnectedAt < DISCONNECT_GRACE_MS) return true;
      console.log('[Server] Cleaning up expired disconnected player ' + p.name + ' from room ' + roomId);
      return false;
    });
    // 如果有玩家被清掉，重新编号
    if (room.players.length !== before) {
      room.players.forEach((p, i) => { p.playerIndex = i; });
      if (room.players.length === 0 && room.observers.length === 0) {
        rooms.delete(roomId);
        console.log('[Server] Room ' + roomId + ' deleted (empty after cleanup)');
      } else {
        // 通知剩余玩家
        room.players.forEach(p => {
          if (p.ws && p.ws.readyState === WebSocket.OPEN) {
            sendToWs(p.ws, { type: 'joined', roomId: room.id, playerIndex: p.playerIndex });
          }
        });
        broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
        // 有玩家被清理出房间，大厅列表需同步（人数减少）
        broadcastRoomList();
      }
    }
  }
}

function startGame(room: Room): void {
  // 服务端 4 人全准备会自动开局，客户端还有一层兜底 startGame。
  // 两者可能在几百毫秒内同时到达，必须去重，否则会连续洗两次牌、
  // 客户端收到两个 gameStart，发牌动画被重置，看起来就是「进不去打牌」。
  const now = Date.now();
  if (room.lastStartAt && now - room.lastStartAt < 3000) {
    console.log('[Server] 忽略 3s 内重复开局请求，房间 ' + room.id);
    return;
  }
  room.lastStartAt = now;
  room.inGame = true;
  room.session = createGame({ numDecks: 2 });
  room.gameState = room.session.state;
  
  // 閲嶇疆鎵€鏈夌帺瀹跺噯澶囩姸鎬?
  room.players.forEach(p => p.ready = false);

  console.log('[Server] Game started in room ' + room.id);

  broadcastRoom(room, {
    type: 'gameStart',
    session: serializeSession(room.session),
    room: getRoomInfo(room),
  });
}

// ============================================
// 娓告垙鎿嶄綔澶勭悊
// ============================================

function handleReady(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) {
    sendToWs(ws, { type: 'error', message: '请先坐下再准备' });
    return;
  }

  const room = rooms.get(player.roomId);
  if (!room) return;
  if (room.inGame) {
    sendToWs(ws, { type: 'error', message: '本局已开始，无需再准备' });
    return;
  }

  // 切换准备状态（仅在线玩家能切换自己的）
  room.players[player.playerIndex].ready = !room.players[player.playerIndex].ready;

  const onlinePlayers = room.players.filter(p => p.disconnectedAt === undefined);
  const allOnlineReady = onlinePlayers.length > 0 && onlinePlayers.every(p => p.ready);
  const canStart = allOnlineReady && onlinePlayers.length === 4;
  const allReady = room.players.every(p => p.ready);

  broadcastRoom(room, {
    type: 'playerReady',
    playerIndex: player.playerIndex,
    playerName: player.name,
    allReady,
    canStart,
    players: getRoomInfo(room).players,
  });

  // 全部 4 名在线玩家都准备好后自动开始（有人离线则不开始，等其重连）
  if (canStart) {
    console.log('[Server] All players ready in room ' + room.id + ', starting game...');
    startGame(room);
  } else {
    console.log('[Server] 房间 ' + room.id + ' 暂不开局：在线 ' + onlinePlayers.length + '/4，在线全员已准备=' + allOnlineReady +
      '（离线玩家会保留座位 5 分钟，需等其重连）');
  }
}

function handleStartGame(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) return;
  const room = rooms.get(player.roomId);
  if (!room) return;
  // 服务端刚刚自动开局，客户端的兜底 startGame 晚到了：静默忽略。
  // 否则 startGame 已把 ready 重置，这里会误报「需 4 名在线玩家全部准备」的 toast。
  if (room.lastStartAt && Date.now() - room.lastStartAt < 5000) {
    console.log('[Server] 忽略兜底 startGame（对局已开始），房间 ' + room.id);
    return;
  }
  const onlinePlayers = room.players.filter(p => p.disconnectedAt === undefined);
  const allOnlineReady = onlinePlayers.length > 0 && onlinePlayers.every(p => p.ready);
  if (!allOnlineReady || onlinePlayers.length !== 4) {
    sendToWs(ws, { type: 'error', message: '需 4 名在线玩家全部准备才能开始' });
    return;
  }
  startGame(room);
}

function handleUpdateProfile(ws: WebSocket, nickname?: string, avatar?: string): void {
  const player = playerRooms.get(ws);
  if (!player) return;
  const room = rooms.get(player.roomId);
  if (!room) return;
  if (typeof nickname === 'string') player.nickname = nickname;
  if (typeof avatar === 'string' && avatar) player.avatar = avatar;
  broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
}

function handleDealCards(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) return;

  const room = rooms.get(player.roomId);
  if (!room) return;

  broadcastRoom(room, {
    type: 'cardsDealt',
    session: serializeSession(room.session),
  });
}

function handleBid(ws: WebSocket, bid: string, suit?: string): void {
  const player = playerRooms.get(ws);
  if (!player) return;

  const room = rooms.get(player.roomId);
  if (!room) return;

  const bidOption = mapBidString(bid);
  const suitEnum = mapSuitString(suit);
  const result = makeBid(room.session, player.playerIndex, bidOption, suitEnum);
  if (!result.success) {
    sendToWs(ws, { type: 'error', message: result.error });
    return;
  }

  broadcastRoom(room, {
    type: 'bidResult',
    success: true,
    session: serializeSession(room.session),
  });
}

function handleReverse(ws: WebSocket, option: any): void {
  const player = playerRooms.get(ws);
  if (!player) return;

  const room = rooms.get(player.roomId);
  if (!room) return;

  const result = attemptReverse(room.session, player.playerIndex, option);
  if (!result.success) {
    sendToWs(ws, { type: 'error', message: result.error });
    return;
  }

  broadcastRoom(room, {
    type: 'reverseResult',
    success: true,
    session: serializeSession(room.session),
  });
}

function handleSkipReverse(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) return;

  const room = rooms.get(player.roomId);
  if (!room) return;

  const result = skipReverse(room.session, player.playerIndex);
  if (!result.success) {
    sendToWs(ws, { type: 'error', message: result.error });
    return;
  }

  broadcastRoom(room, {
    type: 'reverseResult',
    success: true,
    session: serializeSession(room.session),
  });
}

// 后续局：庄家队 10 秒叫不起牌，换成另一队上庄（客户端倒计时到期触发）
function handleSwitchDealer(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) return;
  const room = rooms.get(player.roomId);
  if (!room) return;
  // 必须是庄家队的人触发（庄家或对家），闲家队无权换庄
  const dealer = room.session?.finalBidderIndex;
  if (dealer < 0 || (player.playerIndex !== dealer && player.playerIndex !== (dealer + 2) % 4)) {
    sendToWs(ws, { type: 'error', message: '只有庄家队可申请换庄' });
    return;
  }
  const result = switchDealerOnTimeout(room.session);
  if (!result.success) {
    sendToWs(ws, { type: 'error', message: result.error });
    return;
  }
  broadcastRoom(room, {
    type: 'dealerSwitched',
    session: serializeSession(room.session),
  });
}

function handleRoundEnd(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) return;

  const room = rooms.get(player.roomId);
  if (!room) return;

  room.inGame = false;   // 结算完成，允许下一局重新坐下/站起
  broadcastRoom(room, {
    type: 'roundEnd',
    session: serializeSession(room.session),
  });
}

function handlePlayCards(ws: WebSocket, cards: any[]): void {
  const player = playerRooms.get(ws);
  if (!player) return;

  const room = rooms.get(player.roomId);
  if (!room) return;

  if (!Array.isArray(cards) || cards.length === 0) {
    sendToWs(ws, { type: 'error', message: '出牌数据无效' });
    return;
  }

  // 客户端传来的是纯 JSON {suit,value}，必须从玩家真实手牌中匹配出 Card 实例
  // （既保证 Card 方法可用，也防止伪造手里没有的牌）
  const enginePlayer = room.session?.players?.[player.playerIndex];
  if (!enginePlayer) {
    sendToWs(ws, { type: 'error', message: '游戏尚未开始' });
    return;
  }
  const used = new Set<number>();
  const realCards: Card[] = [];
  for (const c of cards) {
    const idx = enginePlayer.hand.findIndex((h: Card, i: number) =>
      !used.has(i) && h.suit === c.suit && h.value === c.value);
    if (idx === -1) {
      sendToWs(ws, { type: 'error', message: '出的牌不在手牌中' });
      return;
    }
    used.add(idx);
    realCards.push(enginePlayer.hand[idx]);
  }

  const result = playCards(room.session, player.playerIndex, realCards);
  if (!result.success) {
    sendToWs(ws, { type: 'error', message: result.error });
    return;
  }

  broadcastRoom(room, {
    type: 'playResult',
    success: true,
    session: serializeSession(room.session),
  });
}

// ============================================
// 娑堟伅澶勭悊
// ============================================

function handleMessage(ws: WebSocket, data: string): void {
  try {
    const msg: ClientMessage = JSON.parse(data);
    
    switch (msg.type) {
      case 'createRoom':
        createRoom(msg.name || '玩家1', msg.nickname || '', msg.avatar || '', ws, msg.playerId || '');
        break;
        
      case 'joinRoom':
        joinRoom(msg.roomId, msg, ws);
        break;
        
      case 'leaveRoom':
        leaveRoom(ws);
        break;

      case 'sitDown':
        handleSitDown(ws, msg);
        break;

      case 'standUp':
        handleStandUp(ws);
        break;

      case 'observeRoom':
        handleObserveRoom(ws, msg);
        break;

      case 'backToLobby':
        handleBackToLobby(ws);
        break;

      case 'ready':
        handleReady(ws);
        break;
        
      case 'startGame':
        handleStartGame(ws);
        break;

      case 'updateProfile':
        handleUpdateProfile(ws, msg.nickname, msg.avatar);
        break;

      case 'dealCards':
        handleDealCards(ws);
        break;
        
      case 'bid':
        handleBid(ws, msg.bid, msg.suit);
        break;
        
      case 'playCards':
        handlePlayCards(ws, msg.cards);
        break;

      case 'skipReverse':
        handleSkipReverse(ws);
        break;
      case 'reverse':
        handleReverse(ws, msg.option);
        break;
      case 'switchDealer':
        handleSwitchDealer(ws);
        break;

      case 'roundEnd':
        handleRoundEnd(ws);
        break;
        
      case 'getRooms':
        console.log('[Server] getRooms called, total rooms:', rooms.size);
        rooms.forEach((room, id) => {
          console.log('[Server]   Room', id, '- players:', room.players.length);
        });
        const roomList: any[] = [];
        rooms.forEach((room) => {
          roomList.push({
            id: room.id,
            playerCount: room.players.length,
            maxPlayers: 4,
            gameState: room.session?.state || 'waiting',
          });
        });
        sendToWs(ws, { type: 'roomList', rooms: roomList });
        break;
      default:
        console.warn('[Server] Unknown message type:', msg.type);
    }
  } catch (e) {
    console.error('[Server] Failed to parse message:', e);
  }
}

// ============================================
// 杈呭姪鍑芥暟
// ============================================

function mapBidString(bid: string): BidOption {
  switch (bid) {
    case 'pass': return BidOption.PASS;
    case '0': return BidOption.ZERO;
    case '1': return BidOption.ONE;
    case '2': return BidOption.TWO;
    case '3': return BidOption.THREE;
    default: return BidOption.PASS;
  }
}

function mapSuitString(suit?: string): any {
  if (!suit) return undefined;
  const suitMap: Record<string, string> = {
    'spade': 'spade',
    'heart': 'heart',
    'club': 'club',
    'diamond': 'diamond',
    'none': 'none',
  };
  return suitMap[suit] || undefined;
}

// ============================================
// 骞挎挱涓庡彂閫?
// ============================================

function sendToWs(ws: WebSocket | null, data: any): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastRoom(room: Room, data: any): void {
  const serialized = JSON.stringify(data);
  // 座位上的玩家 + 已站起的旁观者都能收到房间状态
  for (const p of room.players.concat(room.observers as PlayerSocket[])) {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(serialized);
    }
  }
}

// 向所有已连接客户端广播最新的"大厅房间列表"。
// 这样任何人创建/加入/退出房间时，其他停留在大厅的玩家能实时看到，
// 不再需要等自己主动 getRooms。
function broadcastRoomList(): void {
  const roomList: any[] = [];
  rooms.forEach((room) => {
    roomList.push({
      id: room.id,
      playerCount: room.players.length,
      maxPlayers: 4,
      gameState: room.session?.state || 'waiting',
    });
  });
  const payload = JSON.stringify({ type: 'roomList', rooms: roomList });
  wss.clients.forEach((ws: WebSocket) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

// ============================================
// 搴忓垪鍖?
// ============================================

function serializeSession(session: any): any {
  if (!session) return null;
  
  return {
    id: session.id,
    state: session.state,
    players: session.players.map((p: any, i: number) => ({
      index: i,
      name: p.name,
      hand: p.hand.map((c: any) => ({
        suit: c.suit,
        value: c.value,
        display: c.toString(),
      })),
      isSelf: false,
    })),
    trumpSuit: session.trumpSuit,
    level: session.level,
    dealerIndex: session.dealerIndex,
    firstBidderIndex: session.firstBidderIndex,
    currentBidderIndex: session.currentBidderIndex,
    currentTrickWinner: session.currentTrickWinner,
    bidScore: session.bidScore,
    finalBidderIndex: session.finalBidderIndex,
    finalSuit: session.finalSuit,
    dealerLocked: !!session.dealerLocked,
    currentTrick: session.currentTrick,
    tricks: session.tricks,
    teamLevels: [session.teamLevels.get(0) ?? 0, session.teamLevels.get(1) ?? 0],
    // 把叫分历史推给前端，让叫分阶段也能看到当前已叫的花色
    bidHistory: session.bidState ? session.bidState.bidHistory.map((b: any) => ({
      player: b.player,
      bid: b.bid,
      suit: b.suit || null
    })) : [],
    log: session.log.slice(-20),
  };
}

function getRoomInfo(room: Room): any {
  return {
    id: room.id,
    playerCount: room.players.length,
    observerCount: room.observers.length,
    inGame: room.inGame,
    maxPlayers: 4,
    gameState: room.inGame ? (room.session?.state || 'playing') : 'waiting',
    players: room.players.map(p => ({
      name: p.name,
      nickname: p.nickname,
      avatar: p.avatar,
      playerIndex: p.playerIndex,
      ready: p.ready,
      online: p.disconnectedAt === undefined,
    })),
  };
}

// ============================================
// WebSocket 鏈嶅姟鍣ㄥ惎鍔?
// ============================================

// HTTP server that also serves WebSocket
const httpServer = require('http').createServer();

// HTTP Health Check
httpServer.on('request', (req: any, res: any) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
  }
});

// WebSocket server attached to HTTP server
const PORT = parseInt(process.env.PORT || '8888', 10);
const wss = new WebSocket.Server({ server: httpServer });
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('[Server] HTTP + WebSocket server started on port ' + PORT);
});

console.log('[Server] WebSocket server started on ws://localhost:8888');

wss.on('connection', (ws: WebSocket) => {
  console.log('[Server] New connection');
  (ws as any).isAlive = true;
  ws.on('pong', () => { (ws as any).isAlive = true; });

  ws.on('message', (data: Buffer) => {
    handleMessage(ws, data.toString());
  });

  ws.on('close', () => {
    console.log('[Server] Connection closed');
    markDisconnected(ws);
  });

  ws.on('error', (err: Error) => {
    console.error('[Server] WebSocket error:', err.message);
    markDisconnected(ws);
  });
});

// 心跳：每 30 秒向所有连接发 ping，未回应(pong)的判定为死连接并 terminate，
// terminate 会触发 close → markDisconnected，从而及时腾出"鬼魂"占用的座位。
const HEARTBEAT_MS = 30 * 1000;
setInterval(() => {
  const dead: WebSocket[] = [];
  wss.clients.forEach((ws: WebSocket) => {
    if ((ws as any).isAlive === false) {
      dead.push(ws);
      return;
    }
    (ws as any).isAlive = false;
    try { (ws as any).ping(); } catch (e) { /* ignore */ }
  });
  dead.forEach((ws) => {
    try { ws.terminate(); } catch (e) { /* ignore */ }
  });
  if (dead.length > 0) {
    console.log('[Server] Heartbeat terminated ' + dead.length + ' dead connection(s)');
  }
}, HEARTBEAT_MS).unref();

// 定期清理超过宽限期的离线玩家（每 30 秒检查一次）
setInterval(cleanupDisconnectedPlayers, 30 * 1000).unref();

// 浼橀泤閫€鍑?
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  wss.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] Shutting down...');
  wss.close();
  process.exit(0);
});

