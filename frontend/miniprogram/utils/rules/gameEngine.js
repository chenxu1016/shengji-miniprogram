const { Suit, CardValue, getPoints, Card } = require("./card");
const { Deck } = require("./deck");
const { Player } = require("./player");
const { BidOption, createBidState, validateBid, processBid, getSuitName } = require("./bidding");
const { PlayType, validatePlay, determineTrickWinner } = require("./playRules");
const { calculateRoundResult, isGameEnded, getNextLevel } = require("./roundEnd");

const GameState = {
  BIDDING: "bidding",
  REVERSE: "reverse",
  PLAYING: "playing",
  SCORING: "scoring",
  ROUND_END: "round_end",
  GAME_END: "game_end"
};

let sessionId = 0;

function createGame(numDecks) {
  numDecks = numDecks || 2;
  sessionId++;
  const deck = new Deck(numDecks);
  const players = [];
  for (let i = 0; i < 4; i++) {
    players.push(new Player(i, "玩家" + (i + 1), i));
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < (numDecks === 2 ? 25 : 13); j++) {
      players[i].addCard(deck.deal(1)[0]);
    }
  }
  const firstBidderIndex = Math.floor(Math.random() * 4);
  return {
    id: "game_" + sessionId,
    state: GameState.BIDDING,
    players: players,
    deck: deck,
    trumpSuit: null,
    level: CardValue.TWO,
    dealerIndex: Math.floor(Math.random() * 4),
    firstBidderIndex: firstBidderIndex,
    currentBidderIndex: firstBidderIndex,
    bidState: createBidState(firstBidderIndex),
    reverseActive: false,
    reverseTarget: Suit.NONE,
    reversePairUsed: false,
    currentTrickWinner: 0,
    tricks: [],
    currentTrick: [],
    leadCards: null,
    leadType: null,
    bidScore: 0,
    finalBidderIndex: -1,
    finalSuit: null,
    teamLevels: new Map([[0, 0], [1, 0]]),
    roundResult: null,
    log: ["游戏创建,首家叫分者: 玩家" + (firstBidderIndex + 1)]
  };
}

function makeBid(session, playerIndex, bid, suit) {
  if (session.state !== GameState.BIDDING) return { success: false, error: "当前不在叫分阶段" };
  if (playerIndex !== session.currentBidderIndex) return { success: false, error: "不是玩家" + (playerIndex + 1) + "的叫分回合" };
  const result = validateBid(bid, session.bidState, suit);
  if (!result.valid) return { success: false, error: result.error };
  const bidResult = processBid(bid, session.bidState, playerIndex, suit);
  session.bidState = bidResult.newState;
  session.log.push("玩家" + (playerIndex + 1) + " 叫" + (bid === BidOption.PASS ? "过" : bid + "分") + (suit ? " " + getSuitName(suit) : ""));
  if (bidResult.isFinal) {
    session.bidScore = bid === BidOption.PASS ? 0 : parseInt(bid);
    session.finalBidderIndex = bidResult.finalBidder != null ? bidResult.finalBidder : session.bidState.highestBidder;
    session.finalSuit = bidResult.finalSuit || session.bidState.lastSuit;
    session.trumpSuit = session.finalSuit;
    session.level = getLevelFromTeamLevel(session.teamLevels.get(0) || 0);
    session.log.push("玩家" + (session.finalBidderIndex + 1) + " 成为庄家,亮主" + getSuitName(session.trumpSuit));
    session.reverseActive = true;
    session.reverseTarget = session.trumpSuit;
    session.state = GameState.REVERSE;
    session.currentBidderIndex = (session.finalBidderIndex + 1) % 4;
  } else {
    session.currentBidderIndex = bidResult.newState.currentBidder;
  }
  return { success: true };
}

function getLevelFromTeamLevel(levelIdx) {
  const order = [CardValue.TWO, CardValue.THREE, CardValue.FOUR, CardValue.FIVE, CardValue.SIX, CardValue.SEVEN, CardValue.EIGHT, CardValue.NINE, CardValue.TEN, CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE];
  return order[Math.min(levelIdx, order.length - 1)];
}

function playCards(session, playerIndex, cards) {
  if (session.state !== GameState.PLAYING) return { success: false, error: "当前不在出牌阶段" };
  const player = session.players[playerIndex];
  const trickPlayerCount = session.currentTrick.length;
  const expectedPlayer = trickPlayerCount === 0 ? session.currentTrickWinner : (session.currentTrick[trickPlayerCount - 1].player + 1) % 4;
  if (playerIndex !== expectedPlayer) return { success: false, error: "不是玩家" + (playerIndex + 1) + "的出牌回合" };
  const playResult = validatePlay(cards, session.leadCards, session.leadType, player, session.trumpSuit, session.level, session.currentTrickWinner);
  if (!playResult.valid) return { success: false, error: "出牌不合法" };
  player.playCards(cards);
  session.currentTrick.push({ player: playerIndex, cards: cards });
  if (session.currentTrick.length === 1) {
    session.leadCards = cards;
    session.leadType = playResult.type;
  }
  session.log.push("玩家" + (playerIndex + 1) + " 出" + cards.map(function(c) { return c.toString(); }).join(","));
  if (session.currentTrick.length === 4) {
    completeTrick(session);
  }
  return { success: true };
}

