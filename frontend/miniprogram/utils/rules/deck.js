const { Suit, CardValue, Card } = require("./card");

class Deck {
  constructor(numDecks = 2) {
    this.cards = [];
    this.build(numDecks);
    this.shuffle();
  }

  build(numDecks) {
    this.cards = [];
    const suits = [Suit.DIAMOND, Suit.HEART, Suit.CLUB, Suit.SPADE];
    const values = [
      CardValue.TWO, CardValue.THREE, CardValue.FOUR, CardValue.FIVE,
      CardValue.SIX, CardValue.SEVEN, CardValue.EIGHT, CardValue.NINE,
      CardValue.TEN, CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE
    ];
    for (let d = 0; d < numDecks; d++) {
      for (const suit of suits) {
        for (const value of values) {
          this.cards.push(new Card(suit, value));
        }
      }
      this.cards.push(new Card(Suit.NONE, CardValue.BIG_JOKER));
      this.cards.push(new Card(Suit.NONE, CardValue.SMALL_JOKER));
    }
    return this.cards;
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal(count) {
    return this.cards.splice(0, count);
  }

  get remaining() {
    return this.cards.length;
  }
}

module.exports = { Deck };
