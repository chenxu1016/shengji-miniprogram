import WebSocket from 'ws';
import { createGame, makeBid, playCards, attemptReverse } from './rules/gameEngine';
import { BidOption } from './rules/bidding';
import { GameState, RoundResult } from './rules/scoring';

// ============================================
// 绫诲瀷瀹氫箟
// ============================================

interface PlayerSocket {
  ws: WebSocket;
  name: string;
  nickname: string;
  avatar: string;
  roomId: string;
  playerIndex: number; // 0-3
  ready: boolean;
}

interface Room {
  id: string;
  players: PlayerSocket[];
  session: any; // GameSession
  gameState: string;
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

function generateRoomId(): string {
  return String(nextRoomId++).padStart(4, '0');
}

// ============================================
// 鎴块棿绠＄悊
// ============================================

function createRoom(hostName: string, nickname: string, avatar: string, ws: WebSocket): Room | null {
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
    session,
    gameState: session.state,
  };

  room.players.push({
    ws,
    name: hostName || '玩家1',
    nickname: nickname || '',
    avatar: avatar || '',
    roomId,
    playerIndex: 0,
    ready: false,
  });

  rooms.set(roomId, room);
  playerRooms.set(ws, room.players[0]);

  // 单发：告知该客户端自己的座位号（避免前端靠昵称猜测自己是谁）
  sendToWs(ws, { type: 'joined', roomId, playerIndex: 0 });
  broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });

  console.log('[Server] Room ' + roomId + ' created by ' + room.players[0].name);
  return room;
}

function joinRoom(roomId: string, msg: any, ws: WebSocket): Room | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.players.length >= 4) {
    sendToWs(ws, { type: 'error', message: '房间已满' });
    return null;
  }
  // 防止同一个 WebSocket 连接重复加入房间
  const existingPlayer = playerRooms.get(ws);
  if (existingPlayer && existingPlayer.roomId === roomId) {
    sendToWs(ws, { type: 'error', message: '你已在房间 ' + roomId + ' 中' });
    console.log('[Server] Duplicate join attempt by ' + existingPlayer.name + ' in room ' + roomId);
    return null;
  }
  // 如果这个 ws 之前在其他房间，先清理
  if (existingPlayer) {
    const oldRoom = rooms.get(existingPlayer.roomId);
    if (oldRoom) {
      oldRoom.players = oldRoom.players.filter(p => p.ws !== ws);
      // 重新编号
      broadcastRoom(oldRoom, { type: 'roomUpdate', room: getRoomInfo(oldRoom), players: getRoomInfo(oldRoom).players });
      console.log('[Server] Removed player ' + existingPlayer.name + ' from old room ' + existingPlayer.roomId);
    }
  }
  const playerIndex = room.players.length;
  const playerName = msg.name || ('玩家' + (playerIndex + 1));
  const player: PlayerSocket = {
    ws,
    name: playerName,
    nickname: msg.nickname || '',
    avatar: msg.avatar || '',
    roomId,
    playerIndex,
    ready: false,
  };
  room.players.push(player);
  playerRooms.set(ws, player);
  console.log('[Server] ' + player.name + ' joined room ' + roomId + ' as player ' + (playerIndex + 1));
  // 单发：告知该客户端自己的座位号
  sendToWs(ws, { type: 'joined', roomId, playerIndex });
  broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
  return room;
}

function leaveRoom(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) return;

  const room = rooms.get(player.roomId);
  if (!room) return;

  room.players = room.players.filter(p => p.ws !== ws);
  playerRooms.delete(ws);

  console.log('[Server] ' + player.name + ' left room ' + room.id);

  if (room.players.length === 0) {
    rooms.delete(room.id);
    console.log('[Server] Room ' + room.id + ' deleted');
  } else {
    room.players.forEach((p, i) => {
      p.playerIndex = i;
      // 重新编号后单发通知每个玩家自己的新座位号
      sendToWs(p.ws, { type: 'joined', roomId: room.id, playerIndex: i });
    });
      broadcastRoom(room, { type: 'roomUpdate', room: getRoomInfo(room), players: getRoomInfo(room).players });
  }
}

function startGame(room: Room): void {
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
  if (!player) return;

  const room = rooms.get(player.roomId);
  if (!room) return;

  // 鍒囨崲鍑嗗鐘舵€?
  room.players[player.playerIndex].ready = !room.players[player.playerIndex].ready;

  const allReady = room.players.every(p => p.ready);

  broadcastRoom(room, {
    type: 'playerReady',
    playerIndex: player.playerIndex,
    playerName: player.name,
    allReady,
    players: getRoomInfo(room).players,
  });

  // 鎵€鏈変汉閮藉噯澶囧ソ鍚庤嚜鍔ㄥ紑濮?
  if (allReady && room.players.length === 4) {
    console.log('[Server] All players ready in room ' + room.id + ', starting game...');
    startGame(room);
  }
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

function handleRoundEnd(ws: WebSocket): void {
  const player = playerRooms.get(ws);
  if (!player) return;

  const room = rooms.get(player.roomId);
  if (!room) return;

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

  const result = playCards(room.session, player.playerIndex, cards);
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
        createRoom(msg.name || '玩家1', msg.nickname || '', msg.avatar || '', ws);
        break;
        
      case 'joinRoom':
        joinRoom(msg.roomId, msg, ws);
        break;
        
      case 'leaveRoom':
        leaveRoom(ws);
        break;
        
      case 'ready':
        handleReady(ws);
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

      case 'reverse':
        handleReverse(ws, msg.option);
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

function sendToWs(ws: WebSocket, data: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastRoom(room: Room, data: any): void {
  const serialized = JSON.stringify(data);
  for (const player of room.players) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(serialized);
    }
  }
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
    currentBidderIndex: session.currentBidderIndex,
    bidScore: session.bidScore,
    finalBidderIndex: session.finalBidderIndex,
    finalSuit: session.finalSuit,
    currentTrick: session.currentTrick,
    tricks: session.tricks,
    teamLevels: [session.teamLevels.get(0) ?? 0, session.teamLevels.get(1) ?? 0],
    log: session.log.slice(-20),
  };
}

function getRoomInfo(room: Room): any {
  return {
    id: room.id,
    playerCount: room.players.length,
    maxPlayers: 4,
    gameState: room.session?.state || 'waiting',
    players: room.players.map(p => ({
      name: p.name,
      nickname: p.nickname,
      avatar: p.avatar,
      playerIndex: p.playerIndex,
      ready: p.ready,
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

  ws.on('message', (data: Buffer) => {
    handleMessage(ws, data.toString());
  });

  ws.on('close', () => {
    console.log('[Server] Connection closed');
    leaveRoom(ws);
  });

  ws.on('error', (err: Error) => {
    console.error('[Server] WebSocket error:', err.message);
    leaveRoom(ws);
  });
});

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

