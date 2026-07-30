// 验证大厅实时同步 + 同名玩家不再互相顶替座位
// 用法: node test-scripts/test-lobby-sync.js ws://localhost:8899
const WebSocket = require('ws');
const URL = process.argv[2] || 'ws://localhost:8899';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function mkClient(tag) {
  const ws = new WebSocket(URL);
  const c = {
    ws, tag, msgs: [], handlers: {},
    on(type, fn) { this.handlers[type] = fn; },
    _emit(m) { if (this.handlers[m.type]) this.handlers[m.type](m); },
    send(obj) { ws.send(JSON.stringify(obj)); },
    close() { try { ws.close(); } catch (e) {} },
    waitFor(type, timeout = 4000) {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          const m = this.msgs.find(x => x.type === type);
          if (m) { clearInterval(iv); resolve(m); }
          else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error(this.tag + ' 等待 ' + type + ' 超时')); }
        }, 30);
      });
    }
  };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    c.msgs.push(m);
    c._emit(m);
  });
  return new Promise((resolve) => { ws.on('open', () => resolve(c)); });
}

(async () => {
  console.log('=== 测试1: 大厅实时同步（别人建房我能立刻看到） ===');
  const lobby = await mkClient('lobby');           // 一直停留大厅
  lobby.send({ type: 'getRooms' });
  await lobby.waitFor('roomList');
  const creator = await mkClient('creator');        // 建房者
  lobby.msgs = [];                                  // 清空，等待"建房广播"这最新一条
  creator.send({ type: 'createRoom', name: '玩家', nickname: '', avatar: '', playerId: 'u_creator' });
  // lobby 应当收到包含新房间的 roomList 广播
  const listMsg = await lobby.waitFor('roomList', 4000).catch(() => null);
  let sawRoom = false;
  if (listMsg) {
    const rooms = listMsg.rooms || [];
    sawRoom = rooms.some(r => r.playerCount >= 1);
  }
  ok('大厅收到包含新建房间的 roomList 广播', sawRoom);
  const joinedMsg = await creator.waitFor('joined');
  ok('建房者收到 joined', joinedMsg && joinedMsg.playerIndex === 0);

  console.log('=== 测试2: 同名默认昵称"玩家"加入，不应踢掉房主 ===');
  // 房主(creator) 与第二个玩家都用默认名"玩家"，但不同 playerId
  const p2 = await mkClient('p2');
  creator.msgs = []; p2.msgs = []; lobby.msgs = [];   // 清空，等待"加入"产生的最新消息
  p2.send({ type: 'joinRoom', roomId: joinedMsg.roomId, name: '玩家', nickname: '', avatar: '', playerId: 'u_p2' });
  const p2Joined = await p2.waitFor('joined');
  ok('第二位玩家收到 joined', p2Joined && p2Joined.playerIndex === 1);

  // creator 应保持连接（未被踢）
  await wait(500);
  ok('房主连接未被关闭(未收到非正常关闭)', creator.ws.readyState === WebSocket.OPEN);

  // 房主应收到 roomUpdate 且房间有 2 人
  const ru = await creator.waitFor('roomUpdate', 4000).catch(() => null);
  let twoPlayers = false;
  if (ru && ru.players) twoPlayers = ru.players.length === 2;
  ok('房主视角房间有 2 名玩家', twoPlayers);

  // p2 视角房间也有 2 人
  const ru2 = await p2.waitFor('roomUpdate', 4000).catch(() => null);
  let twoPlayers2 = false;
  if (ru2 && ru2.players) twoPlayers2 = ru2.players.length === 2;
  ok('第二位玩家视角房间有 2 名玩家', twoPlayers2);

  // lobby 也应看到该房间 playerCount=2
  const list2 = await lobby.waitFor('roomList', 4000).catch(() => null);
  let lobbySees2 = false;
  if (list2) lobbySees2 = (list2.rooms || []).some(r => r.id === joinedMsg.roomId && r.playerCount === 2);
  ok('大厅看到该房间有 2 人', lobbySees2);

  console.log('=== 测试3: 玩家点退出后，大厅与房间同步减少 ===');
  lobby.msgs = [];                                  // 清空，等待"退出"产生的最新 roomList
  p2.send({ type: 'leaveRoom' });
  const list3 = await lobby.waitFor('roomList', 4000).catch(() => null);
  let lobbySees1 = false;
  if (list3) lobbySees1 = (list3.rooms || []).some(r => r.id === joinedMsg.roomId && r.playerCount === 1);
  ok('大厅看到该房间回到 1 人', lobbySees1);

  lobby.close(); creator.close(); p2.close();
  await wait(300);
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
