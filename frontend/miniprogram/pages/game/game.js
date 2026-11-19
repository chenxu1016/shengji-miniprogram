var wsClient = null;
var levelNames = {two:"2",three:"3",four:"4",five:"5",six:"6",seven:"7",eight:"8",nine:"9",ten:"10",jack:"J",queen:"Q",king:"K",ace:"A"};
var suitNames = {spade:"黑桃",heart:"红桃",club:"梅花",diamond:"方块",none:"无",null:"无"};

// ============ 单张牌 → 手牌 UI 项（三段式：顶小字/中数字+小花/底大花）============
// 拆 card 为 WXML 渲染所需的字段，让堆叠时也能看到花色
function _suitChar(suit) {
  if (suit === "spade")   return "\u2660";   // ♠
  if (suit === "heart")   return "\u2665";   // ♥
  if (suit === "club")    return "\u2663";   // ♣
  if (suit === "diamond") return "\u2666";   // ♦
  return "";
}
function _rankChar(value) {
  if (!value) return "";
  if (value === "big_joker")   return "JOKER";
  if (value === "small_joker") return "JOKER";
  if (value === "ace")   return "A";
  if (value === "king")  return "K";
  if (value === "queen") return "Q";
  if (value === "jack")  return "J";
  if (value === "ten")   return "10";
  if (value === "two")   return "2";
  if (value === "three") return "3";
  if (value === "four")  return "4";
  if (value === "five")  return "5";
  if (value === "six")   return "6";
  if (value === "seven") return "7";
  if (value === "eight") return "8";
  if (value === "nine")  return "9";
  return value;
}
function cardToHandItem(c, idx) {
  if (!c) return null;
  var isJoker = (c.value === "big_joker" || c.value === "small_joker");
  var topLabel = isJoker ? "王" : _suitChar(c.suit);
  var rank = isJoker ? (c.value === "big_joker" ? "大" : "小") : _rankChar(c.value);
  var sChar = isJoker ? (c.value === "big_joker" ? "\u2665" : "\u2660") : _suitChar(c.suit);  // 大王♥ 小王♠
  return {
    card: c,
    key: (c.suit || "x") + "_" + (c.value || "x") + "_" + (idx || 0),
    display: c.display || c.toString(),
    topLabel: topLabel,
    rankChar: rank,
    suitChar: sChar,
    suit: c.suit || "spade",
    isJoker: isJoker,
    isRed: isJoker || c.suit === "heart" || c.suit === "diamond",
    cornerRank: rank,
    cornerSuit: sChar,
    bigSuit: isJoker ? (c.value === "big_joker" ? "大" : "小") : sChar,
    groupStart: false,
    selected: false,
    playable: true,
    dealing: false
  };
}

// ============ 手牌视觉：按「王 / 级牌 / 主花色 / 四种副花色」分组留白 ============
// 多乐升级式排布：一叠一叠分隔开，而不是 25 张连成密不透风的一条。
var HAND_CARD_W = 100;   // 单张牌宽(rpx)
var HAND_STEP   = 40;    // 每张露出的宽度(rpx)
var HAND_GAP    = 26;    // 组与组之间的额外间距(rpx)
var HAND_PAD    = 36;    // 手牌轨道左右留白(rpx)

function _handSectionKey(c, trump, level) {
  if (c.value === "big_joker" || c.value === "small_joker") return "joker";
  if (level && c.value === level) return "level";
  if (trump && c.suit === trump) return "trump";
  return "suit_" + (c.suit || "none");
}

// 给已排序的手牌打上 groupStart，并算出 scroll-view 轨道总宽
function decorateHand(items, trumpSuit, level) {
  var trump = (trumpSuit && trumpSuit !== "none") ? trumpSuit : null;
  var prev = null, groups = 0;
  for (var i = 0; i < items.length; i++) {
    var c = items[i].card || {};
    var key = _handSectionKey(c, trump, level);
    var isStart = (i > 0 && key !== prev);
    items[i].groupStart = isStart;
    if (isStart) groups++;
    prev = key;
  }
  var width = items.length
    ? HAND_PAD * 2 + HAND_CARD_W + (items.length - 1) * HAND_STEP + groups * HAND_GAP
    : HAND_PAD * 2;
  return { items: items, width: width };
}

function _trackWidth(n, groups) {
  return n ? HAND_PAD * 2 + HAND_CARD_W + (n - 1) * HAND_STEP + (groups || 0) * HAND_GAP : HAND_PAD * 2;
}

// ============ 手牌排序（发牌后按升级规则排列）============
// 分组优先级：1大王 2小王 3级牌 4主花色 5副牌
// 组内：先按花色（黑桃>红桃>梅花>方块），同花色按点数 A>K>Q>...>2
// 同花色同点数自然相邻 → 对子/拖拉机自动靠在一起
var VALUE_RANK = {big_joker:99,small_joker:98,ace:14,king:13,queen:12,jack:11,ten:10,nine:9,eight:8,seven:7,six:6,five:5,four:4,three:3,two:2};
var SUIT_RANK = {spade:4,heart:3,club:2,diamond:1,none:0};

function _handGroup(c, trump, level) {
  if (c.value === "big_joker") return 1;
  if (c.value === "small_joker") return 2;
  if (level && c.value === level) return 3;          // 级牌（当前级别的所有牌）
  if (trump && c.suit === trump) return 4;           // 主花色（非级牌非王）
  return 5;                                           // 副牌
}

// 单张比较器：供最终排序与「逐张发牌时插入归位」共用，保证发牌途中和发完顺序一致
// 分组：大王→小王→级牌→主花色→副牌；同组先按花色分开，同花色内点数由大到小
function compareHandCards(a, b, trump, level) {
  var ag = _handGroup(a, trump, level), bg = _handGroup(b, trump, level);
  if (ag !== bg) return ag - bg;                    // 小组排前（大王最左）
  var as = SUIT_RANK[a.suit] || 0, bs = SUIT_RANK[b.suit] || 0;
  if (as !== bs) return bs - as;                    // 黑桃优先排最左
  return (VALUE_RANK[b.value] || 0) - (VALUE_RANK[a.value] || 0);  // 大点排前
}

function sortHandByRule(hand, trumpSuit, level) {
  if (!hand || !hand.length) return hand;
  var trump = (trumpSuit && trumpSuit !== "none") ? trumpSuit : null;
  return hand.slice().sort(function(a, b) { return compareHandCards(a, b, trump, level); });
}

// 发牌途中：把新到手的一张插进已理好的手牌中的正确位置（自动理牌）
function insertHandCard(items, item, trump, level) {
  var out = items.slice();
  var i = 0;
  while (i < out.length && compareHandCards(out[i].card || {}, item.card || {}, trump, level) < 0) i++;
  out.splice(i, 0, item);
  return out;
}

// 打乱发牌顺序（Fisher-Yates）：牌仍是一张张慢慢发，但每发一张就自动归位叠好
function shuffledDealOrder(n) {
  var order = [];
  for (var i = 0; i < n; i++) order.push(i);
  for (var j = n - 1; j > 0; j--) {
    var k = Math.floor(Math.random() * (j + 1));
    var t = order[j]; order[j] = order[k]; order[k] = t;
  }
  return order;
}

// ============ 计算“本局可亮/可反的主花色”（升级亮主规则）============
// 规则：大王(红) + 任意红色级牌(红桃/方片级牌) → 可亮 红桃 或 方片
//       小王(黑) + 任意黑色级牌(黑桃/梅花级牌) → 可亮 黑桃 或 梅花
// 例：从2打起，手里有 大鬼 + 红桃2(或方片2) → 红桃/方片 都能亮
//    手里有 小鬼 + 梅花2(或黑桃2) → 黑桃/梅花 都能亮
function _computeDeclarableSuits(hand, level) {
  var suits = [];
  if (!hand || !hand.length || !level) return { suits: suits, noTrump: false };
  var hasBig = hand.some(function(c) { return c.value === "big_joker"; });
  var hasSmall = hand.some(function(c) { return c.value === "small_joker"; });
  var hasRedLevel = hand.some(function(c) { return (c.suit === "heart" || c.suit === "diamond") && c.value === level; });
  var hasBlackLevel = hand.some(function(c) { return (c.suit === "spade" || c.suit === "club") && c.value === level; });
  if (hasBig && hasRedLevel) { suits.push("heart"); suits.push("diamond"); }
  if (hasSmall && hasBlackLevel) { suits.push("spade"); suits.push("club"); }
  return { suits: suits, noTrump: (hasBig && hasSmall) };
}

