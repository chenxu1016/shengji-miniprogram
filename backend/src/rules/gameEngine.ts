import { Suit, CardValue, getPoints } from '../models/card';
import { Card } from '../models/card';
import { Deck } from '../models/deck';
import { Player } from '../models/player';
import { BidOption, BidState, createBidState, processBid as processBidRule } from './bidding';
import { validatePlay, PlayType, getReverseOptions, ReverseOption } from './playRules';
import { calculateRoundResult, isGameEnded, getNextLevel, getPrevLevel, calculateDeductionMultiplier } from './roundEnd';
import { TrickRecord, GameState, RoundResult } from './scoring';

// ============================================
// 游戏配置与状态接口
// ============================================

export interface GameConfig {
  numDecks?: number;
  reverseMode?: 'strict' | 'free';
}

export interface GameSession {
  id: string;
  state: GameState;
  players: Player[];
  deck: Deck;
  trumpSuit: Suit | null;
  level: CardValue;
  dealerIndex: number;
  firstBidderIndex: number;
  currentBidderIndex: number;
  bidState: BidState;
  reverseActive: boolean;
  reverseTarget: Suit;
  reversePairUsed: boolean;
  currentTrickWinner: number;
  tricks: TrickRecord[];
  currentTrick: { player: number; cards: Card[]; }[];
  leadCards: Card[] | null;
  leadType: PlayType | null;
  bidScore: number;
  finalBidderIndex: number;
  finalSuit: Suit | null;
  teamLevels: Map<number, number>;
  roundResult: RoundResult | null;
  config: GameConfig;
  log: string[];
  holeCards: Card[];
  leaderPoints: number;
  followerPoints: number;
  winnerTeam: string;
  leaderLevelUp: number;
  deductionMultiplier: number;
  newDealerTeam: number;
}

let sessionId = 0;

export function createGame(config: GameConfig = {}): GameSession {
  sessionId++;
  const numDecks = config.numDecks ?? 2;
  const deck = new Deck(numDecks);
  deck.shuffle();

  const players: Player[] = [];
  for (let i = 0; i < 4; i++) {
    players.push(new Player(i, '玩家' + (i + 1), i));
  }

  // 发牌
  if (numDecks === 2) {
    players.forEach(p => p.hand = []);
    deck.cards = [];
    deck.build(2);
    deck.shuffle();
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 25; j++) {
        players[i].addCard(deck.deal(1)[0]);
      }
    }
  } else {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 13; j++) {
        players[i].addCard(deck.deal(1)[0]);
      }
    }
  }

  const firstBidderIndex = Math.floor(Math.random() * 4);

  return {
    id: 'game_' + sessionId,
    state: GameState.BIDDING,
    players,
    deck,
    trumpSuit: null,
    level: CardValue.TWO,
    dealerIndex: Math.floor(Math.random() * 4),
    firstBidderIndex,
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
    config,
    log: ['游戏创建,首家叫分者: 玩家' + (firstBidderIndex + 1)],
    holeCards: [],
    leaderPoints: 0,
    followerPoints: 0,
    winnerTeam: "follower",
    leaderLevelUp: 0,
    deductionMultiplier: 1,
    newDealerTeam: 0,
  };
}

// ============================================
// 叫分阶段
// ============================================

