/**
 * 验证新规则：首局抢叫定庄定级数；后续局庄锁定抢叫只定花色；逆时针反牌；10秒换庄
 * 用法: node test-scripts/test-dealer-rules.js [ws地址]
 */
const WebSocket = require('ws');
const URL = process.argv[2] || 'ws://localhost:8888';
const bots = [];
let roomId = null;
let session = null;
let roundsPlayed = 0;
let finished = false;
let errors = [];

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

class Bot {
  constructor(i) {
    this.i = i;
    this.name = 'B' + (i + 1);
    this.acted = false;
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => { if (i === 0) this.send({ type: 'createRoom', name: this.name }); });
    this.ws.on('message', d => this.onMsg(JSON.parse(d.toString())));
    this.ws.on('error', e => log(this.name, 'WS ERR', e.message));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  onMsg(msg) {
    switch (msg.type) {
      case 'joined':
        if (this.i === 0) {
          roomId = msg.roomId;
          for (let k = 1; k < 4; k++) bots[k].send({ type: 'joinRoom', roomId, name: bots[k].name });
        }
        setTimeout(() => this.send({ type: 'ready' }), 200 + this.i * 80);
        break;
      case 'gameStart':
      case 'bidResult':
      case 'reverseResult':
      case 'playResult':
      case 'dealerSwitched':
        session = msg.session;
        if (msg.type === 'gameStart') {
          log('=== NEW ROUND/SHOOT === state=', session.state, 'dealer=', session.finalBidderIndex,
              'locked=', session.dealerLocked, 'level=', session.level);
        }
        if (msg.type === 'bidResult' && session.state === 'reverse') {
          log('CALL → REVERSE: dealer=', session.finalBidderIndex, 'locked=', session.dealerLocked,
              'trump=', session.trumpSuit, 'nextReverse=', session.currentBidderIndex);
        }
        this.act();
        break;
      case 'error':
        errors.push(msg.message);
        break;
    }
  }
  act() {
    if (!session || finished) return;
    const s = session;
    setTimeout(() => {
      if (s.state === 'bidding' && s.currentBidderIndex === this.i) {
        // 每局只有首家叫分者叫1分，其余一律pass；无论哪种都标记已行动，避免重复叫分
        const shouldBid = (this.i === s.firstBidderIndex) && !this.acted;
        this.acted = true;
        if (shouldBid) this.send({ type: 'bid', bid: '1', suit: 'spade' });
        else this.send({ type: 'bid', bid: 'pass' });
      } else if (s.state === 'reverse' && s.currentBidderIndex === this.i) {
        this.send({ type: 'skipReverse' });
      } else if (s.state === 'playing') {
        const trick = s.currentTrick || [];
        const exp = trick.length === 0 ? s.currentTrickWinner : (trick[trick.length - 1].player + 1) % 4;
        if (exp === this.i) {
          const hand = s.players[this.i].hand;
          if (!hand.length) return;
          let card;
          if (trick.length === 0) card = hand[0];
          else {
            const lead = trick[0].cards[0];
            const isT = c => c.value === 'big_joker' || c.value === 'small_joker' || c.value === s.level || c.suit === s.trumpSuit;
            const leadT = isT(lead);
            const same = hand.filter(c => leadT ? isT(c) : (!isT(c) && c.suit === lead.suit));
            card = (same.length ? same : hand)[0];
          }
          this.send({ type: 'playCards', cards: [{ suit: card.suit, value: card.value }] });
        }
      }
    }, 40 + this.i * 25);
  }
}
for (let i = 0; i < 4; i++) bots.push(new Bot(i));

// 每局重置 acted（检测 bidResult 进 reverse 时统一清）
const origLog = console.log;
setInterval(() => {
  if (session && session.state === 'reverse') bots.forEach(b => b.acted = false);
}, 300);

setTimeout(() => {
  log('=== TEST DONE === errors=', errors.length, errors.slice(0, 5));
  bots.forEach(b => b.ws.close());
  process.exit(errors.length ? 1 : 0);
}, 12000);
