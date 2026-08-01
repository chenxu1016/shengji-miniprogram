// ============================================
// 花色枚举
// ============================================
export enum Suit {
  DIAMOND = 'diamond',
  HEART = 'heart',
  CLUB = 'club',
  SPADE = 'spade',
  NONE = 'none',
}

// ============================================
// 点数枚举
// ============================================
export enum CardValue {
  TWO = 'two',
  THREE = 'three',
  FOUR = 'four',
  FIVE = 'five',
  SIX = 'six',
  SEVEN = 'seven',
  EIGHT = 'eight',
  NINE = 'nine',
  TEN = 'ten',
  JACK = 'jack',
  QUEEN = 'queen',
  KING = 'king',
  ACE = 'ace',
  BIG_JOKER = 'big_joker',
  SMALL_JOKER = 'small_joker',
}

// ============================================
// 王牌映射: 大王/小王分别带哪些花色
// ============================================
export const KING_SUIT_MAP: Map<CardValue, Suit[]> = new Map([
  [CardValue.BIG_JOKER, [Suit.DIAMOND, Suit.HEART]],
  [CardValue.SMALL_JOKER, [Suit.CLUB, Suit.SPADE]],
]);

// ============================================
// 分值计算
// ============================================
export function getPoints(value: CardValue): number {
  switch (value) {
    case CardValue.FIVE: return 5;
    case CardValue.TEN:
    case CardValue.KING: return 10;
    default: return 0;
  }
}

export function isPointCard(value: CardValue): boolean {
  return value === CardValue.FIVE || value === CardValue.TEN || value === CardValue.KING;
}

// ============================================
// 花色强弱(副牌之间比较)
// ============================================
export function isSuitStronger(a: Suit, b: Suit): boolean {
  const order = [Suit.SPADE, Suit.HEART, Suit.DIAMOND];
  const idxA = order.indexOf(a);
  const idxB = order.indexOf(b);
  return idxA > idxB;
}


export interface ICard {
  suit: Suit;
  value: CardValue;
}

export class Card implements ICard {
  public readonly suit: Suit;
  public readonly value: CardValue;

  constructor(suit: Suit, value: CardValue) {
    this.suit = suit;
    this.value = value;
  }

  /** 显示名称 */
  toString(): string {
    const suitChar = this.getSuitChar();
    const isKing = this.value === CardValue.BIG_JOKER || this.value === CardValue.SMALL_JOKER;
    const valueStr = isKing
      ? (this.value === CardValue.BIG_JOKER ? '大王' : '小王')
      : this.getValueStr();
    return this.suit === Suit.NONE
      ? valueStr
      : `${valueStr}${suitChar}`;
  }

  private getSuitChar(): string {
    switch (this.suit) {
      case Suit.DIAMOND: return '\u2666';
      case Suit.HEART: return '\u2665';
      case Suit.CLUB: return '\u2663';
      case Suit.SPADE: return '\u2660';
      default: return '';
    }
  }

  private getValueStr(): string {
    switch (this.value) {
      case CardValue.TWO: return '2';
      case CardValue.THREE: return '3';
      case CardValue.FOUR: return '4';
      case CardValue.FIVE: return '5';
      case CardValue.SIX: return '6';
      case CardValue.SEVEN: return '7';
      case CardValue.EIGHT: return '8';
      case CardValue.NINE: return '9';
      case CardValue.TEN: return '10';
      case CardValue.JACK: return 'J';
      case CardValue.QUEEN: return 'Q';
      case CardValue.KING: return 'K';
      case CardValue.ACE: return 'A';
      default: return this.value;
    }
  }

  /** 是否为主牌 (给定主花色和当前等级) */
  isTrump(trumpSuit: Suit | null, level: CardValue): boolean {
    if (this.value === CardValue.BIG_JOKER || this.value === CardValue.SMALL_JOKER) return true;
    // 级牌（当前等级的牌，无论花色）都算主牌。注意：原代码曾硬编码 `value === FOUR`，
    // 把任意 4 当主牌——是已知 bug，已修正为按当前 level 判断。
    if (level && this.value === level) return true;
    if (trumpSuit === Suit.NONE) return false;
    return this.suit === trumpSuit;
  }

  /** 是否为副牌 */
  isSide(trumpSuit: Suit | null, level: CardValue): boolean {
    return !this.isTrump(trumpSuit, level) && trumpSuit !== Suit.NONE;
  }

  equals(other: Card): boolean {
    return this.suit === other.suit && this.value === other.value;
  }
}