export function makeBid(
  session: GameSession,
  playerIndex: number,
  bid: BidOption,
  suit?: Suit,
): { success: boolean; error?: string } {
  if (session.state !== GameState.BIDDING) {
    return { success: false, error: '当前不在叫分阶段' };
  }
  if (playerIndex !== session.currentBidderIndex) {
    return { success: false, error: '不是玩家' + (playerIndex + 1) + '的叫分回合' };
  }

  // 亮主需带王: 红桃/方片带大王, 黑桃/梅花带小王
  if (bid === BidOption.ZERO && suit) {
    const hasKing = session.players[playerIndex].hand.some(c => {
      if (suit === Suit.HEART || suit === Suit.DIAMOND) return c.value === CardValue.BIG_JOKER;
      return c.value === CardValue.SMALL_JOKER;
    });
    if (!hasKing) {
      const sname = suit === Suit.HEART ? "红桃" : suit === Suit.DIAMOND ? "方片" : suit === Suit.SPADE ? "黑桃" : "梅花";
      const kname = (suit === Suit.HEART || suit === Suit.DIAMOND) ? "大王" : "小王";
      return { success: false, error: "亮" + sname + "需要带" + kname };
    }
  }

  const result = validateBidForGame(bid, suit, session);
  if (!result.valid) {
    return { success: false, error: result.error! };
  }

  const bidResult = processBidRule(bid, session.bidState, playerIndex, suit);
  session.bidState = bidResult.newState;
  session.log.push('玩家' + (playerIndex + 1) + ' 叫' + (bid === BidOption.PASS ? '过' : bid + '分') + (suit ? getSuitName(suit) : ''));

  if (bidResult.isFinal) {
    session.bidScore = bid === BidOption.PASS ? 0 : parseInt(bid);
    session.finalBidderIndex = bidResult.finalBidder ?? session.bidState.highestBidder;
    session.finalSuit = bidResult.finalSuit ?? session.bidState.lastSuit;
    session.trumpSuit = session.finalSuit;
    session.level = getLevelFromTeamLevel(session.teamLevels.get(0) ?? 0);

    session.log.push('玩家' + (session.finalBidderIndex + 1) + ' 成为庄家,亮主' + getSuitName(session.trumpSuit!));

    session.reverseActive = true;
    session.reverseTarget = session.trumpSuit!;
    session.state = GameState.REVERSE;
    session.currentBidderIndex = (session.finalBidderIndex + 1) % 4;
  } else {
    session.currentBidderIndex = bidResult.newState.currentBidder;
  }

  return { success: true };
}

function validateBidForGame(
  bid: BidOption,
  suit: Suit | undefined,
  session: GameSession,
): { valid: boolean; error?: string } {
  if (session.bidState.lastBid === BidOption.THREE) {
    return { valid: false, error: '已经有人叫到3分,不能继续叫' };
  }

  let passesSinceLastBid = 0;
  for (let i = session.bidState.bidHistory.length - 1; i >= 0; i--) {
    if (session.bidState.bidHistory[i].bid === BidOption.PASS) {
      passesSinceLastBid++;
    } else {
      break;
    }
  }

  if (passesSinceLastBid >= 3 && bid === BidOption.PASS) {
    return { valid: false, error: '三家都已过牌,不能继续过' };
  }

  if (bid !== BidOption.PASS && bid !== BidOption.ZERO && session.bidState.lastBid !== BidOption.PASS) {
    const bidNum = parseInt(bid);
    const lastNum = parseInt(session.bidState.lastBid);
    if (bidNum <= lastNum) {
      return { valid: false, error: '叫分必须高于上家的' + lastNum + '分' };
    }
  }

  if (bid !== BidOption.PASS && bid !== BidOption.ZERO && !suit) {
    return { valid: false, error: '数字叫分需要指定主花色' };
  }

  return { valid: true };
}

function getSuitName(suit: Suit): string {
  switch (suit) {
    case Suit.DIAMOND: return '方片';
    case Suit.HEART: return '红桃';
    case Suit.CLUB: return '梅花';
    case Suit.SPADE: return '黑桃';
    default: return '未知';
  }
}

function getLevelFromTeamLevel(levelIdx: number): CardValue {
  const order: CardValue[] = [
    CardValue.TWO, CardValue.THREE, CardValue.FOUR,
    CardValue.FIVE, CardValue.SIX, CardValue.SEVEN,
    CardValue.EIGHT, CardValue.NINE, CardValue.TEN,
    CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE,
  ];
  return order[Math.min(levelIdx, order.length - 1)];
}

// ============================================
// 反主阶段
// ============================================

