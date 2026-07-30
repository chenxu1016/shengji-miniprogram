/**
 * 验证 cardToHandItem 函数把后端 Card 拆为 WXML 渲染所需字段
 * 覆盖：4 种花色 + 大小王 + 红色判定
 */
// 复制 game.js 中的纯函数（同步，保证测试自包含）
function _suitChar(suit) {
  if (suit === "spade")   return "\u2660";
  if (suit === "heart")   return "\u2665";
  if (suit === "club")    return "\u2663";
  if (suit === "diamond") return "\u2666";
  return "";
}
function _rankChar(value) {
  if (!value) return "";
  if (value === "big_joker")   return "JOKER";
  if (value === "small_joker") return "JOKER";
  if (value === "ace")   return "A";
  if (value === "king")  return "K";
  if (value === "queen") return "Q";
  if (value === "jack")  return "J";
  if (value === "ten")   return "10";
  if (value === "two")   return "2";
  if (value === "three") return "3";
  if (value === "four")  return "4";
  if (value === "five")  return "5";
  if (value === "six")   return "6";
  if (value === "seven") return "7";
  if (value === "eight") return "8";
  if (value === "nine")  return "9";
  return value;
}
function cardToHandItem(c, idx) {
  if (!c) return null;
  var isJoker = (c.value === "big_joker" || c.value === "small_joker");
  var topLabel = isJoker ? "JOKER" : _suitChar(c.suit);
  var rank = isJoker ? (c.value === "big_joker" ? "\u5927" : "\u5c0f") : _rankChar(c.value);
  var sChar = isJoker ? (c.value === "big_joker" ? "\u2665" : "\u2660") : _suitChar(c.suit);
  return {
    card: c,
    key: (c.suit || "x") + "_" + (c.value || "x") + "_" + (idx || 0),
    display: c.display || c.toString(),
    topLabel: topLabel,
    rankChar: rank,
    suitChar: sChar,
    suit: c.suit || "spade",
    isJoker: isJoker,
    selected: false,
    playable: true,
    dealing: false
  };
}

var pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("\u2713 " + msg); }
  else      { fail++; console.log("\u2717 " + msg); }
}

// 1. 黑桃 A：A♠ / topLabel=♠ / rankChar=A / suitChar=♠ / suit=spade / !isJoker
var c1 = cardToHandItem({suit:"spade", value:"ace"}, 0);
assert(c1.topLabel === "\u2660", "黑桃A topLabel=\u2660");
assert(c1.rankChar === "A", "黑桃A rankChar=A");
assert(c1.suitChar === "\u2660", "黑桃A suitChar=\u2660");
assert(c1.suit === "spade", "黑桃A suit=spade");
assert(c1.isJoker === false, "黑桃A 非王");
assert(c1.key === "spade_ace_0", "黑桃A key=spade_ace_0");

// 2. 红桃 K：♥红色
var c2 = cardToHandItem({suit:"heart", value:"king"}, 1);
assert(c2.topLabel === "\u2665", "红桃K topLabel=\u2665");
assert(c2.rankChar === "K", "红桃K rankChar=K");
assert(c2.suit === "heart", "红桃K suit=heart");

// 3. 方块 10
var c3 = cardToHandItem({suit:"diamond", value:"ten"}, 2);
assert(c3.rankChar === "10", "方块10 rankChar=10（显示为10，不是字符串ten）");
assert(c3.suitChar === "\u2666", "方块10 suitChar=\u2666");

// 4. 梅花 J
var c4 = cardToHandItem({suit:"club", value:"jack"}, 3);
assert(c4.rankChar === "J", "梅花J rankChar=J");
assert(c4.suitChar === "\u2663", "梅花J suitChar=\u2663");

// 5. 大王：topLabel=JOKER, rankChar=大, suitChar=♥, isJoker=true
var c5 = cardToHandItem({suit:"none", value:"big_joker"}, 4);
assert(c5.isJoker === true, "大王 isJoker=true");
assert(c5.topLabel === "JOKER", "大王 topLabel=JOKER");
assert(c5.rankChar === "\u5927", "大王 rankChar=\u5927");
assert(c5.suitChar === "\u2665", "大王 suitChar=\u2665");

// 6. 小王：rankChar=小, suitChar=♠
var c6 = cardToHandItem({suit:"none", value:"small_joker"}, 5);
assert(c6.isJoker === true, "小王 isJoker=true");
assert(c6.rankChar === "\u5c0f", "小王 rankChar=\u5c0f");
assert(c6.suitChar === "\u2660", "小王 suitChar=\u2660");

// 7. key 唯一性：同 suit+value 但不同 idx 应有不同 key
var k1 = cardToHandItem({suit:"heart", value:"queen"}, 0).key;
var k2 = cardToHandItem({suit:"heart", value:"queen"}, 1).key;
assert(k1 !== k2, "同牌不同位置 key 唯一");

// 8. 全部字段都存在
var required = ["card","key","display","topLabel","rankChar","suitChar","suit","isJoker","selected","playable","dealing"];
var allPresent = required.every(function(k){ return c1.hasOwnProperty(k); });
assert(allPresent, "所有11个字段都存在");

console.log("\n" + pass + " 通过 / " + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);
