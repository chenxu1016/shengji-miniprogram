import { Suit, CardValue, KING_SUIT_MAP } from '../models/card';
import { Card } from '../models/card';
import { Player } from '../models/player';

export enum BidOption {
  PASS = 'pass',
  ZERO = '0',
  ONE = '1',
  TWO = '2',
  THREE = '3',
}

export interface BidResult {
  option: BidOption;
  suit?: Suit;       // 亮的主花色
  usesKing?: boolean; // 是否用了王来叫
}

/**
 * 叫分阶段
 * 
 * 规则:
 * - 从庄家下家开始顺时针轮流
 * - 叫分必须严格高于上一家(除非上一家已过)
 * - 叫0分=亮主, 叫1/2/3分=数字叫分
 * - 大王带方片/红桃, 小王带梅花/黑桃
 * - 有人叫到3分则结束
 * - 全过则重发
 */

export interface BidState {
  currentBidder: number;  // 当前叫分玩家索引
  lastBid: BidOption;
  lastSuit: Suit | null;
  highestBidder: number;
  bidHistory: { player: number; bid: BidOption; suit?: Suit }[];
}

export function createBidState(firstBidder: number): BidState {
  return {
    currentBidder: firstBidder,
    lastBid: BidOption.ZERO,
    lastSuit: null,
    highestBidder: -1,
    bidHistory: [],
  };
}

/**
 * 校验一次叫分是否合法
 */
export function validateBid(
  bid: BidOption,
  bidState: BidState,
  player: Player,
  trumpSuit: Suit | null,
  level: CardValue,
): { valid: boolean; result?: BidResult; error?: string } {
  // 检查是否已有人叫到3分
  if (bidState.lastBid === BidOption.THREE) {
    return { valid: false, result: undefined, error: '已经有人叫到3分,不能继续叫' };
  }

  // 检查是否全过(重置叫分)
  const consecutivePasses = bidState.bidHistory.filter(b => b.bid === BidOption.PASS).length;
  
  // 计算从上次有效叫分后的连续过牌数
  let passesSinceLastBid = 0;
  for (let i = bidState.bidHistory.length - 1; i >= 0; i--) {
    if (bidState.bidHistory[i].bid === BidOption.PASS) {
      passesSinceLastBid++;
    } else {
      break;
    }
  }

  // 如果已经3家都过,只能叫分(不能继续过)
  if (passesSinceLastBid >= 3 && bid !== BidOption.PASS) {
    // 允许叫分
  } else if (passesSinceLastBid >= 3 && bid === BidOption.PASS) {
    // 3家都过了,第4家不能再过 → 重发
    return { valid: false, result: undefined, error: '三家都已过牌,不能继续过,请叫分' };
  }

  // 检查叫分是否高于上家
  if (bid !== BidOption.PASS && bidState.lastBid !== BidOption.PASS) {
    const bidNum = parseInt(bid);
    const lastNum = parseInt(bidState.lastBid);
    if (bidNum <= lastNum) {
      return { valid: false, result: undefined, error: '叫分必须高于上家的' + lastNum + '分' };
    }
  }

  // 检查亮主牌是否存在
  if (bid !== BidOption.PASS && bid !== BidOption.ZERO) {
    // 1/2/3分需要亮主牌
    // TODO: 检查玩家是否有对应花色的牌
  }

  return { valid: true, result: { option: bid } };
}

/**
 * 处理叫分,返回新的叫分状态
 */
export function processBid(
  bid: BidOption,
  bidState: BidState,
  playerIndex: number,
  suit?: Suit,
): { newState: BidState; isFinal: boolean; finalBidder?: number; finalSuit?: Suit } {
  const newState = { ...bidState };
  newState.lastBid = bid;
  newState.currentBidder = (playerIndex + 1) % 4;

  if (bid !== BidOption.PASS) {
    newState.lastSuit = suit ?? null;
    newState.highestBidder = playerIndex;
    newState.bidHistory.push({ player: playerIndex, bid, suit });
  } else {
    newState.bidHistory.push({ player: playerIndex, bid: BidOption.PASS });
  }

  // 判断是否结束
  let isFinal = false;
  if (bid === BidOption.THREE) {
    isFinal = true;
  }

  // 检查是否 3 家连续过牌（自上次有效叫分后连续 3 个过牌即结束，最高叫分者赢）
  if (bid === BidOption.PASS) {
    let passesSinceLastBid = 0;
    for (let i = newState.bidHistory.length - 1; i >= 0; i--) {
      if (newState.bidHistory[i].bid === BidOption.PASS) {
        passesSinceLastBid++;
      } else {
        break;
      }
    }
    if (passesSinceLastBid >= 3) {
      isFinal = true;
    }
  }

  return {
    newState,
    isFinal,
    finalBidder: isFinal ? newState.highestBidder : undefined,
    finalSuit: isFinal ? newState.lastSuit ?? undefined : undefined,
  };
}

