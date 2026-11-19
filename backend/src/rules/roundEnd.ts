import { Suit, CardValue, getPoints, isPointCard } from '../models/card';
import { Card } from '../models/card';
import { TrickRecord, RoundResult } from './scoring';

const LEVEL_ORDER: CardValue[] = [
  CardValue.TWO, CardValue.THREE, CardValue.FOUR,
  CardValue.FIVE, CardValue.SIX, CardValue.SEVEN,
  CardValue.EIGHT, CardValue.NINE, CardValue.TEN,
  CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE,
];

export function calculateLevelChange(
  followerPoints: number,
  isLeaderBidding: boolean,
): { leaderLevelUp: number; newDealerTeam: number } {
  let leaderLevelUp = 0;
  let newDealerTeam = 0;

  if (isLeaderBidding) {
    if (followerPoints === 0) { leaderLevelUp = 3; }
    else if (followerPoints >= 5 && followerPoints <= 35) { leaderLevelUp = 2; }
    else if (followerPoints >= 40 && followerPoints <= 75) { leaderLevelUp = 1; }
    else if (followerPoints === 80) { leaderLevelUp = 0; }
    else if (followerPoints >= 85 && followerPoints <= 115) { leaderLevelUp = 0; newDealerTeam = 1; }
    else if (followerPoints >= 120 && followerPoints <= 155) { leaderLevelUp = -1; newDealerTeam = 1; }
    else if (followerPoints >= 160 && followerPoints <= 195) { leaderLevelUp = -2; newDealerTeam = 1; }
    else { leaderLevelUp = -3; newDealerTeam = 1; }
  } else {
    if (followerPoints === 0) { leaderLevelUp = -3; newDealerTeam = 0; }
    else if (followerPoints >= 5 && followerPoints <= 35) { leaderLevelUp = -2; newDealerTeam = 0; }
    else if (followerPoints >= 40 && followerPoints <= 75) { leaderLevelUp = -1; newDealerTeam = 0; }
    else if (followerPoints === 80) { leaderLevelUp = 0; }
    else if (followerPoints >= 85 && followerPoints <= 115) { leaderLevelUp = 0; newDealerTeam = 0; }
    else if (followerPoints >= 120 && followerPoints <= 155) { leaderLevelUp = 1; newDealerTeam = 0; }
    else if (followerPoints >= 160 && followerPoints <= 195) { leaderLevelUp = 2; newDealerTeam = 0; }
    else { leaderLevelUp = 3; newDealerTeam = 0; }
  }

  leaderLevelUp = Math.max(-3, Math.min(3, leaderLevelUp));
  return { leaderLevelUp, newDealerTeam };
}

/**
 * 抠底倍数：按「抠底那一手牌」的牌型计算（不是按 8 张底牌）
 * 单张 ×2 / 对子 ×4 / 拖拉机 ×2^牌张数 / 甩牌取其中最大牌型，多个对子或拖拉机不累加
 */
export function calculateDeductionMultiplier(playCards: Card[]): number {
  if (!playCards || playCards.length === 0) return 2;
  if (playCards.length === 1) return 2;

  const order: CardValue[] = [
    CardValue.TWO, CardValue.THREE, CardValue.FOUR, CardValue.FIVE,
    CardValue.SIX, CardValue.SEVEN, CardValue.EIGHT, CardValue.NINE,
    CardValue.TEN, CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE,
  ];
  // 同花色同点数 >=2 张视为「对」，连续点数的对子组成拖拉机
  const bySuit = new Map<string, Map<CardValue, number>>();
  for (const c of playCards) {
    const s = String(c.suit);
    if (!bySuit.has(s)) bySuit.set(s, new Map());
    const m = bySuit.get(s)!;
    m.set(c.value, (m.get(c.value) || 0) + 1);
  }

  let maxPatternLen = 1;   // 单张1 / 对子2 / 拖拉机 2k
  for (const m of bySuit.values()) {
    const values = [...m.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    let run = 0;
    let prevIdx = -99;
    for (const v of values) {
      if ((m.get(v) || 0) < 2) { run = 0; prevIdx = -99; continue; }
      const idx = order.indexOf(v);
      run = (idx >= 0 && idx === prevIdx + 1) ? run + 2 : 2;
      prevIdx = idx;
      maxPatternLen = Math.max(maxPatternLen, run);
    }
  }
  return Math.pow(2, maxPatternLen);
}

export function calculateRoundResult(
  bidScore: number,
  leaderPoints: number,
  tricks: TrickRecord[],
  currentLevel: CardValue,
  isLeaderBidding: boolean,
  holeCards?: Card[],
  followerBonus: number = 0,
): RoundResult {
  // 2 副牌总分固定 200；抠底分数按规则全额加到闲家，不再从庄家分里扣并被截断
  const followerPoints = (200 - leaderPoints) + followerBonus;
  const { leaderLevelUp, newDealerTeam } = calculateLevelChange(followerPoints, isLeaderBidding);
  let winnerTeam: 'leader' | 'follower';
  if (leaderLevelUp > 0) { winnerTeam = 'leader'; }
  else if (leaderLevelUp < 0) { winnerTeam = 'follower'; }
  else { winnerTeam = followerPoints === 80 ? 'leader' : 'follower'; }
  return { leaderScore: leaderPoints, followerScore: followerPoints, winnerTeam, leaderLevelUp, tricks, newDealerTeam };
}

export function getNextLevel(currentLevel: CardValue): CardValue {
  const idx = LEVEL_ORDER.indexOf(currentLevel);
  if (idx === -1 || idx >= LEVEL_ORDER.length - 1) return CardValue.ACE;
  return LEVEL_ORDER[idx + 1];
}

export function getPrevLevel(currentLevel: CardValue): CardValue {
  const idx = LEVEL_ORDER.indexOf(currentLevel);
  if (idx <= 0) return CardValue.TWO;
  return LEVEL_ORDER[idx - 1];
}

export function isGameEnded(teamLevels: Map<number, number>): boolean {
  for (const level of teamLevels.values()) {
    if (LEVEL_ORDER[level] === CardValue.ACE) return true;
  }
  return false;
}