export function attemptReverse(
  session: GameSession,
  playerIndex: number,
  reverseOption: ReverseOption,
): { success: boolean; error?: string } {
  if (session.state !== GameState.REVERSE) {
    return { success: false, error: '当前不在反主阶段' };
  }
  if (playerIndex !== session.currentBidderIndex) {
    return { success: false, error: '不是玩家' + (playerIndex + 1) + '的反主回合' };
  }

  const player = session.players[playerIndex];
  const validOptions = getReverseOptions(player, session.reverseTarget, session.reversePairUsed);
  const isValid = validOptions.some(opt =>
    opt.cards.length === reverseOption.cards.length &&
    opt.newTrump === reverseOption.newTrump &&
    opt.isNoTrump === reverseOption.isNoTrump &&
    reverseOption.cards.every(rc => opt.cards.some(oc => oc.equals(rc)))
  );

  if (!isValid) {
    return { success: false, error: '无效的反主操作' };
  }

  session.trumpSuit = reverseOption.newTrump;
  session.finalSuit = reverseOption.newTrump;
  session.log.push('玩家' + (playerIndex + 1) + ' 反主为' + (reverseOption.isNoTrump ? '无主' : getSuitName(reverseOption.newTrump!)));

  if (reverseOption.cards.length >= 2) {
    session.reversePairUsed = true;
  }

  if (session.config.reverseMode === 'strict') {
    session.reverseActive = false;
    enterPlayingPhase(session);
  } else {
    session.currentBidderIndex = (playerIndex + 1) % 4;
    if (session.currentBidderIndex === session.finalBidderIndex) {
      session.reverseActive = false;
      enterPlayingPhase(session);
    }
  }

  return { success: true };
}

// ============================================
// 出牌阶段
// ============================================

export function playCards(
  session: GameSession,
  playerIndex: number,
  cards: Card[],
): { success: boolean; error?: string } {
  if (session.state !== GameState.PLAYING) {
    return { success: false, error: '当前不在出牌阶段' };
  }

  const player = session.players[playerIndex];

  const trickPlayerCount = session.currentTrick.filter(t => t.player !== -1).length;
  const expectedPlayer = trickPlayerCount === 0
    ? session.currentTrickWinner
    : ((session.currentTrick[trickPlayerCount - 1]?.player ?? -1) + 1) % 4;

  if (playerIndex !== expectedPlayer) {
    return { success: false, error: '不是玩家' + (playerIndex + 1) + '的出牌回合' };
  }

  const leadCards = session.leadCards;
  const leadType = session.leadType;
  const playResult = validatePlay(
    cards,
    leadCards,
    leadType,
    player,
    session.trumpSuit,
    session.level,
    session.currentTrickWinner,
  );

  if (!playResult.valid) {
    return { success: false, error: '出牌不合法' };
  }

  player.playCards(cards);
  session.currentTrick.push({ player: playerIndex, cards });

  if (session.currentTrick.length === 1) {
    session.leadCards = cards;
    session.leadType = playResult.type;
  }

  session.log.push('玩家' + (playerIndex + 1) + ' 出' + cards.map(c => c.toString()).join(','));

  if (session.currentTrick.length === 4) {
    completeTrick(session);
  }

  return { success: true };
}

function completeTrick(session: GameSession) {
  const lastCards = session.currentTrick.map(t => t.cards[t.cards.length - 1]);
  const leadCards = session.leadCards!;
  let trickPoints = 0;
  for (const trick of session.currentTrick) {
    for (const card of trick.cards) {
      trickPoints += getPoints(card.value);
    }
  }

  const leadType = session.leadType!;
  const winner = determineTrickWinner(lastCards, leadCards, session);

  session.tricks.push({
    winner,
    cards: session.currentTrick.map(t => t.cards),
    points: trickPoints,
  });

  session.currentTrickWinner = winner;
  session.currentTrick = [];
  session.leadCards = null;
  session.leadType = null;

  session.log.push('玩家' + (winner + 1) + ' 赢得此墩(' + trickPoints + '分)');

  if (session.tricks.length >= 13) {
    endRound(session);
  }
}

function determineTrickWinner(
  lastCards: Card[],
  leadCards: Card[],
  session: GameSession,
): number {
  let maxIdx = 0;
  let maxStrength = getCardStrength(lastCards[0], session);

  for (let i = 1; i < lastCards.length; i++) {
    const strength = getCardStrength(lastCards[i], session);
    if (strength > maxStrength) {
      maxStrength = strength;
      maxIdx = i;
    }
  }

  return maxIdx;
}

function getCardStrength(card: Card, session: GameSession): number {
  const isTrump = card.isTrump(session.trumpSuit, session.level);
  const leadSuit = session.leadCards?.[0]?.suit;

  if (isTrump && leadSuit && card.suit !== leadSuit) {
    return 1000 + getBaseStrength(card);
  }
  if (leadSuit && card.suit === leadSuit && !isTrump) {
    return 500 + getBaseStrength(card);
  }
  if (isTrump && leadSuit && card.suit === leadSuit) {
    return 800 + getBaseStrength(card);
  }
  return getBaseStrength(card);
}

