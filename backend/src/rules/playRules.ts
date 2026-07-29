import { Suit, CardValue, isSuitStronger, KING_SUIT_MAP } from '../models/card';
import { Card } from '../models/card';
import { Player } from '../models/player';

// ============================================
// 牌型定义
// ============================================

export enum PlayType {
  INVALID = 'invalid',
  SINGLE = 'single',           // 单张
  PAIR = 'pair',               // 对子
  TRIPLE = 'triple',           // 三张
  TRIPLE_ONE = 'triple_one',   // 三带一
  TRIPLE_TWO = 'triple_two',   // 三带二
  TRACTOR = 'tractor',         // 拖拉机 (连续对子/三连等)
  BOMB = 'bomb',               // 炸弹 (4张及以上同点数)
  FIVE_PLUS = 'five_plus',     // 五张以上同牌型
  JOKER_PAIR = 'joker_pair',   // 大小王对
}

export interface PlayResult {
  valid: boolean;
  type: PlayType;
  cards: Card[];
  trumpSuit: Suit | null; // 该牌型的主花色(如果是主牌)
}

// ============================================
// 出牌合法性校验
// ============================================

/**
 * 校验出牌是否合法
 * 
 * 核心规则:
 * 1. 首家可以出任意合法牌型
 * 2. 后续玩家必须跟同花色(副牌跟副牌,主牌跟主牌)
 * 3. 没有该花色时,可以用主牌杀
 * 4. 主牌永远大于副牌
 * 5. 副牌之间同花色才能跟,不同花色不能压
 */
export function validatePlay(
  cards: Card[],
  leadCards: Card[] | null,     // 首家出的牌(整手)
  leadType: PlayType | null,     // 首家出的牌型
  currentPlayer: Player,
  trumpSuit: Suit | null,        // 当前主花色(null=无主)
  level: CardValue,              // 当前等级
  trickWinnerIndex: number | null, // 当前墩的领先者(首家为null)
): PlayResult {
  
  // 空牌无效
  if (cards.length === 0) {
    return { valid: false, type: PlayType.INVALID, cards: [], trumpSuit };
  }

  // 检查玩家确实有这些牌
  for (const card of cards) {
    if (!currentPlayer.hand.find(c => c.equals(card))) {
      return { valid: false, type: PlayType.INVALID, cards, trumpSuit };
    }
  }

  // 检测牌型
  const detectedType = detectPlayType(cards, trumpSuit, level);

  // 首家出牌(无leadCards): 牌型必须合法
  if (!leadCards || leadCards.length === 0) {
    if (detectedType === PlayType.INVALID) {
      return { valid: false, type: PlayType.INVALID, cards, trumpSuit };
    }
    return { valid: true, type: detectedType, cards, trumpSuit };
  }

  // ===== 跟牌阶段（标准升级规则：有该花色必须跟，不够/没有可垫任意牌） =====

  // 张数必须与首家一致
  if (cards.length !== leadCards.length) {
    return { valid: false, type: PlayType.INVALID, cards, trumpSuit };
  }

  const leadIsTrump = leadCards.every(c => c.isTrump(trumpSuit, level));
  const leadSuit = leadCards[0].suit;

  // 玩家手中属于"首家花色组"的牌（主牌组 或 某个副牌花色组）
  const inGroup = (c: Card) => leadIsTrump
    ? c.isTrump(trumpSuit, level)
    : (!c.isTrump(trumpSuit, level) && c.suit === leadSuit);

  const handInGroup = currentPlayer.hand.filter(inGroup).length;
  const playedInGroup = cards.filter(inGroup).length;

  // 必须尽量跟该花色组：出的组内牌数 >= min(手里组内牌数, 需出张数)
  const required = Math.min(handInGroup, cards.length);
  if (playedInGroup < required) {
    return { valid: false, type: PlayType.INVALID, cards, trumpSuit }; // 有牌不跟，违规
  }

  // 合法跟牌/垫牌（牌型不要求与首家一致——垫牌可以是任意组合）
  return { valid: true, type: detectedType === PlayType.INVALID ? leadType! : detectedType, cards, trumpSuit };
}

/**
 * 判断是否可以跟牌或压牌
 * 
 * 核心规则:
 * - 如果当前玩家有跟牌花色 → 必须跟该花色
 * - 如果没有该花色 → 可以用主牌杀
 * - 主牌 > 副牌
 */
