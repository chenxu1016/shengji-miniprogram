// 花色枚举
const Suit = {
  DIAMOND: "diamond",
  HEART: "heart",
  CLUB: "club",
  SPADE: "spade",
  NONE: "none"
};

// 点数枚举
const CardValue = {
  TWO: "two", THREE: "three", FOUR: "four", FIVE: "five",
  SIX: "six", SEVEN: "seven", EIGHT: "eight", NINE: "nine",
  TEN: "ten", JACK: "jack", QUEEN: "queen", KING: "king", ACE: "ace",
  BIG_JOKER: "big_joker", SMALL_JOKER: "small_joker"
};

// 王牌映射
const KING_SUIT_MAP = new Map([
  [CardValue.BIG_JOKER, [Suit.DIAMOND, Suit.HEART]],
  [CardValue.SMALL_JOKER, [Suit.CLUB, Suit.SPADE]]
]);

// 分值
function getPoints(value) {
  if (value === CardValue.FIVE) return 5;
  if (value === CardValue.TEN || value === CardValue.KING) return 10;
  return 0;
}

// 牌类
class Card {
  constructor(suit, value) {
    this.suit = suit;
    this.value = value;
  }

  toString() {
    const suitChar = this.getSuitChar();
    const valStr = this.getValueStr();
    if (this.suit === Suit.NONE) {
      return this.value === CardValue.BIG_JOKER ? "大王" : "小王";
    }
    return valStr + suitChar;
  }

  getSuitChar() {
    switch (this.suit) {
      case Suit.DIAMOND: return "\u2666";
      case Suit.HEART: return "\u2665";
      case Suit.CLUB: return "\u2663";
      case Suit.SPADE: return "\u2660";
      default: return "";
    }
  }

  getValueStr() {
    const map = {
      two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
      eight: "8", nine: "9", ten: "10", jack: "J", queen: "Q", king: "K", ace: "A"
    };
    return map[this.value] || this.value;
  }

  isTrump(trumpSuit, level) {
    if (this.value === CardValue.BIG_JOKER || this.value === CardValue.SMALL_JOKER) return true;
    if (this.value === CardValue.FOUR) return true;
    if (!trumpSuit || trumpSuit === Suit.NONE) return false;
    return this.suit === trumpSuit;
  }

  equals(other) {
    return this.suit === other.suit && this.value === other.value;
  }

  copy() {
    return new Card(this.suit, this.value);
  }
}

module.exports = { Suit, CardValue, KING_SUIT_MAP, getPoints, Card };
