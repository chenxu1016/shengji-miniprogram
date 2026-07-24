import { Suit, CardValue, getPoints, isPointCard } from '../models/card';
import { Card } from '../models/card';
import { TrickRecord, RoundResult } from './scoring';

/**
 * 升级对照表
 */
const LEVEL_PROMOTION = new Map<number, number>([
  [0, 1],  // 0分: 庄家成功升1级
  [1, 2],  // 1分: 庄家成功升2级
  [2, 3],  // 2分: 庄家成功升3级
  [3, 4],  // 3分: 庄家成功升4级
]);

const LEVEL_DEMOTION = new Map<number, number>([
  [0, 2],  // 0分: 庄家失败降2级(闲家升2级)
  [1, 2],  // 1分: 庄家失败降2级
  [2, 2],  // 2分: 庄家失败降2级
  [3, 2],  // 3分: 庄家失败降2级
]);

/**
 * 升级序列
 */
const LEVEL_ORDER: CardValue[] = [
  CardValue.TWO, CardValue.THREE, CardValue.FOUR,
  CardValue.FIVE, CardValue.SIX, CardValue.SEVEN,
  CardValue.EIGHT, CardValue.NINE, CardValue.TEN,
  CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE,
];

/**
 * 计算本轮结果
 */
export function calculateRoundResult(
  bidScore: number,        // 叫分数 (0-3)
  leaderPoints: number,    // 庄家队抓到的分
  tricks: TrickRecord[],   // 每墩记录
  currentLevel: CardValue, // 当前等级
): RoundResult {
  const followerPoints = 200 - leaderPoints; // 总分200分

  let winnerTeam: 'leader' | 'follower';
  let leaderLevelUp: number;

  if (leaderPoints >= getRequiredPoints(bidScore)) {
    // 庄家成功
    winnerTeam = 'leader';
    leaderLevelUp = LEVEL_PROMOTION.get(bidScore) ?? 1;
  } else {
    // 庄家失败
    winnerTeam = 'follower';
    leaderLevelUp = -(LEVEL_DEMOTION.get(bidScore) ?? 2); // 负数表示降级
  }

  return {
    leaderScore: leaderPoints,
    followerScore: followerPoints,
    winnerTeam,
    leaderLevelUp,
    tricks,
  };
}

function getRequiredPoints(bidScore: number): number {
  switch (bidScore) {
    case 0: return 0;
    case 1: return 40;
    case 2: return 60;
    case 3: return 80;
    default: return 0;
  }
}

/**
 * 计算下一级
 */
export function getNextLevel(currentLevel: CardValue): CardValue {
  const idx = LEVEL_ORDER.indexOf(currentLevel);
  if (idx === -1 || idx >= LEVEL_ORDER.length - 1) {
    return CardValue.ACE;
  }
  return LEVEL_ORDER[idx + 1];
}

/**
 * 计算上一级
 */
export function getPrevLevel(currentLevel: CardValue): CardValue {
  const idx = LEVEL_ORDER.indexOf(currentLevel);
  if (idx <= 0) {
    return CardValue.TWO;
  }
  return LEVEL_ORDER[idx - 1];
}

/**
 * 检查游戏是否结束 (有人达到A级并完成防守)
 */
export function isGameEnded(
  teamLevels: Map<number, number>,  // 队伍索引 -> 当前等级
): boolean {
  // 简化: 只要有人打到A级就算
  for (const level of teamLevels.values()) {
    if (LEVEL_ORDER[level] === CardValue.ACE) {
      return true;
    }
  }
  return false;
}
