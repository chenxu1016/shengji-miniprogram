const { Suit, CardValue } = require("./card");

class Player {
  constructor(id, name, seatIndex) {
    this.id = id;
    this.name = name;
    this.hand = [];
    this.team = "follower";
    this.seatIndex = seatIndex;
  }

  addCard(card) {
    this.hand.push(card);
  }

  sortHand(trumpSuit, level) {
    this.hand.sort((a, b) => this.compareCard(a, b, trumpSuit, level));
  }

  compareCard(a, b, trumpSuit, level) {
    const aTrump = a.isTrump(trumpSuit, level);
    const bTrump = b.isTrump(trumpSuit, level);
    if (aTrump && !bTrump) return -1;
    if (!aTrump && bTrump) return 1;
    const aOrder = this.getCardOrder(a, level);
    const bOrder = this.getCardOrder(b, level);
    if (aOrder !== bOrder) return bOrder - aOrder;
    return (a.suit < b.suit ? -1 : 1);
  }

  getCardOrder(card, level) {
    if (card.value === CardValue.BIG_JOKER) return 100;
    if (card.value === CardValue.SMALL_JOKER) return 99;
    if (card.value === CardValue.FOUR) return 98;
    if (card.value === level) return 97;
    const order = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "3", "2"];
    const idx = order.indexOf(card.value);
    return idx >= 0 ? idx : 0;
  }

  playCard(card) {
    const idx = this.hand.findIndex(c => c.equals(card));
    if (idx === -1) return null;
    return this.hand.splice(idx, 1)[0];
  }

  playCards(cards) {
    const played = [];
    for (const card of cards) {
      const idx = this.hand.findIndex(c => c.equals(card));
      if (idx !== -1) {
        played.push(this.hand.splice(idx, 1)[0]);
      }
    }
    return played;
  }

  hasSuit(suit) {
    return this.hand.some(c => c.suit === suit);
  }

  getSuits(suit) {
    return this.hand.filter(c => c.suit === suit);
  }
}

module.exports = { Player };
