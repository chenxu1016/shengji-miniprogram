import { Suit, CardValue } from './card';
import { Card } from './card';

export class Deck {
  public cards: Card[] = [];

  constructor(numDecks: number = 2) {
    this.build(numDecks);
  }

  public build(numDecks: number): void {
    this.cards = [];
    const suits: Suit[] = [Suit.DIAMOND, Suit.HEART, Suit.CLUB, Suit.SPADE];
    const values: CardValue[] = [
      CardValue.TWO, CardValue.THREE, CardValue.FOUR,
      CardValue.FIVE, CardValue.SIX, CardValue.SEVEN,
      CardValue.EIGHT, CardValue.NINE, CardValue.TEN,
      CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE,
    ];
    for (let d = 0; d < numDecks; d++) {
      for (const suit of suits) {
        for (const value of values) {
          this.cards.push(new Card(suit, value));
        }
      }
      // 每副牌加大小王
      this.cards.push(new Card(Suit.NONE, CardValue.BIG_JOKER));
      this.cards.push(new Card(Suit.NONE, CardValue.SMALL_JOKER));
    }
  }

  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal(count: number): Card[] {
    return this.cards.splice(0, count);
  }

  get remaining(): number {
    return this.cards.length;
  }

  get all(): Card[] {
    return [...this.cards];
  }
}
