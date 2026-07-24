const { Suit, CardValue, getPoints } = require("./card");

const PlayType = {
  INVALID: "invalid",
  SINGLE: "single",
  PAIR: "pair",
  TRIPLE: "triple",
  TRIPLE_ONE: "triple_one",
  TRIPLE_TWO: "triple_two",
  TRACTOR: "tractor",
  BOMB: "bomb",
  FIVE_PLUS: "five_plus",
  JOKER_PAIR: "joker_pair"
};

function detectPlayType(cards, trumpSuit, level) {
  if (cards.length === 1) return PlayType.SINGLE;
  if (cards.length === 2) {
    if (cards[0].value === CardValue.BIG_JOKER && cards[1].value === CardValue.SMALL_JOKER) return PlayType.JOKER_PAIR;
    if (cards[0].value === cards[1].value) return PlayType.PAIR;
  }
  if (cards.length === 3) {
    if (cards.every(c => c.value === cards[0].value)) return PlayType.TRIPLE;
  }
  if (cards.length === 4) {
    if (cards.every(c => c.value === cards[0].value)) return PlayType.BOMB;
    const triple = cards.filter(c => c.value === cards[0].value);
    if (triple.length === 3) return PlayType.TRIPLE_ONE;
  }
  if (cards.length >= 2 && cards.length % 2 === 0) {
    if (isTractor(cards, trumpSuit, level)) return PlayType.TRACTOR;
  }
  if (cards.length >= 5 && cards.every(c => c.value === cards[0].value)) return PlayType.FIVE_PLUS;
  return PlayType.INVALID;
}

function isTractor(cards, trumpSuit, level) {
  const isMain = cards[0].isTrump(trumpSuit, level);
  const groups = new Map();
  for (const card of cards) {
    if (!groups.has(card.value)) groups.set(card.value, []);
    groups.get(card.value).push(card);
  }
  for (const group of groups.values()) {
    if (group.length < 2) return false;
  }
  const values = [...new Set(cards.map(c => c.value))];
  if (values.length < 2) return false;
  const order = [CardValue.TWO, CardValue.THREE, CardValue.FOUR, CardValue.FIVE, CardValue.SIX, CardValue.SEVEN, CardValue.EIGHT, CardValue.NINE, CardValue.TEN, CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE];
  values.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (let i = 1; i < values.length; i++) {
    if (order.indexOf(values[i]) !== order.indexOf(values[i - 1]) + 1) return false;
  }
  return true;
}

function areCardsSameSuit(cards, leadCards) {
  const leadSuit = leadCards[0].suit;
  return cards.every(c => c.suit === leadSuit);
}

function compareCardArrays(playerCards, leadCards) {
  for (let i = 0; i < playerCards.length; i++) {
    if (playerCards[i].value !== leadCards[i].value) return 0;
  }
  return 1;
}

function validatePlay(cards, leadCards, leadType, player, trumpSuit, level, trickWinnerIndex) {
  if (cards.length === 0) return { valid: false, type: PlayType.INVALID };
  for (const card of cards) {
    if (!player.hand.find(c => c.equals(card))) return { valid: false, type: PlayType.INVALID };
  }
  const detectedType = detectPlayType(cards, trumpSuit, level);
  if (detectedType === PlayType.INVALID) return { valid: false, type: PlayType.INVALID };
  if (!leadCards || leadCards.length === 0) return { valid: true, type: detectedType };
  if (detectedType !== leadType) return { valid: false, type: detectedType };
  if (cards.length !== leadCards.length) return { valid: false, type: detectedType };
  return { valid: true, type: detectedType };
}

function determineTrickWinner(lastCards, leadCards, trumpSuit, level) {
  let maxIdx = 0;
  let maxStrength = getCardStrength(lastCards[0], trumpSuit, level, leadCards[0].suit);
  for (let i = 1; i < lastCards.length; i++) {
    const strength = getCardStrength(lastCards[i], trumpSuit, level, leadCards[0].suit);
    if (strength > maxStrength) {
      maxStrength = strength;
      maxIdx = i;
    }
  }
  return maxIdx;
}

function getCardStrength(card, trumpSuit, level, leadSuit) {
  const isTrump = card.isTrump(trumpSuit, level);
  const isLeadSuit = card.suit === leadSuit;
  if (isTrump && !isLeadSuit) return 1000 + getBaseStrength(card);
  if (isLeadSuit && !isTrump) return 500 + getBaseStrength(card);
  if (isTrump && isLeadSuit) return 800 + getBaseStrength(card);
  return getBaseStrength(card);
}

function getBaseStrength(card) {
  if (card.value === CardValue.BIG_JOKER) return 200;
  if (card.value === CardValue.SMALL_JOKER) return 199;
  if (card.value === CardValue.FOUR) return 190;
  const order = [CardValue.ACE, CardValue.KING, CardValue.QUEEN, CardValue.JACK, CardValue.TEN, CardValue.NINE, CardValue.EIGHT, CardValue.SEVEN, CardValue.SIX, CardValue.FIVE, CardValue.THREE, CardValue.TWO];
  const idx = order.indexOf(card.value);
  return idx >= 0 ? idx * 10 : 0;
}

module.exports = { PlayType, validatePlay, determineTrickWinner, detectPlayType, getSuitName: (s) => ({ diamond: "方片", heart: "红桃", club: "梅花", spade: "黑桃" }[s] || "") };
