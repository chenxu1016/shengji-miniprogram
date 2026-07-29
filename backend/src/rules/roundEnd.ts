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

export function calculateDeductionMultiplier(holeCards: Card[]): number {
  if (!holeCards || holeCards.length === 0) return 2;

  const valueCounts = new Map<CardValue, number>();
  for (const c of holeCards) { valueCounts.set(c.value, (valueCounts.get(c.value) || 0) + 1); }

  const pairCount = [...valueCounts.values()].filter(v => v >= 2).length;
  const uniqueValues = valueCounts.size;

  if (holeCards.length === 1) return 2;
  if (pairCount === uniqueValues && holeCards.length % 2 === 0) {
    return Math.pow(2, pairCount);
  }
  if (holeCards.length >= 4 && holeCards.length % 2 === 0) {
    const order: CardValue[] = [CardValue.TWO, CardValue.THREE, CardValue.FOUR,
      CardValue.FIVE, CardValue.SIX, CardValue.SEVEN,
      CardValue.EIGHT, CardValue.NINE, CardValue.TEN,
      CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE];

    const values = [...valueCounts.keys()];
    values.sort((a, b) => order.indexOf(a) - order.indexOf(b));

    let isConsecutive = true;
    for (let j = 1; j < values.length; j++) {
      if (order.indexOf(values[j]) !== order.indexOf(values[j - 1]) + 1) {
        isConsecutive = false;
        break;
      }
    }

    if (isConsecutive && pairCount > 0) {
      return Math.pow(2, pairCount);
    }
  }

  return 2;
}

export function calculateRoundResult(
  bidScore: number,
  leaderPoints: number,
  tricks: TrickRecord[],
  currentLevel: CardValue,
  isLeaderBidding: boolean,
  holeCards?: Card[],
): RoundResult {
  const followerPoints = 200 - leaderPoints;
  const { leaderLevelUp, newDealerTeam } = calculateLevelChange(followerPoints, isLeaderBidding);
  let deductionMultiplier = 1;
  if (holeCards && holeCards.length > 0) {
    deductionMultiplier = calculateDeductionMultiplier(holeCards);
  }
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
