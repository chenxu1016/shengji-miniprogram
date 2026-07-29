// 模拟4个客户端：建房->3人加入->全部准备，验证 gameStart 是否广播
const WebSocket = require('ws');
const URL = process.argv[2] || 'wss://shengji-backend-production.up.railway.app';

const clients = [];
let roomId = null;
let gameStartCount = 0;

function log(i, ...args) { console.log(`[C${i}]`, ...args); }

function makeClient(i) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => { log(i, 'connected'); resolve(ws); });
    ws.on('error', (e) => { log(i, 'ERROR', e.message); reject(e); });
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'error') log(i, 'SERVER ERROR:', msg.message);
      if (msg.type === 'joined') log(i, 'joined room', msg.roomId, 'as index', msg.playerIndex);
      if (msg.type === 'roomUpdate' && i === 0 && !roomId && msg.room) {
        roomId = msg.room.id;
        log(i, 'room created:', roomId);
      }
      if (msg.type === 'playerReady') {
        log(i, 'playerReady p' + msg.playerIndex, 'allReady=' + msg.allReady,
            'players=', (msg.players||[]).map(p => p.name + ':' + p.ready).join(','));
      }
      if (msg.type === 'gameStart') {
        gameStartCount++;
        log(i, '*** gameStart received! state=', msg.session && msg.session.state,
            'hand size=', msg.session && msg.session.players[0].hand.length);
      }
    });
    clients.push(ws);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const c0 = await makeClient(0);
  c0.send(JSON.stringify({ type: 'createRoom', name: '测试1' }));
  await sleep(1500);
  if (!roomId) { console.log('!!! 没拿到 roomId，退出'); process.exit(1); }

  for (let i = 1; i < 4; i++) {
    const c = await makeClient(i);
    c.send(JSON.stringify({ type: 'joinRoom', roomId, name: '测试' + (i + 1) }));
    await sleep(800);
  }

  console.log('--- 全部加入，开始逐个准备 ---');
  for (let i = 0; i < 4; i++) {
    clients[i].send(JSON.stringify({ type: 'ready' }));
    await sleep(800);
  }

  await sleep(3000);
  console.log('=== 结果: gameStart 收到次数 =', gameStartCount, '(应为4) ===');
  clients.forEach(c => c.close());
  process.exit(gameStartCount === 4 ? 0 : 2);
})();