function canFollowOrBeat(
  playerCards: Card[],
  leadCards: Card[],
  trumpSuit: Suit | null,
  level: CardValue,
): boolean {
  // 无主情况: 纯比点数
  if (trumpSuit === Suit.NONE) {
    return compareCardArrays(playerCards, leadCards) > 0;
  }

  const playerAreTrump = playerCards.every(c => c.isTrump(trumpSuit, level));
  const leadAreTrump = leadCards.every(c => c.isTrump(trumpSuit, level));

  // 情况1: 玩家出的全是主牌, 首家出的全是主牌 → 比大小
  if (playerAreTrump && leadAreTrump) {
    return compareCardArrays(playerCards, leadCards) > 0;
  }

  // 情况2: 玩家出的全是主牌, 首家出的是副牌 → 主牌可以压(前提是玩家没有副牌跟)
  if (playerAreTrump && !leadAreTrump) {
    // 检查玩家是否有副牌能跟
    const leadSuit = leadCards[0].suit;
    const hasLeadSuit = playerCards.some(c => !c.isTrump(trumpSuit, level) && c.suit === leadSuit);
    if (hasLeadSuit) return false; // 有牌不跟,违规
    return true; // 没有该副牌花色,用主牌杀合法
  }

  // 情况3: 玩家出的是副牌, 首家出的也是副牌 → 同花色跟牌,比大小
  if (!playerAreTrump && !leadAreTrump) {
    return compareCardArrays(playerCards, leadCards) > 0;
  }

  // 情况4: 玩家出的是副牌, 首家出的是主牌 → 必须跟主牌,不能降
  if (!playerAreTrump && leadAreTrump) {
    const hasLeadSuit = playerCards.some(c => c.isTrump(trumpSuit, level));
    if (!hasLeadSuit) return false; // 没有主牌跟
    return compareCardArrays(playerCards, leadCards) > 0;
  }

  return false;
}

/**
 * 比较两组牌的大小 (按每组最后一张牌比较)
 * 返回 >0 表示第一组大, <0 表示第二组大, =0 相等
 */
function compareCardArrays(a: Card[], b: Card[]): number {
  const aCard = getLastSignificantCard(a);
  const bCard = getLastSignificantCard(b);
  return compareCards(aCard, bCard);
}

function getLastSignificantCard(cards: Card[]): Card {
  return cards[cards.length - 1];
}

/**
 * 比较两张牌的大小
 */
function compareCards(a: Card, b: Card): number {
  const aVal = getCardStrength(a);
  const bVal = getCardStrength(b);
  return aVal - bVal;
}

/**
 * 获取牌的强度值(越大越强)
 */
function getCardStrength(card: Card): number {
  // 大小王
  if (card.value === CardValue.BIG_JOKER) return 200;
  if (card.value === CardValue.SMALL_JOKER) return 199;

  // 4永远是主牌, 强度高于普通主牌
  if (card.value === CardValue.FOUR) return 190;

  const order = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '3', '2'];
  const valIdx = order.indexOf(card.value);
  const base = valIdx >= 0 ? valIdx * 10 : 0;

  // 主牌加成
  if (card.suit !== Suit.NONE) {
    return base + 50 + (card.suit === Suit.SPADE ? 3 : card.suit === Suit.CLUB ? 2 : card.suit === Suit.HEART ? 1 : 0);
  }

  return base;
}

/**
 * 检查两组牌是否为相同花色
 */
function areCardsSameSuit(a: Card[], b: Card[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i].suit !== b[i].suit) return false;
  }
  return true;
}

// ============================================
// 牌型检测
// ============================================

export function detectPlayType(cards: Card[], trumpSuit: Suit | null, level: CardValue): PlayType {
  if (cards.length === 0) return PlayType.INVALID;

  // 大小王对
  if (cards.length === 2 && isJokerPair(cards)) {
    return PlayType.JOKER_PAIR;
  }

  // 单张
  if (cards.length === 1) return PlayType.SINGLE;

  // 炸弹 (4张及以上同点数)
  if (cards.length >= 4 && isSameValue(cards)) return PlayType.BOMB;

  // 对子
  if (cards.length === 2 && isSameValue(cards)) return PlayType.PAIR;

  // 三张
  if (cards.length === 3 && isSameValue(cards)) return PlayType.TRIPLE;

  // 三带一
  if (cards.length === 4) {
    if (isTripleWithOne(cards)) return PlayType.TRIPLE_ONE;
    if (isTripleWithTwo(cards)) return PlayType.TRIPLE_TWO;
  }

  // 拖拉机 (连续对子/三连)
  if (cards.length >= 2 && cards.length % 2 === 0) {
    if (isTractor(cards, trumpSuit, level)) return PlayType.TRACTOR;
  }
  if (cards.length >= 3 && cards.length % 3 === 0) {
    if (isTractor(cards, trumpSuit, level)) return PlayType.TRACTOR;
  }

  // 五张以上同牌型
  if (cards.length >= 5 && isSameValue(cards)) return PlayType.FIVE_PLUS;

  return PlayType.INVALID;
}

