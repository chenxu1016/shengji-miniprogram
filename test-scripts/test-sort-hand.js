// 验证前端手牌排序算法（升级规则）：
// 分组：1大王 2小王 3级牌 4主花色 5副牌
// 组内：花色 黑桃>红桃>梅花>方块；同花色 点数 A>K>Q>...>2
// 同花色同点数自然相邻 → 对子/拖拉机在一起

var VALUE_RANK = {big_joker:99,small_joker:98,ace:14,king:13,queen:12,jack:11,ten:10,nine:9,eight:8,seven:7,six:6,five:5,four:4,three:3,two:2};
var SUIT_RANK = {spade:4,heart:3,club:2,diamond:1,none:0};

function _handGroup(c, trump, level) {
  if (c.value === "big_joker") return 1;
  if (c.value === "small_joker") return 2;
  if (level && c.value === level) return 3;
  if (trump && c.suit === trump) return 4;
  return 5;
}
function sortHandByRule(hand, trumpSuit, level) {
  if (!hand || !hand.length) return hand;
  var trump = (trumpSuit && trumpSuit !== "none") ? trumpSuit : null;
  return hand.slice().sort(function(a, b) {
    var ag = _handGroup(a, trump, level), bg = _handGroup(b, trump, level);
    if (ag !== bg) return ag - bg;
    var as = SUIT_RANK[a.suit] || 0, bs = SUIT_RANK[b.suit] || 0;
    if (as !== bs) return bs - as;
    return (VALUE_RANK[b.value] || 0) - (VALUE_RANK[a.value] || 0);
  });
}

// 注意：Card 结构是 { suit: 花色, value: 点数 }，大王/小王 suit="none", value="big_joker"/"small_joker"
function C(suit, value) { return { suit: suit, value: value }; }
function disp(c){ return (c.value==="big_joker"?"大王":c.value==="small_joker"?"小王":c.value.toUpperCase()) + (c.suit==="none"?"":c.suit[0].toUpperCase()); }

var fails = 0;
function assert(cond, msg) { if (!cond) { console.error("  ✗ " + msg); fails++; } else { console.log("  ✓ " + msg); } }

// 一手牌：level=two, 主花色红桃
// 王：大王 小王
// 级牌(2)：2♠ 2♥ 2♣ 2♦
// 主花色(红桃,非2)：A♥ K♥ 5♥
// 副牌：A♠ K♠  A♣ 10♣  10♦ 7♦
function buildHand() {
  return [
    C("none","big_joker"), C("none","small_joker"),
    C("spade","two"), C("heart","two"), C("club","two"), C("diamond","two"),
    C("heart","ace"), C("heart","king"), C("heart","five"),
    C("spade","ace"), C("spade","king"),
    C("club","ace"), C("club","ten"),
    C("diamond","ten"), C("diamond","seven")
  ];
}

// ---- 场景1：有主（level=two, trump=heart）----
console.log("场景1：有主（level=two, trump=heart）");
var s1 = sortHandByRule(buildHand(), "heart", "two");
console.log("  顺序: " + s1.map(disp).join(" "));
assert(s1[0].value === "big_joker", "第1张是大王");
assert(s1[1].value === "small_joker", "第2张是小王");
var levelSlice = s1.slice(2, 6);
assert(levelSlice.length === 4 && levelSlice.every(function(c){return c.value==="two";}), "级牌4张连续且都是2");
assert(levelSlice.map(function(c){return c.suit;}).join("") === "spadeheartclubdiamond", "级牌按花色 spade>heart>club>diamond");
var trumpSlice = s1.slice(6, 9);
assert(trumpSlice.every(function(c){return c.suit==="heart" && c.value!=="two";}), "主花色3张都是红桃且非级牌");
assert(trumpSlice.map(function(c){return c.value;}).join("") === "acekingfive", "主花色内 A>K>5");
var sideSlice = s1.slice(9);
assert(sideSlice.length === 6, "副牌6张");
assert(sideSlice[0].suit==="spade" && sideSlice[1].suit==="spade", "副牌先黑桃(A♠K♠)");
assert(sideSlice[2].suit==="club" && sideSlice[3].suit==="club", "副牌其次梅花(A♣10♣)");
assert(sideSlice[4].suit==="diamond" && sideSlice[5].suit==="diamond", "副牌最后方块(10♦7♦)");
assert(sideSlice.map(function(c){return c.value;}).join("") === "acekingacetentenseven", "副牌点数顺序正确(A♠K♠A♣10♣10♦7♦)");

// ---- 场景2：无主（发牌阶段 trump=null）----
console.log("场景2：无主（level=two, trump=null，模拟发牌后叫分前）");
var s2 = sortHandByRule(buildHand(), null, "two");
console.log("  顺序: " + s2.map(disp).join(" "));
assert(s2[0].value === "big_joker" && s2[1].value === "small_joker", "仍是 大王→小王");
assert(s2[2].value === "two" && s2[5].value === "two", "4张级牌连续在最前（group3）");
var side2 = s2.slice(6);
assert(side2.length === 9, "无主时主花色红桃牌归入副牌，共9张副牌");
assert(side2[0].suit==="spade" && side2[1].suit==="spade", "副牌先黑桃");
assert(side2[2].suit==="heart" && side2[2].value==="ace", "红桃A作为副牌紧随级牌（因无主）");

// ---- 场景3：对子相邻 ----
console.log("场景3：对子/拖拉机相邻");
var hand3 = [
  C("club","king"), C("club","king"), C("spade","ace"), C("spade","ace"),
  C("diamond","seven"), C("diamond","seven"), C("heart","ten"), C("heart","ten")
];
var s3 = sortHandByRule(hand3, "heart", "three"); // 主花色红桃，级牌是3
console.log("  顺序: " + s3.map(disp).join(" "));
var idx1 = s3.findIndex(function(c){return c.suit==="heart"&&c.value==="ten";});
assert(s3[idx1+1].suit==="heart"&&s3[idx1+1].value==="ten", "主花色对子 10♥10♥ 相邻");
[["club","king"],["spade","ace"],["diamond","seven"]].forEach(function(p){
  var i = s3.findIndex(function(c){return c.suit===p[0]&&c.value===p[1];});
  assert(s3[i+1].suit===p[0]&&s3[i+1].value===p[1], "副牌对子 "+p[1]+p[0]+" 相邻");
});

console.log(fails === 0 ? "\n全部通过 ✅" : "\n失败 " + fails + " 项 ❌");
process.exit(fails === 0 ? 0 : 1);