function getBaseStrength(card: Card): number {
  if (card.value === CardValue.BIG_JOKER) return 200;
  if (card.value === CardValue.SMALL_JOKER) return 199;
  if (card.value === CardValue.FOUR) return 190;

  const order: CardValue[] = [
    CardValue.ACE, CardValue.KING, CardValue.QUEEN,
    CardValue.JACK, CardValue.TEN, CardValue.NINE,
    CardValue.EIGHT, CardValue.SEVEN, CardValue.SIX,
    CardValue.FIVE, CardValue.THREE, CardValue.TWO,
  ];
  const idx = order.indexOf(card.value);
  return idx >= 0 ? idx * 10 : 0;
}

// ============================================
// 结算阶段
// ============================================

function endRound(session: GameSession) {
  session.state = GameState.SCORING;

  const leaderTeam = session.finalBidderIndex % 2;
  let leaderPoints = 0;

  for (const trick of session.tricks) {
    if (trick.winner === session.finalBidderIndex ||
        trick.winner === (session.finalBidderIndex + 2) % 4) {
      leaderPoints += trick.points;
    }
  }

  // Apply 抠底 (deduction) multiplier if follower wins last trick
  let deductionMultiplier = 1;
  if (session.holeCards && session.holeCards.length > 0) {
    const lastTrickWinner = session.tricks.length > 0 ? 
      session.tricks[session.tricks.length - 1].winner : -1;
    
    // Check if follower won last trick
    const isFollowerWinningLastTrick = (lastTrickWinner !== session.finalBidderIndex && 
                                         lastTrickWinner !== getPartnerIndex(session.finalBidderIndex));
    
    if (isFollowerWinningLastTrick) {
      // Calculate hole card points
      let holePoints = 0;
      for (const card of session.holeCards) {
        holePoints += getPoints(card.value);
      }
      
      // Determine multiplier based on last trick type
      deductionMultiplier = calculateDeductionMultiplier(session.holeCards);
      
      // Add doubled points to follower
      const bonusPoints = holePoints * (deductionMultiplier - 1);
      leaderPoints -= bonusPoints;
      if (leaderPoints < 0) leaderPoints = 0;
      
      session.log.push('抠底成功! 底牌分数: ' + holePoints + ', 倍数: ' + deductionMultiplier);
    }
  }

  const roundResult = calculateRoundResult(
    session.bidScore,
    Math.max(0, leaderPoints),
    session.tricks,
    session.level,
    true,
    session.holeCards,
  );
  
  session.roundResult = roundResult;

  if (roundResult.winnerTeam === 'leader') {
    const leaderLevelIdx = session.teamLevels.get(leaderTeam) ?? 0;
    session.teamLevels.set(leaderTeam, leaderLevelIdx + roundResult.leaderLevelUp);
    session.log.push('庄家队成功!升' + Math.abs(roundResult.leaderLevelUp) + '级');
  } else {
    const followerTeam = 1 - leaderTeam;
    const followerLevelIdx = session.teamLevels.get(followerTeam) ?? 0;
    session.teamLevels.set(followerTeam, followerLevelIdx - roundResult.leaderLevelUp);
    session.log.push('闲家队成功!庄家降' + Math.abs(roundResult.leaderLevelUp) + '级');
  }

  if (isGameEnded(session.teamLevels)) {
    session.state = GameState.GAME_END;
    session.log.push('游戏结束!');
  } else {
    enterNewRound(session);
  }
}

function enterNewRound(session: GameSession) {
  const deck = new Deck(session.config.numDecks ?? 2);
  deck.shuffle();
  session.deck = deck;

  for (let i = 0; i < 4; i++) {
    session.players[i].hand = [];
  }

  if (session.config.numDecks === 2) {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 25; j++) {
        session.players[i].addCard(deck.deal(1)[0]);
      }
    }
  } else {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 13; j++) {
        session.players[i].addCard(deck.deal(1)[0]);
      }
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
  session.log.push('--- 新一轮开始,庄家: 玩家' + (session.finalBidderIndex + 1) + ' ---');
}

