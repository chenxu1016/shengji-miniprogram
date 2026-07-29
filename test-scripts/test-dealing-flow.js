/**
 * 验证：发牌流程 + 15秒反牌倒计时
 * 模拟 4 个机器人客户端：建房 -> 准备 -> 启动 -> 等发牌完成 -> 验证 session.players[].hand 全部 25 张
 * 用法: node test-dealing-flow.js [ws地址]  默认 ws://localhost:8888
 */
const WebSocket = require('ws');

const URL = process.argv[2] || 'ws://localhost:8888';
const bots = [];
let roomId = null;
let gameStartReceived = 0;
let errorCount = 0;
let dealingDoneTime = null;
let gameStartTime = null;
const allHands = [];

function log(...args) { console.log(new Date().toISOString().slice(11, 23), ...args); }

class Bot {
  constructor(i) {
    this.i = i;
    this.name = 'DealBot' + (i + 1);
    this.playerIndex = -1;
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (d) => this.onMsg(JSON.parse(d.toString())));
    this.ws.on('error', (e) => log(this.name, 'WS ERROR', e.message));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  onOpen() {
    if (this.i === 0) {
      this.send({ type: 'createRoom', name: this.name });
    }
  }
  onMsg(msg) {
    switch (msg.type) {
      case 'joined':
        this.playerIndex = msg.playerIndex;
        if (this.i === 0) {
          roomId = msg.roomId;
          log('[Bot1] 建房:', roomId, 'as 玩家', msg.playerIndex + 1);
          for (let k = 1; k < 4; k++) bots[k].send({ type: 'joinRoom', roomId, name: bots[k].name });
        }
        setTimeout(() => this.send({ type: 'ready' }), 200 + this.i * 80);
        break;
      case 'gameStart':
        if (this.i === 0) {
          gameStartTime = Date.now();
          gameStartReceived++;
          log('[Bot1] >>> 收到 gameStart, state=' + msg.session.state);
          log('>>> 4家手牌数:', msg.session.players.map(p => p.hand.length).join(','));
          // 验证：每家必须25张
          const all25 = msg.session.players.every(p => p.hand.length === 25);
          if (!all25) {
            log('!!! 错误: 某家手牌数不是25');
            errorCount++;
          }
          // 验证：手牌数据完整
          msg.session.players.forEach((p, idx) => {
            if (p.hand.length > 0) {
              const sample = p.hand[0];
              if (!sample.suit || !sample.value || !sample.display) {
                log('!!! 错误: 玩家' + (idx+1) + ' 第1张牌缺字段:', JSON.stringify(sample));
                errorCount++;
              }
            }
          });
          // 验证：bidHistory 存在
          if (!Array.isArray(msg.session.bidHistory)) {
            log('!!! 错误: session.bidHistory 不是数组');
            errorCount++;
          }
          // 验证：所有机器人有非空手牌
          const allHaveCards = msg.session.players.every(p => p.hand && p.hand.length === 25);
          if (!allHaveCards) {
            log('!!! 错误: 某家手牌数为0或缺失');
            errorCount++;
          }
          allHands.push(JSON.parse(JSON.stringify(msg.session.players.map(p => p.hand))));
          // 给前端预留 "发牌动画5s + 反牌倒计时15s = 20s" 的时间，然后开始叫分
          setTimeout(() => {
            dealingDoneTime = Date.now();
            const elapsed = ((dealingDoneTime - gameStartTime) / 1000).toFixed(1);
            log('>>> 前端动画+反牌倒计时假设已结束 (server 端 gameStart 之后', elapsed, 's)');
          }, 20000);
        }
        break;
      case 'bidResult':
        if (this.i === 0) {
          log('[Bot1] 叫分结果 state=' + msg.session.state + ', bidder=' + msg.session.currentBidderIndex);
          // 模拟反牌倒计时后第一家叫 1 分
          if (msg.session.state === 'bidding' && msg.session.currentBidderIndex === this.playerIndex && !this._bidOnce) {
            this._bidOnce = true;
            this.send({ type: 'bid', bid: '1', suit: 'spade' });
          } else if (msg.session.state === 'bidding' && msg.session.currentBidderIndex === this.playerIndex) {
            this.send({ type: 'bid', bid: 'pass' });
          }
        }
        // 其他机器人对叫分进行过牌
        if (msg.session.state === 'bidding' && msg.session.currentBidderIndex === this.playerIndex && this.i !== 0) {
          setTimeout(() => this.send({ type: 'bid', bid: 'pass' }), 80);
        }
        // 反主阶段：所有人跳过
        if (msg.session.state === 'reverse' && msg.session.currentBidderIndex === this.playerIndex) {
          setTimeout(() => this.send({ type: 'skipReverse' }), 80);
        }
        if (msg.session.state === 'scoring' || msg.session.state === 'game_end') {
          log('=== 测试完成! state=' + msg.session.state + ', errors=' + errorCount + ' ===');
          setTimeout(() => process.exit(errorCount > 0 ? 1 : 0), 500);
        }
        break;
      case 'error':
        errorCount++;
        if (!/回合|不是玩家/.test(msg.message)) {
          log('[Bot' + (this.i+1) + '] ERROR:', msg.message);
        }
        break;
    }
  }
}

log('连接目标:', URL);
for (let i = 0; i < 4; i++) bots.push(new Bot(i));

setTimeout(() => {
  log('!!! 超时30s未完成。errors=' + errorCount);
  process.exit(1);
}, 30000);