// Helper: Get first letter of name as initial (uppercase)
function getInitial(name) {
  if (!name) return '?';
  // Try to get first character, convert to uppercase
  var first = name.charAt(0);
  // For Chinese names, return the first character
  return first.toUpperCase();
}

// ============ 四人同桌：按「我的座位」旋转生成 4 个固定方位 ============
// 自己永远在下方；右手 = (myIdx+1)%4（下家），对家 = +2，左手 = +3（上家）。
// 无论自己是 0~3 号，四个人始终同时出现在一张桌面上，空位也渲染占位。
function buildSeats(players, myIdx, counts, spectator) {
  // 旁观时没有「我的座位」，改用绝对视角（0号在下方），四个位置都显示真实玩家
  var base = spectator ? 0 : (typeof myIdx === 'number' && myIdx >= 0 ? myIdx : 0);
  var map = {
    bottom: base,
    right: (base + 1) % 4,
    top: (base + 2) % 4,
    left: (base + 3) % 4
  };
  function one(pos) {
    var idx = map[pos];
    var p = players && players[idx];
    var fallbackName = '玩家' + (idx + 1);
    return {
      pos: pos,
      absIndex: idx,
      seatNo: idx + 1,
      empty: !p,
      isSelf: !spectator && pos === 'bottom',
      spectating: !!spectator && pos === 'bottom',
      name: p ? (p.nickname || p.name || fallbackName) : '',
      initial: p ? (p.initial || getInitial(p.nickname || p.name || fallbackName)) : '',
      ready: p ? !!p.ready : false,
      online: p ? (p.online !== false) : false,
      count: counts && counts[idx] != null ? counts[idx] : 0
    };
  }
  return { top: one('top'), left: one('left'), right: one('right'), bottom: one('bottom') };
}

function emptySeats(myIdx) {
  return buildSeats([], myIdx || 0, null);
}

var INITIAL_SEATS = emptySeats(0);

