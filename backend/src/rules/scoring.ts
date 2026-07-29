import { Suit, CardValue, getPoints, isPointCard } from '../models/card';
import { Card } from '../models/card';

export enum GameState {
  BIDDING = 'bidding',
  REVERSE = 'reverse',
  PLAYING = 'playing',
  SCORING = 'scoring',
  ROUND_END = 'round_end',
  GAME_END = 'game_end',
}

export interface TrickRecord {
  winner: number;    // 玩家索引 0-3
  cards: Card[][];   // 每家出的牌 [玩家0, 玩家1, 玩家2, 玩家3]
  points: number;    // 本墩的分值
}

export interface RoundResult {
  leaderScore: number;   // 庄家队抓分
  followerScore: number; // 闲家队抓分
  winnerTeam: 'leader' | 'follower';
  leaderLevelUp: number; // 庄家升几级
  tricks: TrickRecord[];
  newDealerTeam?: number; // 0=庄继续坐庄, 1=闲家上台
}

/**
 * 计算一墩牌的得分
 * 分牌: 5=5分, 10=10分, K=10分
 */
export function calculateTrickPoints(cardsByPlayer: Card[][]): number {
  let points = 0;
  for (const playerCards of cardsByPlayer) {
    for (const card of playerCards) {
      points += getPoints(card.value);
    }
  }
  return points;
}

/**
 * 判断谁赢了这一墩
 * 规则: 首家出的牌型决定跟牌要求, 最大的牌赢墩
 */
export function determineTrickWinner(
  cardsByPlayer: Card[],   // 四家出的最后一张牌(每组牌的最后一张)
  leadCards: Card[],
  trumpSuit: Suit | null,
  level: CardValue,
  leadType: string,
): number {
  // 简化: 比较每家出的最后一张牌的强度
  let maxIdx = 0;
  let maxStrength = getCardStrength(cardsByPlayer[0], trumpSuit, level, leadCards[0].suit, leadType);

  for (let i = 1; i < cardsByPlayer.length; i++) {
    const strength = getCardStrength(cardsByPlayer[i], trumpSuit, level, leadCards[0].suit, leadType);
    if (strength > maxStrength) {
      maxStrength = strength;
      maxIdx = i;
    }
  }

  return maxIdx;
}

function getCardStrength(
  card: Card,
  trumpSuit: Suit | null,
  level: CardValue,
  leadSuit: Suit,
  leadType: string,
): number {
  const isTrump = card.isTrump(trumpSuit, level);
  const isLeadSuit = card.suit === leadSuit;

  if (isTrump && !isLeadSuit) {
    // 主牌压副牌
    return 1000 + getBaseStrength(card);
  }
  if (isLeadSuit && !isTrump) {
    // 同花色跟牌
    return 500 + getBaseStrength(card);
  }
  if (isTrump && isLeadSuit) {
    // 主牌跟主牌
    return 800 + getBaseStrength(card);
  }
  // 都不是
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