function completeTrick(session) {
  const lastCards = session.currentTrick.map(function(t) { return t.cards[t.cards.length - 1]; });
  const leadCards = session.leadCards;
  let trickPoints = 0;
  for (let i = 0; i < session.currentTrick.length; i++) {
    for (let j = 0; j < session.currentTrick[i].cards.length; j++) {
      trickPoints += getPoints(session.currentTrick[i].cards[j].value);
    }
  }
  const winner = determineTrickWinner(lastCards, leadCards, session.trumpSuit, session.level);
  session.tricks.push({
    winner: winner,
    cards: session.currentTrick.map(function(t) { return t.cards; }),
    points: trickPoints
  });
  session.currentTrickWinner = winner;
  session.currentTrick = [];
  session.leadCards = null;
  session.leadType = null;
  session.log.push("玩家" + (winner + 1) + " 赢得此墩(" + trickPoints + "分)");
  if (session.tricks.length >= 13) {
    endRound(session);
  }
}

function endRound(session) {
  session.state = GameState.SCORING;
  const leaderTeam = session.finalBidderIndex % 2;
  let leaderPoints = 0;
  for (let i = 0; i < session.tricks.length; i++) {
    const trick = session.tricks[i];
    if (trick.winner === session.finalBidderIndex || trick.winner === (session.finalBidderIndex + 2) % 4) {
      leaderPoints += trick.points;
    }
  }
  const roundResult = calculateRoundResult(session.bidScore, leaderPoints, session.tricks, session.level);
  session.roundResult = roundResult;
  if (roundResult.winnerTeam === "leader") {
    const leaderLevelIdx = session.teamLevels.get(leaderTeam) || 0;
    session.teamLevels.set(leaderTeam, leaderLevelIdx + roundResult.leaderLevelUp);
    session.log.push("庄家队成功!升" + Math.abs(roundResult.leaderLevelUp) + "级");
  } else {
    const followerTeam = 1 - leaderTeam;
    const followerLevelIdx = session.teamLevels.get(followerTeam) || 0;
    session.teamLevels.set(followerTeam, followerLevelIdx - roundResult.leaderLevelUp);
    session.log.push("闲家队成功!庄家降" + Math.abs(roundResult.leaderLevelUp) + "级");
  }
  if (isGameEnded(session.teamLevels)) {
    session.state = GameState.GAME_END;
    session.log.push("游戏结束!");
  } else {
    enterNewRound(session);
  }
}

function enterNewRound(session) {
  session.deck = new Deck(2);
  for (let i = 0; i < 4; i++) {
    session.players[i].hand = [];
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 25; j++) {
      session.players[i].addCard(session.deck.deal(1)[0]);
    }
  }
  session.finalBidderIndex = (session.finalBidderIndex + 1) % 4;
  session.dealerIndex = session.finalBidderIndex;
  session.firstBidderIndex = (session.finalBidderIndex + 1) % 4;
  session.currentBidderIndex = session.firstBidderIndex;
  session.bidState = createBidState(session.firstBidderIndex);
  session.trumpSuit = null;
  session.tricks = [];
  session.currentTrick = [];
  session.leadCards = null;
  session.leadType = null;
  session.reverseActive = false;
  session.reversePairUsed = false;
  session.roundResult = null;
  session.state = GameState.BIDDING;
  session.log.push("--- 新一轮开始,庄家: 玩家" + (session.finalBidderIndex + 1) + " ---");
}

function enterPlayingPhase(session) {
  session.state = GameState.PLAYING;
  session.currentTrickWinner = session.finalBidderIndex;
  session.currentTrick = [];
  session.leadCards = null;
  session.leadType = null;
  session.tricks = [];
  session.reverseActive = false;
  session.log.push("--- 出牌阶段开始,庄家: 玩家" + (session.finalBidderIndex + 1) + " ---");
}

function getPlayerPlayableCards(session, playerIndex) {
  const player = session.players[playerIndex];
  if (!player) return [];
  const hand = player.hand.slice();
  if (hand.length === 0) return [];
  const plays = [];
  for (let i = 0; i < hand.length; i++) {
    plays.push([hand[i]]);
  }
  const groups = {};
  for (let i = 0; i < hand.length; i++) {
    const v = hand[i].value;
    if (!groups[v]) groups[v] = [];
    groups[v].push(hand[i]);
  }
  for (const v in groups) {
    if (groups[v].length >= 2) plays.push(groups[v].slice(0, 2));
    if (groups[v].length >= 3) plays.push(groups[v].slice(0, 3));
  }
  return plays;
}

function getSessionSummary(session) {
  return {
    state: session.state,
    trumpSuit: session.trumpSuit,
    level: session.level,
    currentBidder: session.currentBidderIndex,
    bidScore: session.bidScore,
    tricksCompleted: session.tricks.length,
    teamLevels: [session.teamLevels.get(0) || 0, session.teamLevels.get(1) || 0],
    log: session.log.slice(-20)
  };
}

module.exports = { GameState, createGame, makeBid, playCards, getSuitName, getPlayerPlayableCards, getSessionSummary, enterPlayingPhase };
