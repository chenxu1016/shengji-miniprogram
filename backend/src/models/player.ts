import { Suit, CardValue, KING_SUIT_MAP } from './card';
import { Card } from './card';

export interface IPlayer {
  id: number;
  name: string;
  hand: Card[];
  team: 'leader' | 'follower'; // leader=庄家队, follower=闲家队
  seatIndex: number; // 0-3
}

export class Player implements IPlayer {
  public id: number;
  public name: string;
  public hand: Card[] = [];
  public team: 'leader' | 'follower' = 'follower';
  public seatIndex: number;

  constructor(id: number, name: string, seatIndex: number) {
    this.id = id;
    this.name = name;
    this.seatIndex = seatIndex;
  }

  addCard(card: Card): void {
    this.hand.push(card);
  }

  /** 按花色和点数排序手牌 */
  sortHand(trumpSuit: Suit | null, level: CardValue): void {
    this.hand.sort((a, b) => this.compareCard(a, b, trumpSuit, level));
  }

  private compareCard(a: Card, b: Card, trumpSuit: Suit | null, level: CardValue): number {
    const aTrump = a.isTrump(trumpSuit, level);
    const bTrump = b.isTrump(trumpSuit, level);
    if (aTrump && !bTrump) return -1;
    if (!aTrump && bTrump) return 1;

    // 都是主牌或都是副牌，比较点数
    const aOrder = this.getCardOrder(a, level);
    const bOrder = this.getCardOrder(b, level);
    if (aOrder !== bOrder) return bOrder - aOrder;

    // 同点数，比较花色
    return (a.suit < b.suit ? -1 : 1);
  }

  private getCardOrder(card: Card, level: CardValue): number {
    // 大小王
    if (card.value === CardValue.BIG_JOKER) return 100;
    if (card.value === CardValue.SMALL_JOKER) return 99;
    // 4永远是主牌
    if (card.value === CardValue.FOUR) return 98;
    // 级牌
    if (card.value === level) return 97;

    const idx = ['A','K','Q','J','10','9','8','7','6','5','3','2'].indexOf(card.value);
    return idx >= 0 ? idx : 0;
  }

  /** 出牌后从手牌移除 */
  playCard(card: Card): Card | null {
    const idx = this.hand.findIndex(c => c.equals(card));
    if (idx === -1) return null;
    return this.hand.splice(idx, 1)[0];
  }

  /** 批量出牌 */
  playCards(cards: Card[]): Card[] {
    const played: Card[] = [];
    for (const card of cards) {
      const idx = this.hand.findIndex(c => c.equals(card));
      if (idx !== -1) {
        played.push(this.hand.splice(idx, 1)[0]);
      }
    }
    return played;
  }

  hasCard(suit: Suit, value: CardValue): boolean {
    return this.hand.some(c => c.suit === suit && c.value === value);
  }

  hasSuit(suit: Suit): boolean {
    return this.hand.some(c => c.suit === suit);
  }

  /** 获取某花色的所有牌 */
  getSuits(suit: Suit): Card[] {
    return this.hand.filter(c => c.suit === suit);
  }

  /** 找出所有对子 */
  getPairs(): Card[][] {
    const pairs: Card[][] = [];
    const groups = new Map<string, Card[]>();
    for (const card of this.hand) {
      const key = card.value;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(card);
    }
    for (const [, cards] of groups) {
      if (cards.length >= 2) {
        pairs.push(cards.slice(0, 2));
      }
    }
    return pairs;
  }

  /** 检查是否有指定花色的对子 */
  hasPairOfSuit(suit: Suit): boolean {
    const suitCards = this.getSuits(suit);
    const valueGroups = new Map<CardValue, Card[]>();
    for (const c of suitCards) {
      if (!valueGroups.has(c.value)) valueGroups.set(c.value, []);
      valueGroups.get(c.value)!.push(c);
    }
    for (const cards of valueGroups.values()) {
      if (cards.length >= 2) return true;
    }
    return false;
  }
}
