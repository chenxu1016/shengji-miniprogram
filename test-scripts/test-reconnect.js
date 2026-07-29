// 断线重连专项测试：验证玩家锁屏/掉线后能恢复座位和准备状态
const WebSocket = require('ws');

const URL = process.argv[2] || 'ws://localhost:8899';
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

function makeClient(name) {
  const ws = new WebSocket(URL);
  ws._name = name;
  ws._state = 'connecting';
  ws._lastMsg = null;
  ws._roomId = '';
  ws._myIndex = -1;
  ws.on('open', () => { ws._state = 'open'; log('[' + name + '] connected'); });
  ws.on('close', () => { ws._state = 'closed'; log('[' + name + '] closed'); });
  ws.on('error', (e) => log('[' + name + '] err:', e.message));
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'joined') { ws._roomId = msg.roomId; ws._myIndex = msg.playerIndex; }
    if (msg.type === 'roomUpdate' && msg.players) {
      ws._lastRoomPlayers = msg.players;
    }
    if (msg.type === 'error') log('[' + name + '] ERR:', msg.message);
    if (msg.type === 'roomList' || msg.type === 'roomUpdate' || msg.type === 'joined' || msg.type === 'playerReady' || msg.type === 'playerOffline' || msg.type === 'gameReconnect') {
      // 收到
    }
  });
  ws.send = ws.send.bind(ws);
  ws._send = (data) => ws.send(JSON.stringify({ ...data }));
  return ws;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function waitFor(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('waitFor ' + type + ' timeout')), timeout);
    ws.on('message', function h(data) {
      const msg = JSON.parse(data);
      if (msg.type === type) { clearTimeout(t); ws.off('message', h); resolve(msg); }
    });
  });
}

(async () => {
  // 4 个客户端加入同一房间
  const bots = [makeClient('Bot1'), makeClient('Bot2'), makeClient('Bot3'), makeClient('Bot4')];
  await Promise.all(bots.map(b => new Promise(r => b.on('open', r))));
  await wait(200);

  // Bot1 创建房间
  bots[0]._send({ type: 'createRoom', name: 'Bot1' });
  await waitFor(bots[0], 'roomUpdate');
  const roomId = bots[0]._roomId;
  log('房间已创建:', roomId);

  // Bot2/3/4 加入
  for (let i = 1; i < 4; i++) {
    bots[i]._send({ type: 'joinRoom', roomId, name: 'Bot' + (i+1) });
    await waitFor(bots[i], 'joined');
  }
  // 等所有 roomUpdate 同步
  await wait(500);
  log('4 人齐, Bot1 座位=', bots[0]._myIndex, ' Bot2 座位=', bots[1]._myIndex, ' Bot3 座位=', bots[2]._myIndex, ' Bot4 座位=', bots[3]._myIndex);

  // 全部 ready
  for (let i = 0; i < 4; i++) {
    bots[i]._send({ type: 'ready' });
    await waitFor(bots[i], 'playerReady');
  }
  await wait(500);
  log('4 人已准备, 各自 ready 状态:');
  bots.forEach((b, i) => {
    const me = b._lastRoomPlayers ? b._lastRoomPlayers.find(p => p.name === 'Bot' + (i+1)) : null;
    log('  Bot' + (i+1) + ' ready=' + (me ? me.ready : '?'));
  });
  const bot2ReadyBefore = bots[0]._lastRoomPlayers.find(p => p.name === 'Bot2').ready;
  log('Bot2 断线前的 ready 状态: ' + bot2ReadyBefore);

  // ====== 关键测试：Bot2 断线 ======
  log('--- 模拟 Bot2 锁屏断线 ---');
  bots[1].close();
  await wait(800);
  log('Bot2 断线后, Bot1 看到的玩家状态:');
  bots[0]._lastRoomPlayers.forEach(p => log('  玩家' + (p.playerIndex+1) + ' ' + p.name + ' ready=' + p.ready + ' online=' + p.online));
  const bot2StillThere = bots[0]._lastRoomPlayers.some(p => p.name === 'Bot2');
  log('Bot2 是否还在房间?', bot2StillThere ? '✓ 保留座位' : '✗ 被踢出');

  // 等待几秒，再看看 5 分钟清理不会发生
  await wait(2000);
  log('2 秒后: Bot1 视角房间玩家数 =', bots[0]._lastRoomPlayers.length);

  // ====== 关键测试：Bot2 用新 socket 重连 ======
  log('--- 模拟 Bot2 重连 ---');
  const bot2New = makeClient('Bot2');
  await new Promise(r => bot2New.on('open', r));
  await wait(200);
  // 用 saveIdentity 然后 joinRoom（同 roomId 同 name）
  bot2New._send({ type: 'joinRoom', roomId, name: 'Bot2' });
  await waitFor(bot2New, 'joined');
  log('Bot2 重连成功, 恢复座位 =', bot2New._myIndex, '(断线前=' + bots[1]._myIndex + ')');
  const sameSeat = bot2New._myIndex === bots[1]._myIndex;
  log('座位是否一致?', sameSeat ? '✓' : '✗');

  // 检查 ready 状态是否还在
  await wait(500);
  const bot2After = bots[0]._lastRoomPlayers.find(p => p.name === 'Bot2');
  log('Bot2 恢复后, Bot1 看到的 Bot2 状态: ready=' + bot2After.ready + ' online=' + bot2After.online);
  log('Bot2 ready 状态是否保留?', bot2After.ready === bot2ReadyBefore ? '✓ 是' : '✗ 否');
  log('--- 测试完成 ---');
  setTimeout(() => process.exit(0), 500);
})().catch(e => { console.error('TEST FAIL:', e); process.exit(1); });
