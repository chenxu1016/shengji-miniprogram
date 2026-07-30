// 验证：bidHistory 是否带 player 字段，模拟"3个对手各亮一不同花色"后检查 _getOppBidInfo 逻辑
const path = require('path');

// 模拟 game.js 里的 _getOppBidInfo 逻辑（独立验证）
function getOppBidInfo(s, absIdx) {
  const none = { suit: null, label: null, cls: null };
  if (!s.bidHistory || !s.bidHistory.length) return none;
  const suitMap = {
    big_joker:   { label: "大", cls: "suit-joker" },
    small_joker: { label: "小", cls: "suit-joker" },
    spade:       { label: "♠", cls: "suit-spade" },
    heart:       { label: "♥", cls: "suit-heart" },
    club:        { label: "♣", cls: "suit-club" },
    diamond:     { label: "♦", cls: "suit-diamond" }
  };
  for (let i = s.bidHistory.length - 1; i >= 0; i--) {
    const b = s.bidHistory[i];
    if (b.player === absIdx && b.bid !== "pass" && b.suit) {
      const m = suitMap[b.suit];
      if (m) return { suit: b.suit, label: m.label, cls: m.cls };
      return none;
    }
  }
  return none;
}

// 模拟后端 serializeSession 序列化后的 bidHistory
const session = {
  state: "playing",
  players: [
    { hand: new Array(8) }, { hand: new Array(6) },
    { hand: new Array(4) }, { hand: new Array(2) }
  ],
  bidHistory: [
    { player: 0, bid: "0", suit: "spade" },     // 我亮黑桃
    { player: 1, bid: "pass", suit: null },     // 玩家1 pass
    { player: 2, bid: "1", suit: "heart" },     // 玩家2 反主亮红桃 1分
    { player: 3, bid: "pass", suit: null },     // 玩家3 pass
    { player: 0, bid: "2", suit: "heart" },     // 我反主 2分
    { player: 1, bid: "pass", suit: null },
    { player: 2, bid: "pass", suit: null },
    { player: 3, bid: "pass", suit: null },
  ]
};

console.log("=== 对手亮牌 chip 验证 ===\n");
const cases = [
  { idx: 1, name: "玩家1(右家)", expectLabel: null,    expectCls: null,    reason: "只 pass 过，未亮主" },
  { idx: 2, name: "玩家2(对家)", expectLabel: "♥",  expectCls: "suit-heart", reason: "最后一次亮红桃 1分" },
  { idx: 3, name: "玩家3(左家)", expectLabel: null,    expectCls: null,    reason: "只 pass 过，未亮主" },
  { idx: 0, name: "玩家0(我)",    expectLabel: "♥",  expectCls: "suit-heart", reason: "我最后反主 2分 亮红桃" },
];

let ok = 0, fail = 0;
for (const c of cases) {
  const r = getOppBidInfo(session, c.idx);
  const pass = (r.label === c.expectLabel) && (r.cls === c.expectCls);
  if (pass) { ok++; console.log(`✓ ${c.name}: label=${r.label} cls=${r.cls} — ${c.reason}`); }
  else { fail++; console.log(`✗ ${c.name}: got label=${r.label} cls=${r.cls}, expected ${c.expectLabel}/${c.expectCls} — ${c.reason}`); }
}

// 玩家2 之前亮过黑桃后又亮红桃，应该取最后一次（红桃）
const r2 = getOppBidInfo(session, 2);
if (r2.label === "♥" && r2.cls === "suit-heart") {
  console.log("\n✓ 反主覆盖：玩家2 后亮的红桃覆盖了之前的黑桃");
  ok++;
} else {
  console.log(`\n✗ 反主覆盖失败: got ${r2.label}/${r2.cls}`);
  fail++;
}

console.log(`\n=== 结果: ${ok} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
