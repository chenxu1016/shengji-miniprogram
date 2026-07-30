// 新增同步/重连专项测试：playerId 即时重连(鬼魂仍在线)、显式退出让出座位、
// 头像昵称实时更新、离线时仍可准备且不会误开战。
const WebSocket = require('ws');
const URL = process.argv[2] || 'ws://localhost:8899';
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const assert = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); FAILS++; } else { console.log('  ✓ ' + msg); } };
let FAILS = 0;

function makeClient(tag, playerId) {
  const ws = new WebSocket(URL);
  ws._tag = tag; _cid(ws, playerId);
  return ws;
}
function _cid(ws, playerId) {
  ws._pid = playerId || '';
  ws._state = 'connecting';
  ws._roomId = ''; ws._myIndex = -1;
  ws._lastPlayers = null;
  ws._errors = [];
  ws._gameStarted = false;
  ws._closedByServer = false;
  ws.on('open', () => { ws._state = 'open'; });
  ws.on('close', () => { ws._state = 'closed'; ws._closedByServer = true; });
  ws.on('error', (e) => log('[' + ws._tag + '] err', e.message));
  ws.on('message', (data) => {
    const m = JSON.parse(data);
    if (m.type === 'joined') { ws._roomId = m.roomId; ws._myIndex = m.playerIndex; }
    if (m.type === 'roomUpdate' && m.players) ws._lastPlayers = m.players;
    if (m.type === 'error') ws._errors.push(m.message);
    if (m.type === 'gameStart') ws._gameStarted = true;
  });
  ws._send = (o) => ws.send(JSON.stringify(o));
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function waitFor(ws, type, timeout = 5000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('waitFor ' + type + ' timeout on ' + ws._tag)), timeout);
    const h = (d) => { const m = JSON.parse(d); if (m.type === type) { clearTimeout(t); ws.off('message', h); res(m); } };
    ws.on('message', h);
  });
}

(async () => {
  // ===== 1. 4 人用 playerId 进房 =====
  const p1 = makeClient('P1', 'pid-1');
  const p2 = makeClient('P2', 'pid-2');
  const p3 = makeClient('P3', 'pid-3');
  const p4 = makeClient('P4', 'pid-4');
  await Promise.all([p1, p2, p3, p4].map(c => new Promise(r => c.on('open', r))));
  await wait(200);

  p1._send({ type: 'createRoom', name: 'P1', playerId: 'pid-1' });
  await waitFor(p1, 'roomUpdate');
  const roomId = p1._roomId;
  log('房间:', roomId);
  for (const [c, n] of [[p2, 'P2'], [p3, 'P3'], [p4, 'P4']]) {
    c._send({ type: 'joinRoom', roomId, name: n, playerId: 'pid-' + n[1] });
    await waitFor(c, 'joined');
  }
  await wait(400);
  assert(p1._lastPlayers && p1._lastPlayers.length === 4, '4 人进入房间, playerCount=4');

  // ===== 2. 第5人进房应被拒(房间已满) =====
  const pX = makeClient('PX', 'pid-x');
  await new Promise(r => pX.on('open', r));
  pX._send({ type: 'joinRoom', roomId, name: 'PX', playerId: 'pid-x' });
  await wait(500);
  assert(pX._errors.some(e => e.includes('已满')), '第5人进房被拒: 房间已满 ✓');
  assert(p1._lastPlayers.length === 4, '房间人数仍为 4 (PX 未被计入)');

  // ===== 3. 鬼魂仍在线时, 同 playerId 即时重连(应恢复座位而非新增) =====
  log('--- 模拟 P2 退出又立刻回来(旧连接尚未被心跳清除) ---');
  const p2b = makeClient('P2b', 'pid-2');
  await new Promise(r => p2b.on('open', r));
  p2b._send({ type: 'joinRoom', roomId, name: 'P2', playerId: 'pid-2' });
  await waitFor(p2b, 'joined');
  await wait(400);
  assert(p2b._myIndex === 1, 'P2 重连恢复原座位(seat=1)');
  assert(p1._lastPlayers.length === 4, '重连后房间仍为 4 人(未变成 5) ✓');
  assert(p2._closedByServer === true, '服务端已关闭 P2 的旧鬼魂连接 ✓');

  // ===== 4. 显式退出房间立即让出座位, 他人可补位 =====
  log('--- P4 点"退出房间"(显式 leaveRoom) ---');
  p4._send({ type: 'leaveRoom' });
  await wait(400);
  assert(p1._lastPlayers.length === 3, 'P4 显式退出后房间剩 3 人 ✓');
  const p5 = makeClient('P5', 'pid-5');
  await new Promise(r => p5.on('open', r));
  p5._send({ type: 'joinRoom', roomId, name: 'P5', playerId: 'pid-5' });
  await waitFor(p5, 'joined');
  await wait(300);
  assert(p1._lastPlayers.length === 4, 'P5 成功补位, 房间恢复 4 人 ✓');

  // ===== 5. 头像/昵称实时同步(updateProfile) =====
  log('--- P1 同步微信昵称"阿伟"与头像 ---');
  p1._send({ type: 'updateProfile', nickname: '阿伟', avatar: 'https://x/y.png' });
  await wait(400);
  const meInP5 = p5._lastPlayers.find(p => p.playerIndex === 0);
  assert(meInP5 && meInP5.nickname === '阿伟' && meInP5.avatar === 'https://x/y.png', 'P5 实时看到 P1 昵称=阿伟 头像已更新 ✓');

  // ===== 6. 有人离线时仍可准备, 且不会误开战 =====
  log('--- P3 断线(模拟锁屏) ---');
  p3.close();
  await wait(500);
  assert(p1._lastPlayers.find(p => p.playerIndex === 2).online === false, 'P3 显示离线');
  log('--- 在线玩家 P1/P2/P5 准备 (不应报错, 也不应开战) ---');
  p1._send({ type: 'ready' }); await waitFor(p1, 'playerReady');
  p2b._send({ type: 'ready' }); await waitFor(p2b, 'playerReady');
  p5._send({ type: 'ready' }); await waitFor(p5, 'playerReady');
  await wait(400);
  assert(p1._errors.length === 0, '离线期间准备未报"有玩家离线"错误 ✓');
  assert(p1._gameStarted === false, '有人离线时不自动开战 ✓');

  // ===== 7. P3 重连后补准备 -> 4人在线全准备 -> 自动开战 =====
  log('--- P3 重连并准备 ---');
  const p3b = makeClient('P3b', 'pid-3');
  await new Promise(r => p3b.on('open', r));
  p3b._send({ type: 'joinRoom', roomId, name: 'P3', playerId: 'pid-3' });
  await waitFor(p3b, 'joined');
  await wait(200);
  p3b._send({ type: 'ready' }); await waitFor(p3b, 'playerReady');
  const gs = await Promise.race([waitFor(p1, 'gameStart', 4000), wait(4200).then(() => null)]);
  assert(gs !== null, 'P3 重连补齐后 4 人在线全准备 -> 自动开战 ✓');

  log('\n==== 结果: ' + (FAILS === 0 ? '全部通过 ✅' : (FAILS + ' 项失败 ❌')) + ' ====');
  process.exit(FAILS === 0 ? 0 : 1);
})().catch(e => { console.error('TEST FAIL:', e); process.exit(1); });