function enterPlayingPhase(session: GameSession) {
  // 庄家扣底牌: 每人25张后剩余8张作为底牌
  const holeCards = [];
  for (let i = 0; i < 8; i++) {
    if (session.deck.cards.length > 0) {
      const card = session.deck.cards.shift();
      if (card) holeCards.push(card);
    }
  }
  session.holeCards = holeCards;
  session.leaderPoints = 0;
  session.followerPoints = 0;
  session.deductionMultiplier = 1;

  session.state = GameState.PLAYING;
  session.currentTrickWinner = session.finalBidderIndex;
  session.currentTrick = [];
  session.leadCards = null;
  session.leadType = null;
  session.tricks = [];
  session.reverseActive = false;

  session.log.push('--- 出牌阶段开始,庄家: 玩家' + (session.finalBidderIndex + 1) + ' ---');
}

// ============================================
// 查询接口
// ============================================


function getPartnerIndex(playerIndex: number): number {
  return (playerIndex + 2) % 4;
}

export function getPlayerPlayableCards(
  session: GameSession,
  playerIndex: number,
): Card[][] {
  const player = session.players[playerIndex];
  if (!player) return [];

  const hand = [...player.hand];
  if (hand.length === 0) return [];

  if (session.currentTrick.length === 0) {
    return getAllValidPlays(hand, session.trumpSuit, session.level);
  }

  const leadCards = session.leadCards!;
  const leadType = session.leadType!;
  return getValidFollowPlays(hand, leadCards, leadType, session.trumpSuit, session.level);
}

function getAllValidPlays(hand: Card[], trumpSuit: Suit | null, level: CardValue): Card[][] {
  const plays: Card[][] = [];

  for (const card of hand) {
    plays.push([card]);
  }

  const groups = new Map<CardValue, Card[]>();
  for (const card of hand) {
    if (!groups.has(card.value)) groups.set(card.value, []);
    groups.get(card.value)!.push(card);
  }
  for (const [, cards] of groups) {
    if (cards.length >= 2) {
      plays.push(cards.slice(0, 2));
    }
  }
  for (const [, cards] of groups) {
    if (cards.length >= 3) {
      plays.push(cards.slice(0, 3));
    }
  }

  return plays;
}

function getValidFollowPlays(
  hand: Card[],
  leadCards: Card[],
  leadType: PlayType,
  trumpSuit: Suit | null,
  level: CardValue,
): Card[][] {
  const plays: Card[][] = [];
  const leadSuit = leadCards[0]?.suit;
  const isLeadTrump = leadCards[0]?.isTrump(trumpSuit, level);

  if (!isLeadTrump && leadSuit && leadSuit !== Suit.NONE) {
    const suitCards = hand.filter(c => c.suit === leadSuit);
    if (suitCards.length > 0) {
      return getPlaysMatchingSuit(suitCards, leadCards, leadType);
    }
  }

  const trumpCards = hand.filter(c => c.isTrump(trumpSuit, level));
  if (trumpCards.length > 0) {
    for (const card of trumpCards) {
      plays.push([card]);
    }
  }

  if (leadType === PlayType.SINGLE) {
    for (const card of hand) {
      plays.push([card]);
    }
  }

  return plays;
}

function getPlaysMatchingSuit(cards: Card[], _leadCards: Card[], _leadType: PlayType): Card[][] {
  const plays: Card[][] = [];
  for (const card of cards) {
    plays.push([card]);
  }
  return plays;
}

export function getSessionSummary(session: GameSession): {
  state: GameState;
  trumpSuit: Suit | null;
  level: CardValue;
  currentBidder: number;
  bidScore: number;
  tricksCompleted: number;
  teamLevels: number[];
  log: string[];
  holeCards: Card[];
} {
  return {
    state: session.state,
    trumpSuit: session.trumpSuit,
    level: session.level,
    currentBidder: session.currentBidderIndex,
    bidScore: session.bidScore,
    tricksCompleted: session.tricks.length,
    teamLevels: [
      session.teamLevels.get(0) ?? 0,
      session.teamLevels.get(1) ?? 0,
    ],
    log: session.log.slice(-20),
    holeCards: session.holeCards || [],
  };
}
