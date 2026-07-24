const { Suit, CardValue } = require("./card");

const BidOption = {
  PASS: "pass",
  ZERO: "0",
  ONE: "1",
  TWO: "2",
  THREE: "3"
};

function createBidState(firstBidder) {
  return {
    currentBidder: firstBidder,
    lastBid: BidOption.ZERO,
    lastSuit: null,
    highestBidder: -1,
    bidHistory: []
  };
}

function validateBid(bid, bidState, suit) {
  if (bidState.lastBid === BidOption.THREE) {
    return { valid: false, error: "已经有人叫到3分" };
  }

  let passesSinceLastBid = 0;
  for (let i = bidState.bidHistory.length - 1; i >= 0; i--) {
    if (bidState.bidHistory[i].bid === BidOption.PASS) {
      passesSinceLastBid++;
    } else {
      break;
    }
  }

  if (passesSinceLastBid >= 3 && bid === BidOption.PASS) {
    return { valid: false, error: "三家都已过牌,不能继续过" };
  }

  if (bid !== BidOption.PASS && bid !== BidOption.ZERO && bidState.lastBid !== BidOption.PASS) {
    const bidNum = parseInt(bid);
    const lastNum = parseInt(bidState.lastBid);
    if (bidNum <= lastNum) {
      return { valid: false, error: "叫分必须高于上家的" + lastNum + "分" };
    }
  }

  if (bid !== BidOption.PASS && bid !== BidOption.ZERO && !suit) {
    return { valid: false, error: "数字叫分需要指定主花色" };
  }

  return { valid: true };
}

function processBid(bid, bidState, playerIndex, suit) {
  const newState = Object.assign({}, bidState);
  newState.lastBid = bid;
  newState.currentBidder = (playerIndex + 1) % 4;

  if (bid !== BidOption.PASS) {
    newState.lastSuit = suit || null;
    newState.highestBidder = playerIndex;
    newState.bidHistory.push({ player: playerIndex, bid: bid, suit: suit });
  } else {
    newState.bidHistory.push({ player: playerIndex, bid: BidOption.PASS });
  }

  let isFinal = false;
  if (bid === BidOption.THREE) {
    isFinal = true;
  }

  if (bidState.bidHistory.length >= 3) {
    const lastThree = bidState.bidHistory.slice(-3);
    if (lastThree.every(b => b.bid === BidOption.PASS)) {
      if (bid !== BidOption.PASS) {
        isFinal = true;
      }
    }
  }

  return {
    newState: newState,
    isFinal: isFinal,
    finalBidder: isFinal ? newState.highestBidder : undefined,
    finalSuit: isFinal ? (newState.lastSuit || undefined) : undefined
  };
}

function getSuitName(suit) {
  const names = { diamond: "方片", heart: "红桃", club: "梅花", spade: "黑桃" };
  return names[suit] || "未知";
}

module.exports = { BidOption, createBidState, validateBid, processBid, getSuitName };