Page({
  data: {
    // 座位操作栏：seated=是否已占座；旁观者仍留在房间，可随时重新坐下
    seated: true,
    roomInGame: false,
    observerCount: 0,
    selfReady: false,
    p1Ready: false,
    p2Ready: false,
    p3Ready: false,
    gameStarted: false,
    allReady: false,
    myHand: [],
    trumpText: "-",
    levelText: "2",
    bidScoreText: "-",
    stateText: "叫分阶段",
    showBidActions: true,
    showPlayActions: false,
    waitingText: "",
    currentPlayerIndex: 0,
    myHandCount: 0,
    p1Count: 25,
    p2Count: 25,
    p3Count: 25,
    trickCards: [null,null,null,null],
    hasPlayedCards: false,
    teamAScore: 0,
    teamBScore: 0,
    selectedCards: [],
    roomPlayers: [],
    myIndex: 0,
    roomId: "",
    showReconnecting: false,
    reconnectText: "重连中...",
    // 新增：左上记分面板
    scorePanel: {
      myLevel: 2, oppLevel: 2,
      myScore: 0, oppScore: 0,
      trumpText: "未叫主"
    },
    // 右上主牌徽标（花色符号 + 名称）与庄家座位
    trumpBadge: { char: "?", name: "待定", cls: "none" },
    bankerSeat: -1,
    // 新增：中央亮主区
    trumpDisplayVisible: false,
    trumpChips: [
      { key: "big_joker",   label: "大王", suitClass: "suit-joker",   lit: false, dim: true },
      { key: "small_joker", label: "小王", suitClass: "suit-joker",   lit: false, dim: true },
      { key: "spade",       label: "♠", suitClass: "suit-spade",   lit: false, dim: true },
      { key: "heart",       label: "♥", suitClass: "suit-heart",   lit: false, dim: true },
      { key: "club",        label: "♣", suitClass: "suit-club",    lit: false, dim: true },
      { key: "diamond",     label: "♦", suitClass: "suit-diamond", lit: false, dim: true }
    ],
    trumpCaption: "等待叫主",
    // 亮主条就地展开的操作态（亮主/叫分/反主全部在这条横栏内完成）
    bidActionOpen: false,
    bidActionState: "",
    bidActionSuit: "",
    bidActionSuitLabel: "",
    bidActionSuitClass: "",
    bidActionCaption: "",
    bidActionItems: [],
    bidPassLabel: "",
    bidPassEnabled: false,
    // 发牌动画
    dealing: false,
    dealingText: "发牌中...",
    dealingDone: 0,
    // 反牌倒计时（每人 10 秒，逆时针逐家反牌）
    reverseCountdown: 0,
    reverseCountdownActive: false,
    reverseCountdownTotal: 10,
    // 三个对手的占位（首屏立刻可见，避免 _safeRefreshUI 触发前整局看不见）
    oppTop: { initial: "?", name: "", count: 0, backs: [], bidSuit: null, bidLabel: "", bidSuitClass: "" },
    oppLeft: { initial: "?", name: "", count: 0, backs: [], bidSuit: null, bidLabel: "", bidSuitClass: "" },
    oppRight: { initial: "?", name: "", count: 0, backs: [], bidSuit: null, bidLabel: "", bidSuitClass: "" },
    // 四人同桌座位（自己永远在 bottom）
    seatTop: INITIAL_SEATS.top,
    seatLeft: INITIAL_SEATS.left,
    seatRight: INITIAL_SEATS.right,
    seatBottom: INITIAL_SEATS.bottom,
    mySeat: { initial: "我", name: "我", count: 0, ready: false },
    autoStarting: false,
    // 新版牌桌：手牌轨道宽度、当前行动座位、四方位出牌
    handTrackWidth: 72,
    activeSeat: -1,
    trickSlots: { top: null, left: null, right: null, bottom: null }
  },

  onLoad: function(options) {
    var app = require("../../utils/wsClient");
    wsClient = app.createWsClient();
    var self = this;  // 顶层 self，供异步回调使用
    var roomId = options.roomId || wx.getStorageSync("currentRoomId") || "";
    // 站起后会把 spectatorMode 写到 storage；重进牌桌/断线重连都保持旁观态
    var seated = !wsClient.isSpectator();
    var storedPlayers = wx.getStorageSync("roomPlayers");
    var players = [];
    if (storedPlayers) { try { players = JSON.parse(storedPlayers); } catch(e){} }

    // Add initial property to each player for display
    players = players.map(function(p) {
      var initial = getInitial(p.name || p.nickname || '?');
      return {...p, initial: initial};
    });

    // 优先使用后端 joined 消息下发的权威座位号（index 页已存入 storage）
    var myIndex = 0;
    var storedIdx = wx.getStorageSync("myIndex");
    if (storedIdx !== "" && storedIdx !== null && !isNaN(parseInt(storedIdx))) {
      myIndex = parseInt(storedIdx);
    } else {
      // 兜底：昵称匹配（重名时不可靠）
      var storedName = wx.getStorageSync("playerName") || "";
      if (storedName && players.length > 0) {
        var foundIdx = players.findIndex(function(p){return p.name === storedName;});
        if (foundIdx >= 0) myIndex = foundIdx;
      }
    }
    // Ensure myIndex is within bounds
    if (seated && players.length > 0) {
      myIndex = Math.min(Math.max(myIndex, 0), players.length - 1);
    }
    if (!seated) myIndex = 0;   // 旁观者用绝对视角看四个座位

    var seats = buildSeats(players, myIndex, null, !seated);
    this.setData({
      seated: seated,
      gameStarted: false,
      roomId: roomId,
      myIndex: myIndex,
      roomPlayers: players,
      roomPlayerCount: players.length,
      seatTop: seats.top, seatLeft: seats.left, seatRight: seats.right, seatBottom: seats.bottom,
      mySeat: { initial: seats.bottom.initial || "我", name: seats.bottom.name || "我", count: 0, ready: !!seats.bottom.ready },
      selfReady: seated && players[myIndex] ? players[myIndex].ready : false,
      allReady: players.length === 4 && players.every(function(p){return p.ready;})
    });

    // 持久化身份信息，供 wsClient 断线重连时恢复
    if (wsClient && wsClient.saveIdentity) {
      wsClient.saveIdentity({
        name: wx.getStorageSync("playerName") || "",
        nickname: wx.getStorageSync("playerNickname") || "",
        avatar: wx.getStorageSync("playerAvatar") || "",
        playerId: wsClient.getOrCreatePlayerId ? wsClient.getOrCreatePlayerId() : "",
        roomId: roomId,
        myIndex: myIndex
      });
    }

    // 注册断线/重连回调
    if (wsClient.onDisconnect) {
      wsClient.onDisconnect(function() {
        self.setData({ showReconnecting: true, reconnectText: "网络断开，正在重连..." });
      });
    }
    if (wsClient.onReconnecting) {
      wsClient.onReconnecting(function(attempt, delay) {
        self.setData({ showReconnecting: true, reconnectText: "重连中... (第 " + (attempt+1) + " 次)" });
      });
    }
    if (wsClient.onConnect) {
      wsClient.onConnect(function() {
        // 重连后由 wsClient 自动 joinRoom；本页只负责关掉重连遮罩
        if (self.data.showReconnecting) {
          setTimeout(function() {
            self.setData({ showReconnecting: false });
            // 重新触发一次 refreshUI 同步最新对局状态
            if (self.session) self.refreshUI();
          }, 600);
        }
      });
    }

    self = this;

    // 集中登记消息处理器并保存引用：页面销毁时反注册，
    // 避免反复进出牌桌后旧页面实例仍收到 gameStart 触发重复发牌动画。
    var self0 = this;
    this._msgBindings = [];
    [
      ["joined", "_onJoined"],
      ["seatState", "_onSeatState"],
      ["roomLobby", "_onRoomLobby"],
      ["playerStoodUp", "_onSeatNotice"],
      ["playerSatDown", "_onSeatNotice"],
      ["roomUpdate", "_onRoomUpdate"],
      ["playerReady", "_onPlayerReady"],
      ["gameStart", "_onGameStart"],
      ["cardsDealt", "_onCardsDealt"],
      ["bidResult", "_onBidResult"],
      ["playResult", "_onPlayResult"],
      ["reverseResult", "_onReverseResult"],
      ["dealerSwitched", "_onDealerSwitched"],
      ["roundEnd", "_onRoundEnd"],
      ["playerOffline", "_onPlayerOffline"],
      ["gameReconnect", "_onGameReconnect"],
      ["error", "_onError"]
    ].forEach(function(pair) {
      var fn = self0[pair[1]].bind(self0);
      self0._msgBindings.push([pair[0], fn]);
      wsClient.onMessage(pair[0], fn);
    });

    // 关键修复：gameStart 消息在本页 onLoad 之前就已到达（index 页收到后才跳转过来），
    // 本页注册处理器时早已错过。index 页跳转前把 session 存进了 storage，这里直接采用。
    // ★ 关键：采纳 session 时必须先播发牌动画（如果本会话还没播过），再让 refreshUI 接管。
    // 防止重复触发：用 storage 记录 "已播过发牌的 sessionId"，同一会话只在首次进入时播放。
    var pendingSession = wx.getStorageSync("gameSession");
    // 旁观者不进入牌桌，只保留大厅/座位视图
    if (pendingSession && this.data.seated) {
      try {
        var sess = JSON.parse(pendingSession);
        if (sess && sess.state && sess.state !== "finished") {
          console.log("[Game] Adopting pending gameSession from storage, state=", sess.state);
          this.session = sess;
          this._clearAutoStart();
          this.setData({
            gameStarted: true,
            allReady: false,
            autoStarting: false,
            showBidActions: false,  // 先不显示叫分按钮，等发牌+反牌倒计时结束
            showPlayActions: sess.state === "playing" && false,  // 出牌由 refreshUI 决定
            waitingText: "准备发牌...",
            dealing: false,
            reverseCountdownActive: false
          });

          // 决定是否播发牌动画：本会话首次进入、且处于叫分/反主阶段（牌刚发完）才播逐张动画
          // 进入时若已在出牌/结算阶段，直接刷新 UI（不重播发牌）
          var alreadyShownKey = "dealingShown_" + (sess.id || roomId);
          var alreadyShown = wx.getStorageSync(alreadyShownKey);
          var st = sess.state;
          if (!alreadyShown && (st === "bidding" || st === "reverse") && sess.players && sess.players[this.data.myIndex]
              && sess.players[this.data.myIndex].hand && sess.players[this.data.myIndex].hand.length > 0) {
            console.log("[Game] 首次进入会话，播放发牌动画 + 15s反牌倒计时");
            this.setData({
              dealing: true,
              dealingText: "正在发牌...",
              dealingDone: 0,
              myHand: [],
              myHandCount: 0,
              p1Count: 0, p2Count: 0, p3Count: 0,
              trickCards: [null, null, null, null],
              hasPlayedCards: false
            });
            // 200ms 后启动动画（等首屏渲染完成）；dealingShown 由 _animateDeal 播完时置位
            setTimeout(function() { self._animateDeal(sess, true); }, 200);
          } else {
            // 已播过发牌动画，或已进入出牌/结算阶段：直接走 refreshUI
            console.log("[Game] 本会话发牌动画已播过/或非发牌阶段，直接刷新UI");
            this.refreshUI();
          }
        }
      } catch(e) { console.error("[Game] Failed to parse pending session", e); }
    }
  },

  // 退出牌桌：清理兜底计时器 + 反注册本页消息处理器
  onUnload: function() {
    if (this._autoStartTimer) { clearTimeout(this._autoStartTimer); this._autoStartTimer = null; }
    this._stopPhaseTimer();
    if (wsClient && wsClient.offMessage && this._msgBindings) {
      this._msgBindings.forEach(function(pair) { wsClient.offMessage(pair[0], pair[1]); });
      this._msgBindings = [];
    }
  },

  // 从后台/其他页面切回前台时，若 WebSocket 已断开，立即重连并恢复对局
  onShow: function() {
    var app = require("../../utils/wsClient");
    var c = app.createWsClient();
    if (c.reconnectNow) c.reconnectNow();
    // 从后台/其他页面切回：若手牌区为空但会话还在，立即补齐并展开
    // （任何阶段自家牌都必须一直摊开可见，不允许出现「发完牌牌不见了」）
    if (this.session && this.data.seated && !this._dealAnimating &&
        (!this.data.myHand || this.data.myHand.length === 0) && !this.data.dealing) {
      this._fillMyHand(this.session);
    }
  },

  // 统一把后端 players 铺到四个座位：无论自己是几号，四家始终同屏
  _applyRoomPlayers: function(players, extra) {
    var myIdx = this.data.seated ? this.data.myIndex : 0;
    var seats = buildSeats(players, myIdx, null, !this.data.seated);
    var patch = {
      roomPlayers: players,
      roomPlayerCount: players.length,
      seatTop: seats.top, seatLeft: seats.left, seatRight: seats.right, seatBottom: seats.bottom,
      mySeat: {
        initial: seats.bottom.initial || "我",
        name: seats.bottom.name || "我",
        count: this.data.myHandCount || 0,
        ready: !!seats.bottom.ready
      },
      selfReady: this.data.seated && players[myIdx] ? !!players[myIdx].ready : false,
      allReady: players.length === 4 && players.every(function(p) { return p.ready; }),
      p1Ready: players[1] ? !!players[1].ready : false,
      p2Ready: players[2] ? !!players[2].ready : false,
      p3Ready: players[3] ? !!players[3].ready : false
    };
    if (extra) Object.assign(patch, extra);
    this.setData(patch);
  },

  // 四人全准备但没收到 gameStart（旧版服务端 / 消息丢失）时兜底请求开局
  _scheduleAutoStart: function() {
    if (this._autoStartTimer || this.data.gameStarted) return;
    var self = this;
    this._autoStartTimer = setTimeout(function() {
      self._autoStartTimer = null;
      if (self.data.gameStarted) return;
      if (wsClient && wsClient.isConnected()) {
        console.log("[Game] 兜底：未收到 gameStart，主动请求 startGame");
        wsClient.send({ type: "startGame" });
      }
    }, 1500);
  },

  _clearAutoStart: function() {
    if (this._autoStartTimer) { clearTimeout(this._autoStartTimer); this._autoStartTimer = null; }
    if (this.data.autoStarting) this.setData({ autoStarting: false });
  },

  // ============ 座位操作栏：坐下 / 站起 / 准备 / 回大厅 ============
  // 后端 joined 是「已入座」的权威信号（坐下成功、座位重编号都会下发）
  _onJoined: function(msg) {
    var wasSeated = this.data.seated;
    var idx = (typeof msg.playerIndex === "number" && msg.playerIndex >= 0)
      ? msg.playerIndex : this.data.myIndex;
    var rid = msg.roomId || this.data.roomId;
    try {
      wx.setStorageSync("myIndex", String(idx));
      wx.setStorageSync("currentRoomId", rid);
      if (msg.playerId) wx.setStorageSync("playerId", msg.playerId);
    } catch (e) {}
    if (wsClient && wsClient.setSpectatorMode) wsClient.setSpectatorMode(false);
    if (wsClient && wsClient.saveIdentity) {
      wsClient.saveIdentity({ roomId: rid, myIndex: idx, playerId: msg.playerId || "" });
    }
    this.setData({ seated: true, myIndex: idx, roomId: rid });
    if (!wasSeated) wx.showToast({ title: "已坐下，点准备开局", icon: "none" });
  },

  // 站起 / 断线恢复旁观：切到旁观视角，不参与发牌
  _onSeatState: function(msg) {
    if (msg.seated) return;
    if (wsClient && wsClient.setSpectatorMode) wsClient.setSpectatorMode(true);
    this._clearAutoStart();
    this.setData({
      seated: false,
      selfReady: false,
      gameStarted: false,
      allReady: false,
      roomInGame: false,
      myIndex: 0
    });
    wx.showToast({ title: "已站起，正在旁观", icon: "none" });
  },

  // 「回大厅」：结束本局，所有玩家回到等待桌，可重新坐下/站起/准备
  _onRoomLobby: function(msg) {
    this._clearAutoStart();
    this.session = null;
    try { wx.removeStorageSync("gameSession"); } catch (e) {}
    this.setData({
      gameStarted: false,
      roomInGame: false,
      allReady: false,
      autoStarting: false,
      dealing: false,
      reverseCountdownActive: false,
      myHand: [], myHandCount: 0,
      trumpDisplayVisible: false,
      bidActionOpen: false,
      waitingText: ""
    });
    if (msg && msg.players) this._onRoomUpdate(msg);
    wx.showToast({ title: "已回到等待大厅", icon: "none" });
  },

  _onSeatNotice: function(msg) {
    if (msg && msg.playerName) {
      wx.showToast({
        title: msg.playerName + (msg.type === "playerStoodUp" ? " 已站起" : " 已坐下"),
        icon: "none", duration: 1500
      });
    }
  },

  _onRoomUpdate: function(msg) {
    console.log("[Game] roomUpdate", msg);
    if (!msg.players) return;
    var players = msg.players.map(function(p) {
      return Object.assign({}, p, { initial: p.initial || getInitial(p.nickname || p.name) });
    });
    this._applyRoomPlayers(players, {
      roomInGame: !!(msg.room && msg.room.inGame),
      observerCount: (msg.room && msg.room.observerCount) || 0
    });
  },

  _onPlayerReady: function(msg) {
    console.log("[Game] playerReady", msg);
    var players;
    if (msg.players) {
      players = msg.players.map(function(p) {
        return Object.assign({}, p, { initial: p.initial || getInitial(p.nickname || p.name) });
      });
    } else {
      players = this.data.roomPlayers.map(function(p) {
        return Object.assign({}, p, { ready: p.playerIndex === msg.playerIndex ? true : p.ready });
      });
    }
    var allReady = players.length === 4 && players.every(function(p) { return p.ready; });
    this._applyRoomPlayers(players, allReady && this.data.seated && !this.data.gameStarted
      ? { autoStarting: true, waitingText: "四人已准备，正在自动开局发牌…" }
      : null);
    if (allReady && this.data.seated && !this.data.gameStarted) this._scheduleAutoStart();
  },

  _onGameStart: function(msg) {
    console.log("[Game] gameStart", msg);
    if (!this.data.seated) {
      this.setData({ roomInGame: true, gameStarted: false, waitingText: "旁观中 · 点坐下参与下一局" });
      return;
    }
    this._clearAutoStart();
    this.setData({ roomInGame: true });
    // 服务端重启后 session.id 可能重复，先清掉上一局遗留的"发牌已播"闸门
    try { wx.removeStorageSync("dealingShown_" + (msg.session.id || this.data.roomId)); } catch (e) {}
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    // 注意：dealingShown 标记改到 _animateDeal 播完时才置位，避免提前置位导致
    // onLoad 采纳 session 时误判"已播过"而跳过逐张发牌动画

    this.setData({
      gameStarted: true,
      allReady: false,
      autoStarting: false,
      showBidActions: false,
      showPlayActions: false,
      waitingText: "准备发牌...",
      dealing: true,
      dealingText: "正在发牌...",
      dealingDone: 0,
      myHand: [],
      myHandCount: 0,
      p1Count: 0, p2Count: 0, p3Count: 0,
      trickCards: [null, null, null, null],
      hasPlayedCards: false,
      reverseCountdownActive: false
    });
    var self = this;
    setTimeout(function() { self._animateDeal(msg.session, false); }, 200);
  },

  // 兼容只广播 cardsDealt 的情况：没进过牌桌就直接按 gameStart 处理
  _onCardsDealt: function(msg) {
    if (!msg.session || !this.data.seated) return;
    console.log("[Game] cardsDealt", msg);
    if (this.data.gameStarted) {
      this.session = msg.session;
      wx.setStorageSync("gameSession", JSON.stringify(msg.session));
      this.refreshUI();
      return;
    }
    this._onGameStart({ session: msg.session });
  },

  // 发牌动画：系统逐张慢发（0.5 秒一张），每发一张就自动按花色/点数由大到小插入归位。
  // 发牌过程中亮主条按「已到手的牌」动态点亮，凑齐「同色级牌 + 对应王」才能亮主。
  // 全部发完后启动 15 秒反牌倒计时。fromAdoption: true=来自 onLoad 采纳
  _animateDeal: function(s, fromAdoption) {
    var me = s.players ? s.players[this.data.myIndex] : null;
    var rawHand = (me && me.hand) ? me.hand : [];
    var trump = (s.trumpSuit && s.trumpSuit !== "none") ? s.trumpSuit : null;
    var level = s.level;
    // 最终叠牌顺序（王 / 级牌 / 主花色 / 副花色，同花色由大到小）
    var sortedHand = sortHandByRule(rawHand, s.trumpSuit, level);
    var finalItems = sortedHand.map(function(c, i) { return cardToHandItem(c, "d" + i); });
    var total = finalItems.length || 25;
    var order = shuffledDealOrder(total);
    var self = this;
    if (self._dealAnimating) return;   // 防重入
    self._dealAnimating = true;
    var stepMs = 500;                  // 0.5 秒一张，25 张约 12.5 秒

    // 先渲染对手区 / 记分板 / 亮主条（不碰 myHand，动画自己逐张插入）
    self._safeRefreshUI(s);

    this.setData({
      myHand: [],
      myHandCount: 0,
      handTrackWidth: 72,
      p1Count: 0, p2Count: 0, p3Count: 0,
      dealingDone: 0,
      dealing: true,
      dealingText: "发牌中 0/" + total
    });
    self._updateTrumpDisplay(s);       // 起手无可亮花色

    var k = 0;
    function next() {
      if (k >= total) {
        self._dealAnimating = false;
        wx.setStorageSync("dealingShown_" + (s.id || self.data.roomId), "1");
        var clean = self.data.myHand.map(function(x) {
          return Object.assign({}, x, { dealing: false });
        });
        self.setData({
          myHand: clean,
          dealing: false,
          dealingDone: total,
          dealingText: "发牌完成"
        });
        // 发完牌用完整会话手牌兜底重建一次：25 张始终完整展开，不因动画/刷新丢牌
        self._fillMyHand(self.session || s);
        self._updateTrumpDisplay(self.session || s);  // 用完整手牌刷新可亮花色
        setTimeout(function() { self._startReverseCountdown(s); }, 400);
        return;
      }
      // 上一张取消飞入动画，新到手的这一张带 dealing 标记
      var shown = self.data.myHand.map(function(x) {
        return x.dealing ? Object.assign({}, x, { dealing: false }) : x;
      });
      var newCard = Object.assign({}, finalItems[order[k]], { dealing: true });
      shown = insertHandCard(shown, newCard, trump, level);
      var deco = decorateHand(shown, s.trumpSuit, level);
      self.setData({
        myHand: deco.items,
        myHandCount: shown.length,
        handTrackWidth: deco.width,
        p1Count: k + 1,
        p2Count: k + 1,
        p3Count: k + 1,
        dealingDone: k + 1,
        dealingText: "发牌中 " + (k + 1) + "/" + total
      });
      // 每发一张，按「已到手的牌」重算横栏：可亮花色随牌逐步亮起
      self._updateTrumpDisplay(self.session || s);
      k++;
      setTimeout(next, stepMs);
    }
    setTimeout(next, 300);
  },

  // 发牌结束后启动倒计时，分两种：
  // - reverse 阶段：逆时针逐家反牌，每人 10 秒，轮到者超时自动"不反主"
  // - bidding 阶段：后续局庄家队 10 秒叫不起 → 换另一队上庄；首局只提示不换庄
  _startReverseCountdown: function(s) {
    var self = this;
    var total = this.data.reverseCountdownTotal || 10;
    this._stopPhaseTimer();   // 防重入：清掉上一轮计时器
    this.setData({
      reverseCountdownActive: true,
      reverseCountdown: total,
      showBidActions: false,
      showReverseActions: false
    });
    var tick = function() {
      if (!self.data.reverseCountdownActive) return;
      var n = self.data.reverseCountdown - 1;
      var cur = self.session || s;
      if (!cur) return;
      if (n <= 0) {
        self._stopPhaseTimer();
        self.setData({ reverseCountdown: 0, reverseCountdownActive: false });
        var state = cur.state;
        if (state === "reverse") {
          // 反牌超时：只有轮到自己才自动跳过（服务端会推进到下一家）
          if (cur.currentBidderIndex === self.data.myIndex && wsClient && wsClient.isConnected()) {
            console.log("[Game] 反牌超时，自动不反主");
            wsClient.send({ type: "skipReverse" });
          }
        } else if (state === "bidding" && cur.dealerLocked) {
          // 后续局：庄家队 10 秒叫不起，由庄家队成员触发换庄
          var dealer = cur.finalBidderIndex;
          if (dealer >= 0 &&
              (self.data.myIndex === dealer || self.data.myIndex === (dealer + 2) % 4) &&
              !cur.trumpSuit && wsClient && wsClient.isConnected()) {
            console.log("[Game] 叫分超时，申请换庄");
            wsClient.send({ type: "switchDealer" });
          }
        }
        self._safeRefreshUI(cur);
        return;
      }
      var state2 = cur.state;
      var txt;
      if (state2 === "reverse") {
        txt = (cur.currentBidderIndex === self.data.myIndex)
          ? ("轮到您反牌 · " + n + "s")
          : ("等待玩家" + (cur.currentBidderIndex + 1) + "反牌 · " + n + "s");
      } else if (state2 === "bidding") {
        txt = (cur.dealerLocked ? "庄家队 " : "") + "抢叫亮主 · " + n + "s";
      } else {
        txt = "手牌已展开 · " + n + "s";
      }
      self.setData({ reverseCountdown: n, waitingText: txt });
      self._phaseTimer = setTimeout(tick, 1000);
    };
    this._phaseTimer = setTimeout(tick, 1000);
  },

  _stopPhaseTimer: function() {
    if (this._phaseTimer) { clearTimeout(this._phaseTimer); this._phaseTimer = null; }
  },

  // 用户点击"开始叫分/跳过"提前结束当前倒计时
  onSkipReverseCountdown: function() {
    if (!this.data.reverseCountdownActive) return;
    this._stopPhaseTimer();
    this.setData({ reverseCountdown: 0, reverseCountdownActive: false });
    var s = this.session;
    if (!s) return;
    // 反牌阶段只清本地展示，交给服务端 currentBidderIndex 推进
    if (s.state === "reverse") {
      this._safeRefreshUI(s);
      return;
    }
    this.setData({
      waitingText: (s.currentBidderIndex === this.data.myIndex) ? "轮到您叫分" : ("等待玩家" + (s.currentBidderIndex + 1) + "叫分..."),
      showBidActions: (s.currentBidderIndex === this.data.myIndex)
    });
    wx.showToast({ title: "进入叫分阶段", icon: "none", duration: 1200 });
  },

  // 亮主条是唯一操作入口：点花色格后，同一条横栏就地变成「亮主/1分/2分/3分」或「反主/不反主」
  onTrumpChipTap: function(e) {
    var key = e.currentTarget.dataset.suit;
    if (!key) return;
    var s = this.session;
    if (!s) { wx.showToast({ title: "会话未就绪", icon: "none" }); return; }
    var canAct = (s.state === "bidding") ||
                 (s.state === "reverse" && s.currentBidderIndex === this.data.myIndex);
    if (!canAct) {
      wx.showToast({ title: (s.state === "reverse" ? "还没轮到你反主" : "当前阶段亮主条仅展示主牌"), icon: "none" });
      return;
    }
    // 只允许点手里真能亮/能反的花色（已是当前主花色也允许继续叫更高分）
    var chip = null, list = this.data.trumpChips || [];
    for (var i = 0; i < list.length; i++) { if (list[i].key === key) { chip = list[i]; break; } }
    if (!chip || (!chip.available && !chip.lit)) {
      wx.showToast({ title: "你没有可亮/可反的" + (chip ? chip.label : "花色"), icon: "none" });
      return;
    }
    var noTrump = (key === "big_joker" || key === "small_joker");
    if (noTrump && s.state === "bidding") {
      wx.showToast({ title: "亮主/叫分请点四种花色，双王无主在反主阶段用", icon: "none" });
      return;
    }
    var label = noTrump ? "无主" : (suitNames[key] || key);
    var myTurn = (s.currentBidderIndex === this.data.myIndex);
    var items, actCaption;
    if (s.state === "bidding") {
      // 后端规定：非自己回合只能亮主(0分)，1/2/3分必须轮到自己
      items = [{ key: "0", label: "亮主", primary: true }];
      if (myTurn) {
        items = items.concat([
          { key: "1", label: "1分" },
          { key: "2", label: "2分" },
          { key: "3", label: "3分" }
        ]);
      }
      items.push({ key: "cancel", label: "取消" });
      actCaption = label + (myTurn ? " · 选亮主或叫分" : " · 非你回合，只能亮主");
    } else {
      items = [
        { key: "reverse", label: "反主", primary: true },
        { key: "skip", label: "不反主" },
        { key: "cancel", label: "取消" }
      ];
      actCaption = label + " · 反主确认";
    }
    this.setData({
      bidActionOpen: true,
      bidActionState: s.state,
      bidActionSuit: key,
      bidActionSuitLabel: label,
      bidActionSuitClass: chip.suitClass || "",
      bidActionCaption: actCaption,
      bidActionItems: items
    });
  },

  // 展开态横栏里的按钮：亮主、叫分、不叫、反主、不反主、取消，全部在这条横栏内完成
  onBidActionTap: function(e) {
    var key = e.currentTarget.dataset.key;
    if (key === "cancel") { this.setData({ bidActionOpen: false, bidActionState: "" }); return; }
    if (!wsClient || !this.session) { wx.showToast({ title: "会话未就绪", icon: "none" }); return; }
    var s = this.session;
    if (s.state !== this.data.bidActionState) {
      this.setData({ bidActionOpen: false, bidActionState: "" });
      wx.showToast({ title: "阶段已变化，请重新选择", icon: "none" });
      return;
    }
    var suitKey = this.data.bidActionSuit;
    var noTrump = (suitKey === "big_joker" || suitKey === "small_joker");
    var suit = noTrump ? "none" : suitKey;
    var msg;
    if (s.state === "bidding") {
      msg = (key === "pass") ? { type: "bid", bid: "pass" }
                             : { type: "bid", bid: key, suit: suit };
    } else {
      if (key === "skip") msg = { type: "skipReverse" };
      else msg = noTrump ? { type: "reverse", option: { isNoTrump: true } }
                         : { type: "reverse", option: { suit: suit } };
    }
    var ok = wsClient.send(msg);
    if (!ok) { wx.showToast({ title: "发送失败，请重试", icon: "none" }); return; }
    this.setData({ bidActionOpen: false, bidActionState: "" });
  },

  // 常态横栏最左侧的「不叫 / 不反主」快捷格
  onBidPassTap: function() {
    if (!this.data.bidPassEnabled || !wsClient || !this.session) return;
    var msg = (this.session.state === "reverse")
      ? { type: "skipReverse" }
      : { type: "bid", bid: "pass" };
    wsClient.send(msg);
    this.setData({ bidActionOpen: false, bidActionState: "" });
  },

  _onBidResult: function(msg) {
    console.log("[Game] bidResult", msg);
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    this.setData({showSuitSelector: false, waitingText: "等待其他玩家叫分...", bidActionOpen: false, bidActionState: ""});
    this.refreshUI();
    // 抢叫成功进入反主阶段：重启当前反牌者的 10 秒倒计时
    if (msg.session.state === "reverse") {
      this._startReverseCountdown(msg.session);
    } else if (msg.session.state === "bidding") {
      this._stopPhaseTimer();
    }
  },

  _onReverseResult: function(msg) {
    console.log("[Game] reverseResult", msg);
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    this.setData({ bidActionOpen: false, bidActionState: "" });
    this.refreshUI();
    if (msg.session.state === "reverse") {
      // 下一家反牌，重新计时 10 秒
      this._startReverseCountdown(msg.session);
    } else {
      this._stopPhaseTimer();
      this.setData({ reverseCountdownActive: false, reverseCountdown: 0 });
    }
  },

  _onDealerSwitched: function(msg) {
    console.log("[Game] dealerSwitched", msg);
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    this.setData({ bidActionOpen: false, bidActionState: "" });
    this.refreshUI();
    // 换庄后重新给庄家队 10 秒叫分窗口
    this._startReverseCountdown(msg.session);
    wx.showToast({ title: "庄家队叫不起，换庄", icon: "none" });
  },

  _onPlayResult: function(msg) {
    console.log("[Game] playResult", msg);
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    this.refreshUI();
    // 进入出牌（或新一轮重置）时停掉反牌/叫分倒计时
    if (msg.session.state !== "reverse" && msg.session.state !== "bidding") {
      this._stopPhaseTimer();
      this.setData({ reverseCountdownActive: false, reverseCountdown: 0 });
    }
  },

  _onRoundEnd: function(msg) {
    console.log("[Game] roundEnd", msg);
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    this._stopPhaseTimer();
    this.setData({ reverseCountdownActive: false, reverseCountdown: 0 });
    this.refreshUI();
  },

  _onError: function(msg) {
    console.error("[Game] error", msg);
    // 兼容 message 可能是对象/数字/null/数组的情况（之前直接传对象会被 WeChat 强制 toString 成 "[object Object]"）
    // 这里做四层防护：raw 提取 → typeof 区分 → JSON.stringify → 最终 String()，确保任何形态都变可显示字符串
    var raw = msg && msg.message;
    var title = "错误";
    if (raw != null) {
      if (typeof raw === "string") {
        title = raw;
      } else if (typeof raw === "number" || typeof raw === "boolean") {
        title = String(raw);
      } else {
        try { title = JSON.stringify(raw); } catch (e) { title = "错误"; }
      }
    }
    if (!title) title = "错误";
    // 终极兜底：toString 一次（防 message 数组/undefined/循环引用等）
    try { title = String(title); } catch (e) { title = "错误"; }
    // showToast 自身抛错也吞掉，避免阻塞流程
    try { wx.showToast({title: title, icon:"none"}); }
    catch (e) { console.error("[Game] showToast failed", e, "title=", title); }
  },

  _onPlayerOffline: function(msg) {
    console.log("[Game] playerOffline", msg);
    // 标记该玩家为离线，状态上让其"已准备"的灰掉
    var players = this.data.roomPlayers;
    var idx = msg.playerIndex;
    if (idx >= 0 && idx < players.length) {
      players[idx] = Object.assign({}, players[idx], { offline: true });
      this.setData({ roomPlayers: players });
    }
    wx.showToast({ title: (msg.playerName || ('玩家' + (idx+1))) + ' 已离线', icon: 'none', duration: 2000 });
  },

  _onGameReconnect: function(msg) {
    console.log("[Game] gameReconnect (断线后回到对局中)", msg);
    if (!msg.session || !this.data.seated) return;
    this._clearAutoStart();
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    this.setData({
      gameStarted: true,
      allReady: false,
      showBidActions: msg.session.state === "bidding" || msg.session.state === "reverse",
      showPlayActions: msg.session.state === "playing",
      showReconnecting: false
    });
    this.refreshUI();
    wx.showToast({ title: "重连成功，已恢复对局", icon: 'success', duration: 1500 });
  },

  // 非发牌动画路径（重新进入牌桌 / 断线恢复 / 出牌后同步）：
  // 直接用 session 里的真实手牌重建底部手牌，避免"看得见牌桌却一张牌都没有"。
  _fillMyHand: function(s) {
    if (!s || !s.players) return;
    var me = s.players[this.data.myIndex];
    if (!me || !me.hand) return;
    var sorted = sortHandByRule(me.hand, s.trumpSuit, s.level);
    var deco = decorateHand(sorted.map(function(c, i) { return cardToHandItem(c, i); }), s.trumpSuit, s.level);
    this.setData({
      myHand: deco.items,
      myHandCount: deco.items.length,
      handTrackWidth: deco.width,
      selectedCards: []
    });
  },

  refreshUI: function() {
    if (!this.session) return;
    this._safeRefreshUI(this.session);
    // 发牌动画期间不要插手（逐张追加由 _animateDeal 负责）
    if (!this._dealAnimating && !this.data.dealing) this._fillMyHand(this.session);
  },

  // 安全的局部刷新：只更新对手区、记分面板、亮主色条、状态文本等“外壳”数据，
  // 不动 myHand（避免覆盖发牌动画的逐张追加过程）。可在发牌/反主倒计时期间随时调用。
  _safeRefreshUI: function(s) {
    if (!s) s = this.session;
    if (!s) return;
    var myIdx = this.data.myIndex;
    var isBidding = s.state === "bidding";
    var isReverse = s.state === "reverse";
    var isPlaying = s.state === "playing";
    var myBidTurn = isBidding && s.currentBidderIndex === myIdx;
    var myReverseTurn = isReverse && s.currentBidderIndex === myIdx;
    var myPlayTurn = false;
    var activeSeat = -1;
    if (isPlaying) {
      var trick = s.currentTrick || [];
      var expected = trick.length === 0
        ? s.currentTrickWinner
        : (trick[trick.length - 1].player + 1) % 4;
      myPlayTurn = expected === myIdx;
      activeSeat = expected;
    } else if (isBidding || isReverse) {
      activeSeat = s.currentBidderIndex;
    }
    var currentTrump = this._currentTrumpSuit(s);
    var trumpText = currentTrump ? (suitNames[currentTrump] || currentTrump) : "未叫主";
    var bankerSeat = (typeof s.finalBidderIndex === "number" && s.finalBidderIndex >= 0)
      ? s.finalBidderIndex : -1;
    var levelText = levelNames[s.level] || s.level || "2";
    var bidScoreText = (s.bidScore > 0 ? s.bidScore + "分" : "-");

    // 四家手牌数（按真实 session，不写死 25），并同步到四个座位，保证同桌四人一直可见
    var counts = {};
    if (s.players) {
      for (var ci = 0; ci < 4; ci++) {
        counts[ci] = (s.players[ci] && s.players[ci].hand) ? s.players[ci].hand.length : 0;
      }
    }
    var rp = this.data.roomPlayers;
    if (!rp || rp.length < 4) {
      rp = (s.players || []).map(function(p, i) {
        var nm = (p && p.name) || ("玩家" + (i + 1));
        return { name: nm, nickname: "", initial: getInitial(nm), ready: true, online: true };
      });
    }
    var gs = buildSeats(rp, myIdx, counts, !this.data.seated);

    this.setData({
      trumpText: trumpText,
      levelText: levelText,
      bidScoreText: bidScoreText,
      stateText: this._getStateText(s.state),
      showBidActions: myBidTurn,
      showReverseActions: myReverseTurn,
      showPlayActions: isPlaying && myPlayTurn,
      myPlayTurn: myPlayTurn,
      waitingText: this._getWaitingText(s),
      currentPlayerIndex: s.currentBidderIndex,
      activeSeat: activeSeat,
      bankerSeat: bankerSeat,
      trumpBadge: this._trumpBadge(currentTrump),
      p1Count: counts[(myIdx + 1) % 4] || 0,
      p2Count: counts[(myIdx + 2) % 4] || 0,
      p3Count: counts[(myIdx + 3) % 4] || 0,
      seatTop: gs.top, seatLeft: gs.left, seatRight: gs.right, seatBottom: gs.bottom,
      mySeat: {
        initial: gs.bottom.initial || "我",
        name: gs.bottom.name || "我",
        count: this.data.myHandCount || counts[myIdx] || 0,
        ready: true
      },
      oppTop: this._oppInfo(s, (myIdx + 2) % 4),
      oppLeft: this._oppInfo(s, (myIdx + 3) % 4),
      oppRight: this._oppInfo(s, (myIdx + 1) % 4),
      teamAScore: s.teamLevels ? s.teamLevels[myIdx % 2] : 0,
      teamBScore: s.teamLevels ? s.teamLevels[1 - (myIdx % 2)] : 0
    });
    this._updateTrickArea(s);
    this._updateScorePanel(s);
    this._updateTrumpDisplay(s);
  },

  // 计算本轮双方已得分数（墩分总和，按 winner % 2 分组），以 myTeam 视角返回 my/opp
  _calcRoundPoints: function(s, myTeam) {
    var mine = 0, opp = 0;
    if (s.tricks && s.tricks.length) {
      for (var i=0;i<s.tricks.length;i++){
        var t = s.tricks[i];
        if (typeof t.points !== "number") continue;
        if ((t.winner % 2) === myTeam) mine += t.points;
        else opp += t.points;
      }
    }
    return { myScore: mine, oppScore: opp };
  },

  // 当前生效的主花色：优先 finalSuit/trumpSuit，叫分阶段回退到最后一次有效叫分
  _currentTrumpSuit: function(s) {
    var suit = s.finalSuit || s.trumpSuit || null;
    if (!suit && s.bidHistory && s.bidHistory.length) {
      for (var i = s.bidHistory.length - 1; i >= 0; i--) {
        var b = s.bidHistory[i];
        if (b.bid !== "pass" && b.suit) { suit = b.suit; break; }
      }
    }
    return suit;
  },

  // 右上角主牌徽标：花色符号 + 中文名，红/黑配色
  _trumpBadge: function(suit) {
    if (!suit) return { char: "?", name: "待定", cls: "none" };
    if (suit === "none") return { char: "无", name: "无主", cls: "none" };
    var ch = (suit === "big_joker" || suit === "small_joker") ? "王" : _suitChar(suit);
    var red = (suit === "heart" || suit === "diamond" || suit === "big_joker");
    return { char: ch || "?", name: suitNames[suit] || suit, cls: red ? "red" : "black" };
  },

  _updateScorePanel: function(s) {
    var myIdx = this.data.myIndex;
    var myTeam = myIdx % 2;          // 0 或 1
    var oppTeam = 1 - myTeam;
    var myLevel = (s.teamLevels && s.teamLevels[myTeam] !== undefined) ? (s.teamLevels[myTeam] + 2) : 2;
    var oppLevel = (s.teamLevels && s.teamLevels[oppTeam] !== undefined) ? (s.teamLevels[oppTeam] + 2) : 2;
    var pts = this._calcRoundPoints(s, myTeam);
    // trumpText 与右上角徽标取同一个主花色
    var trumpSuit = this._currentTrumpSuit(s);
    var trumpText = trumpSuit ? (suitNames[trumpSuit] || trumpSuit) : "未叫主";
    this.setData({
      scorePanel: {
        myLevel: myLevel,
        oppLevel: oppLevel,
        myScore: pts.myScore,
        oppScore: pts.oppScore,
        trumpText: trumpText
      }
    });
  },

  _updateTrumpDisplay: function(s) {
    // 在 bidding/reverse/playing 都显示
    var visible = s.state === "bidding" || s.state === "reverse" || s.state === "playing" || s.state === "scoring" || s.state === "round_end";
    // 当前已确认的主花色（叫分阶段会回退到最后一次有效叫分）
    var currentSuit = this._currentTrumpSuit(s);
    var myIdx = this.data.myIndex;
    var myTurn = (s.state === "bidding" && s.currentBidderIndex === myIdx)
              || (s.state === "reverse" && s.currentBidderIndex === myIdx);
    // 发牌动画期间只用「已经发到手的牌」判断能否亮主：
    // 必须等王 + 同色级牌都到手，横栏对应花色才会点亮（符合发牌中亮主规则）
    var meHand;
    if (this._dealAnimating) {
      meHand = (this.data.myHand || []).map(function(x) { return x.card; }).filter(Boolean);
    } else {
      meHand = (s.players && s.players[myIdx]) ? s.players[myIdx].hand : [];
    }
    var decl = _computeDeclarableSuits(meHand, s.level);
    var declSuits = decl.suits;
    var declNoTrump = decl.noTrump;
    // 当前阶段是否允许操作：叫分阶段任何玩家可亮主；反主阶段仅轮到者
    var canAct = (s.state === "bidding") || (s.state === "reverse" && myTurn);

    var chipDefs = [
      { key: "big_joker",   label: "大王", suitClass: "suit-joker" },
      { key: "small_joker", label: "小王", suitClass: "suit-joker" },
      { key: "spade",       label: "♠", suitClass: "suit-spade" },
      { key: "heart",       label: "♥", suitClass: "suit-heart" },
      { key: "club",        label: "♣", suitClass: "suit-club" },
      { key: "diamond",     label: "♦", suitClass: "suit-diamond" }
    ];
    // 每格右下角标注「我手里有几张」，与多乐升级亮主条一致
    var handCounts = { big_joker: 0, small_joker: 0, spade: 0, heart: 0, club: 0, diamond: 0 };
    (meHand || []).forEach(function(c) {
      if (c.value === "big_joker") handCounts.big_joker++;
      else if (c.value === "small_joker") handCounts.small_joker++;
      else if (handCounts[c.suit] !== undefined) handCounts[c.suit]++;
    });
    var chips = chipDefs.map(function(d) {
      var isCurrent = (d.key === currentSuit);
      var isJoker = (d.key === "big_joker" || d.key === "small_joker");
      // 大王/小王格：叫分阶段只作持有张数展示；反主阶段双王齐时可点「反无主」
      var isAvail = (declSuits.indexOf(d.key) >= 0) ||
                    (isJoker && declNoTrump && s.state === "reverse");
      return {
        key: d.key,
        label: d.label,
        suitClass: d.suitClass,
        count: handCounts[d.key] || 0,
        lit: isCurrent,
        dim: !isCurrent && !isAvail,
        available: !isCurrent && isAvail,
        clickable: !isCurrent && isAvail && canAct
      };
    });

    // 字幕
    var caption = "";
    if (s.state === "bidding") {
      if (currentSuit) {
        var latestBidScore = 0;
        for (var j = s.bidHistory.length - 1; j >= 0; j--) {
          if (s.bidHistory[j].bid !== "pass") {
            latestBidScore = parseInt(s.bidHistory[j].bid) || 0;
            break;
          }
        }
        var bidScoreStr = (latestBidScore > 0) ? (latestBidScore + "分") : "亮主";
        caption = "已叫" + (suitNames[currentSuit] || currentSuit) + " " + bidScoreStr + " · 点花色继续叫分";
      } else if (declSuits.length > 0 || declNoTrump) {
        caption = "点横栏里的花色 → 亮主 / 叫分";
      } else {
        caption = myTurn ? "点花色亮主，或点左侧不叫" : "等待叫主";
      }
    } else if (s.state === "reverse") {
      if (declSuits.length > 0) {
        var availNames = declSuits.map(function(x) { return suitNames[x] || x; }).join("/");
        caption = myTurn ? ("点花色反主（可反 " + availNames + "）") : ("等待反主，你可反 " + availNames);
      } else {
        caption = myTurn ? "你无可反主，点横栏左侧不反主" : "等待其他玩家反主";
      }
    } else if (s.state === "playing" || s.state === "scoring" || s.state === "round_end") {
      if (currentSuit) {
        var finalScoreStr = (s.bidScore > 0) ? (s.bidScore + "分亮主") : "亮主坐庄";
        caption = "本局打" + (suitNames[currentSuit] || currentSuit) + " " + finalScoreStr;
      } else {
        caption = "亮主坐庄";
      }
    } else {
      caption = "亮主坐庄";
    }
    // 常态横栏最左侧的快捷格：叫分阶段「不叫」（仅自己回合），反主阶段「不反主」
    var passLabel = "", passEnabled = false;
    if (s.state === "bidding") { passLabel = "不叫"; passEnabled = myTurn; }
    else if (s.state === "reverse") { passLabel = "不反主"; passEnabled = myTurn; }
    // 发牌过程中字幕随到手牌变化，提示何时才符合亮主条件
    if (this._dealAnimating) {
      if (declSuits.length > 0) {
        var dn = declSuits.map(function(x) { return suitNames[x] || x; }).join("/");
        caption = "发牌中 " + this.data.dealingDone + "/25 · 已凑齐 " + dn + "，点花色亮主";
      } else {
        caption = "发牌中 " + this.data.dealingDone + "/25 · 王 + 同色级牌到手即可亮主";
      }
    }
    // 阶段已推进则自动收起展开态，避免用旧阶段的按钮发消息
    var keepOpen = this.data.bidActionOpen && this.data.bidActionState === s.state;
    this.setData({
      trumpDisplayVisible: visible,
      trumpChips: chips,
      trumpCaption: caption,
      declarableSuits: declSuits,
      declarableNoTrump: declNoTrump,
      bidPassLabel: passLabel,
      bidPassEnabled: passEnabled,
      bidActionOpen: keepOpen,
      bidActionState: keepOpen ? s.state : ""
    });
  },

  _oppInfo: function(s, absIdx) {
    var rp = this.data.roomPlayers[absIdx];
    var count = (s.players && s.players[absIdx]) ? s.players[absIdx].hand.length : 25;
    // 找该玩家最后一次非 pass 的叫分（亮主）
    var bidInfo = this._getOppBidInfo(s, absIdx);
    // 背面牌扇：用一组下标渲染对应数量的"牌背"，直观显示该玩家手里有一叠牌
    var n = Math.min(count, 5);
    var backs = [];
    for (var b = 0; b < n; b++) backs.push(b);
    var fallbackName = (s.players && s.players[absIdx] && s.players[absIdx].name) || ("玩家" + (absIdx + 1));
    return {
      initial: rp ? (rp.initial || getInitial(rp.nickname || rp.name)) : getInitial(fallbackName),
      name: rp ? (rp.nickname || rp.name || fallbackName) : fallbackName,
      seatNo: absIdx + 1,
      online: rp ? (rp.online !== false) : true,
      ready: rp ? !!rp.ready : true,
      count: count,
      backs: backs,
      bidSuit: bidInfo.suit,
      bidLabel: bidInfo.label,
      bidSuitClass: bidInfo.cls
    };
  },

  // 从 bidHistory 中找指定玩家最后一次非 pass 的叫分（亮主）
  _getOppBidInfo: function(s, absIdx) {
    var none = { suit: null, label: null, cls: null };
    if (!s.bidHistory || !s.bidHistory.length) return none;
    var suitMap = {
      big_joker:   { label: "大", cls: "suit-joker" },
      small_joker: { label: "小", cls: "suit-joker" },
      spade:       { label: "♠", cls: "suit-spade" },
      heart:       { label: "♥", cls: "suit-heart" },
      club:        { label: "♣", cls: "suit-club" },
      diamond:     { label: "♦", cls: "suit-diamond" }
    };
    for (var i = s.bidHistory.length - 1; i >= 0; i--) {
      var b = s.bidHistory[i];
      if (b.player === absIdx && b.bid !== "pass" && b.suit) {
        var m = suitMap[b.suit];
        if (m) return { suit: b.suit, label: m.label, cls: m.cls };
        return none;
      }
    }
    return none;
  },

  _updateTrickArea: function(s) {
    var myIdx = this.data.myIndex;
    var trickCards = [null,null,null,null];
    var slots = { top: null, left: null, right: null, bottom: null };
    if (s.currentTrick && s.currentTrick.length > 0) {
      for (var i=0;i<s.currentTrick.length;i++){
        var t = s.currentTrick[i];
        var lastCard = t.cards[t.cards.length-1];
        var rp = this.data.roomPlayers[t.player];
        var face = cardToHandItem(lastCard, i);
        var item = {
          display: lastCard.display || lastCard.toString(),
          red: !!face.isRed,
          rank: face.cornerRank,
          suit: face.cornerSuit,
          owner: rp ? (rp.nickname || rp.name || ("玩家" + (t.player + 1))) : ("玩家" + (t.player + 1))
        };
        trickCards[t.player] = item;
        // 绝对座位 → 相对方位（自己永远在 bottom）
        var rel = (t.player - myIdx + 4) % 4;
        slots[rel === 0 ? 'bottom' : rel === 1 ? 'right' : rel === 2 ? 'top' : 'left'] = item;
      }
    }
    this.setData({
      trickCards: trickCards,
      trickSlots: slots,
      hasPlayedCards: !!(s.currentTrick && s.currentTrick.length > 0)
    });
  },

  _getStateText: function(state) {
    var m = {bidding:"叫分阶段",reverse:"反主阶段",playing:"出牌阶段",scoring:"结算中",round_end:"本轮结束",game_end:"游戏结束"};
    return m[state]||state;
  },

  _getWaitingText: function(s) {
    if (s.state === "playing") {
      var trick = s.currentTrick || [];
      var expected = trick.length === 0
        ? s.currentTrickWinner
        : (trick[trick.length - 1].player + 1) % 4;
      if (expected === this.data.myIndex) return "轮到您出牌";
      return "等待玩家" + (expected + 1) + "出牌...";
    }
    if (s.state === "bidding") {
      if (s.currentBidderIndex === this.data.myIndex) return "轮到您叫分";
      return "等待玩家" + (s.currentBidderIndex + 1) + "叫分...";
    }
    if (s.state === "reverse") {
      if (s.currentBidderIndex === this.data.myIndex) return "是否反主？";
      return "等待玩家" + (s.currentBidderIndex + 1) + "决定反主...";
    }
    if (s.state === "scoring" || s.state === "round_end") return "本轮结束";
    return "等待中...";
  },

  onBack: function() {
    wx.navigateBack();
  },

  // ============ 座位按钮栏 ============
  // 坐下：站起后重新占座；后端回 joined 后按钮栏自动切成「已入座」
  onSitDown: function() {
    if (this.data.seated) { wx.showToast({ title: "你已经在座位上", icon: "none" }); return; }
    if (!wsClient || !wsClient.isConnected()) { wx.showToast({ title: "网络未连接", icon: "none" }); return; }
    var ok = wsClient.send({
      type: "sitDown",
      roomId: this.data.roomId,
      name: wx.getStorageSync("playerName") || "玩家",
      nickname: wx.getStorageSync("playerNickname") || "",
      avatar: wx.getStorageSync("playerAvatar") || "",
      playerId: wsClient.getOrCreatePlayerId ? wsClient.getOrCreatePlayerId() : ""
    });
    if (!ok) wx.showToast({ title: "发送失败，请重试", icon: "none" });
  },

  // 站起：让出座位转为旁观，仍留在房间看牌桌
  onStandUp: function() {
    if (!this.data.seated) { wx.showToast({ title: "当前是旁观状态", icon: "none" }); return; }
    if (this.data.gameStarted || this.data.roomInGame) {
      wx.showToast({ title: "本局进行中，请先点回大厅", icon: "none" });
      return;
    }
    if (!wsClient) return;
    wsClient.send({ type: "standUp" });
  },

  onSelfReady: function() {
    if (!wsClient) return;
    if (!this.data.seated) { wx.showToast({ title: "请先坐下再准备", icon: "none" }); return; }
    if (this.data.gameStarted || this.data.roomInGame) {
      wx.showToast({ title: "本局已开始，无需准备", icon: "none" });
      return;
    }
    wsClient.send({ type: "ready" });
  },

  // 回大厅：结束当前对局，清空准备状态，重新允许坐下/站起
  onBackToLobby: function() {
    if (!wsClient) return;
    wsClient.send({ type: "backToLobby" });
  },

  onLeaveRoom: function() {
    if (!wsClient) return;
    wsClient.send({ type: "leaveRoom" });
    if (wsClient.clearRoom) wsClient.clearRoom();
    wx.showToast({ title: "已退出房间", icon: "none" });
    setTimeout(function() {
      wx.navigateBack({
        delta: 1,
        fail: function() { wx.reLaunch({ url: "/pages/index/index" }); }
      });
    }, 500);
  },

  onDealCards: function() {
    if (!wsClient || !this.data.seated) return;
    // 统一走 startGame：服务端洗牌并广播 gameStart，四家同时进入发牌
    wx.showToast({ title: "正在开局发牌…", icon: "none", duration: 1200 });
    wsClient.send({type:"startGame"});
    this._scheduleAutoStart();
  },

  onCardTap: function(e) {
    var idx = parseInt(e.currentTarget.dataset.index);
    var h = this.data.myHand;
    if (!h[idx]) return;
    // 只翻转 selected，保留牌面渲染字段（cornerRank/groupStart 等），否则牌会变空白
    var next = h.map(function(x, i) {
      return i === idx ? Object.assign({}, x, { selected: !x.selected }) : x;
    });
    var sel = next.filter(function(x){return x.selected;});
    this.setData({ myHand: next, selectedCards: sel });
  },

  onPlayConfirm: function() {
    if (!wsClient||!this.session) return;
    var sel = this.data.selectedCards;
    if (!sel||sel.length===0) { wx.showToast({title:"请选择要出的牌",icon:"none"}); return; }
    // 前置校验：仅当轮到自己出牌时才发请求，避免给后端发无效请求触发 "[object Object]" 风格报错
    var s = this.session;
    if (s && s.state === "playing") {
      var trick = s.currentTrick || [];
      var expected = trick.length === 0
        ? s.currentTrickWinner
        : (trick[trick.length - 1].player + 1) % 4;
      if (expected !== this.data.myIndex) {
        wx.showToast({title: "还没轮到你出牌", icon:"none"}); return;
      }
    } else if (s && s.state !== "playing") {
      wx.showToast({title: "当前不在出牌阶段", icon:"none"}); return;
    }
    var cards = sel.map(function(h){return h.card;});
    wsClient.send({type:"playCards", cards:cards});
  },

  onClearSelection: function() {
    // 保留完整牌面字段，只清掉选中态
    var h = this.data.myHand.map(function(x) {
      return Object.assign({}, x, { selected: false });
    });
    this.setData({ myHand: h, selectedCards: [] });
  },

  onShareAppMessage: function() {
    return {title:"升级扑克 - 四人在线对战", path:"/pages/index/index"};
  }
});