function isJokerPair(cards: Card[]): boolean {
  const vals = cards.map(c => c.value);
  return vals.includes(CardValue.BIG_JOKER) && vals.includes(CardValue.SMALL_JOKER);
}

function isSameValue(cards: Card[]): boolean {
  const first = cards[0].value;
  return cards.every(c => c.value === first);
}

function isTripleWithOne(cards: Card[]): boolean {
  const triple = cards.filter(c => c.value === cards[0].value);
  return triple.length === 3 && cards.length === 4;
}

function isTripleWithTwo(cards: Card[]): boolean {
  const triple = cards.filter(c => c.value === cards[0].value);
  return triple.length === 3 && cards.length === 5;
}

function isTractor(cards: Card[], trumpSuit: Suit | null, level: CardValue): boolean {
  // 拖拉机必须是连续的同花色牌(主牌或副牌均可)
  const isMain = cards[0].isTrump(trumpSuit, level);
  
  // 分组检查
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const key = card.value;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(card);
  }

  // 每组至少2张
  for (const group of groups.values()) {
    if (group.length < 2) return false;
  }

  // 检查花色一致性
  const suitsPerValue = new Map<CardValue, Set<Suit>>();
  for (const card of cards) {
    if (!suitsPerValue.has(card.value)) suitsPerValue.set(card.value, new Set());
    suitsPerValue.get(card.value)!.add(card.suit);
  }

  // 检查点数连续
  const order: CardValue[] = [CardValue.TWO, CardValue.THREE, CardValue.FOUR, CardValue.FIVE,
    CardValue.SIX, CardValue.SEVEN, CardValue.EIGHT, CardValue.NINE, CardValue.TEN,
    CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE];
  
  const values = [...new Set(cards.map(c => c.value))];
  if (values.length < 2) return false;

  // 排序
  values.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  // 检查连续
  for (let i = 1; i < values.length; i++) {
    if (order.indexOf(values[i]) !== order.indexOf(values[i - 1]) + 1) {
      return false;
    }
  }

  return true;
}

// ============================================
// 反主逻辑
// ============================================

export interface ReverseOption {
  cards: Card[];
  newTrump: Suit | null;
  isNoTrump: boolean;
}

/**
 * 获取所有合法的反主选项
 */
export function getReverseOptions(
  player: Player,
  currentTrump: Suit,
  pairAlreadyUsed: boolean, // 是否已有人用一对反过
): ReverseOption[] {
  const options: ReverseOption[] = [];

  if (pairAlreadyUsed) {
    // 已有一对反过,只能用大小王对反无主
    const bigJoker = player.hand.find(c => c.value === CardValue.BIG_JOKER);
    const smallJoker = player.hand.find(c => c.value === CardValue.SMALL_JOKER);
    if (bigJoker && smallJoker) {
      options.push({
        cards: [bigJoker, smallJoker],
        newTrump: Suit.NONE,
        isNoTrump: true,
      });
    }
    return options;
  }

  // 用一对牌反主
  const suitValues = new Map<CardValue, Card[]>();
  for (const card of player.hand) {
    if (!suitValues.has(card.value)) suitValues.set(card.value, []);
    suitValues.get(card.value)!.push(card);
  }

  for (const [value, cards] of suitValues) {
    if (cards.length >= 2) {
      // 可以反任意花色(花色无大小之分)
      for (const suit of [Suit.DIAMOND, Suit.HEART, Suit.CLUB, Suit.SPADE]) {
        if (suit !== currentTrump) {
          options.push({
            cards: cards.slice(0, 2),
            newTrump: suit,
            isNoTrump: false,
          });
        }
      }
    }
  }

  // 用王反主
  const bigJoker = player.hand.find(c => c.value === CardValue.BIG_JOKER);
  const smallJoker = player.hand.find(c => c.value === CardValue.SMALL_JOKER);

  if (bigJoker) {
    for (const suit of KING_SUIT_MAP.get(CardValue.BIG_JOKER)!) {
      if (suit !== currentTrump) {
        options.push({
          cards: [bigJoker],
          newTrump: suit,
          isNoTrump: false,
        });
      }
    }
  }

  if (smallJoker) {
    for (const suit of KING_SUIT_MAP.get(CardValue.SMALL_JOKER)!) {
      if (suit !== currentTrump) {
        options.push({
          cards: [smallJoker],
          newTrump: suit,
          isNoTrump: false,
        });
      }
    }
  }

  // 大小王对反无主
  if (bigJoker && smallJoker) {
    options.push({
      cards: [bigJoker, smallJoker],
      newTrump: Suit.NONE,
      isNoTrump: true,
    });
  }

  return options;
}
