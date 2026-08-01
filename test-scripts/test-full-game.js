/**
 * 端到端整局测试：4 个机器人客户端完整打一局升级
 * 建房 -> 加入 -> 准备 -> 叫分 -> (反主跳过) -> 出完全部手牌 -> 结算
 * 用法: node test-full-game.js [ws地址]  默认 ws://localhost:8888
 */
const WebSocket = require('ws');

const URL = process.argv[2] || 'ws://localhost:8888';
const bots = [];
let roomId = null;
let session = null;
let finished = false;
let trickCount = 0;
let errorCount = 0;

function log(...args) { console.log(new Date().toISOString().slice(11, 19), ...args); }

class Bot {
  constructor(i) {
    this.i = i;
    this.name = 'Bot' + (i + 1);
    this.playerIndex = -1;
    this.firstBidder = -1;
    this._seenTricks = 0;
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
          log('房间创建:', roomId);
          // 其余 3 人加入
          for (let k = 1; k < 4; k++) bots[k].send({ type: 'joinRoom', roomId, name: bots[k].name });
        }
        // 全员到齐后各自准备
        setTimeout(() => this.send({ type: 'ready' }), 300 + this.i * 120);
        break;
      case 'gameStart':
        if (this.i === 0) log('>>> 发牌成功, state=', msg.session.state, '手牌数=', msg.session.players.map(p => p.hand.length).join(','));
        session = msg.session;
        this.firstBidder = msg.session.currentBidderIndex;
        this.act();
        break;
      case 'bidResult':
      case 'reverseResult':
      case 'playResult':
        session = msg.session;
        if (this.i === 0) {
          const cur = (msg.session.tricks && msg.session.tricks.length) || 0;
          if (cur < this._seenTricks) {
            // 新一轮开始（tricks 被重置）→ 上一轮已完成
            if (!finished) {
              finished = true;
              log('=== 整局(一轮)完成! 上一轮共 ' + this._seenTricks + ' 墩, state=' + msg.session.state + ' ===');
              log('日志尾部:', msg.session.log.slice(-6).join(' | '));
              setTimeout(() => process.exit(0), 500);
            }
            return;
          }
          if (cur > this._seenTricks) {
            this._seenTricks = cur;
            const t = msg.session.tricks[cur - 1];
            log('第' + cur + '墩 -> 玩家' + (t.winner + 1) + ' 赢 (' + t.points + '分), 剩余手牌:', msg.session.players.map(p => p.hand.length).join(','));
          }
        }
        if (msg.session.state === 'scoring' || msg.session.state === 'game_end') {
          if (!finished) {
            finished = true;
            log('=== 本轮结束! state=' + msg.session.state + ' ===');
            log('日志尾部:', msg.session.log.slice(-6).join(' | '));
            setTimeout(() => process.exit(0), 500);
          }
          return;
        }
        this.act();
        break;
      case 'error':
        errorCount++;
        // 轮次错误是正常的（4 个机器人都会尝试行动）
        if (!/回合|不是玩家/.test(msg.message)) {
          log(this.name, 'ERROR:', msg.message);
        }
        break;
    }
  }
  act() {
    if (!session || finished) return;
    const s = session;
    setTimeout(() => {
      if (finished) return;
      if (s.state === 'bidding' && s.currentBidderIndex === this.playerIndex) {
        // 仅首家叫分者叫 1 分黑桃一次，其余一律过
        if (this.playerIndex === this.firstBidder && !this._bidOnce) {
          this._bidOnce = true;
          this.send({ type: 'bid', bid: '1', suit: 'spade' });
        } else {
          this.send({ type: 'bid', bid: 'pass' });
        }
      } else if (s.state === 'reverse' && s.currentBidderIndex === this.playerIndex) {
        this.send({ type: 'skipReverse' });
      } else if (s.state === 'playing') {
        const trick = s.currentTrick || [];
        const expected = trick.length === 0 ? s.currentTrickWinner : (trick[trick.length - 1].player + 1) % 4;
        if (expected === this.playerIndex) {
          const hand = s.players[this.playerIndex].hand;
          if (!hand.length) return;
          let toPlay;
          if (trick.length === 0) {
            // 首家出单张
            toPlay = [hand[0]];
          } else {
            // 跟牌：有同组（主牌组/副牌花色）就跟，否则垫一张
            // 主牌 = 大小王 + 当前 level 的级牌 + 主花色非级牌。修复：原本硬编码 'four' 当主牌，
            // 已改为按 level 判断（与 server 端的 Card.isTrump 一致）。
            const level = s.level;
            const isTrump = c => c.value === 'big_joker' || c.value === 'small_joker'
              || c.value === level || c.suit === s.trumpSuit;
            const lead = trick[0].cards[0];
            const leadIsTrump = isTrump(lead);
            const sameGroup = hand.filter(c => leadIsTrump ? isTrump(c) : (!isTrump(c) && c.suit === lead.suit));
            toPlay = sameGroup.length ? [sameGroup[0]] : [hand[0]];
          }
          this.send({ type: 'playCards', cards: toPlay.map(c => ({ suit: c.suit, value: c.value })) });
        }
      }
    }, 50 + this.playerIndex * 30);
  }
}

log('连接目标:', URL);
for (let i = 0; i < 4; i++) bots.push(new Bot(i));

setTimeout(() => {
  log('!!! 超时(120s)未完成整局。trickCount=' + trickCount + ', state=' + (session && session.state) + ', errors=' + errorCount);
  if (session) log('最后日志:', session.log.slice(-8).join(' | '));
  process.exit(1);
}, 120000);
