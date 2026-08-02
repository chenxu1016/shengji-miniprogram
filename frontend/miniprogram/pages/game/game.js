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
    selected: false,
    playable: true,
    dealing: false
  };
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

function sortHandByRule(hand, trumpSuit, level) {
  if (!hand || !hand.length) return hand;
  var trump = (trumpSuit && trumpSuit !== "none") ? trumpSuit : null;
  return hand.slice().sort(function(a, b) {
    var ag = _handGroup(a, trump, level), bg = _handGroup(b, trump, level);
    if (ag !== bg) return ag - bg;                    // 小组排前（大王最左）
    var as = SUIT_RANK[a.suit] || 0, bs = SUIT_RANK[b.suit] || 0;
    if (as !== bs) return bs - as;                    // 黑桃优先排最左
    return (VALUE_RANK[b.value] || 0) - (VALUE_RANK[a.value] || 0);  // 大点排前
  });
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

Page({
  data: {
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
    // 新增：中央亮主区
    trumpDisplayVisible: false,
    trumpChips: [
      { key: "big_joker",   label: "大", suitClass: "suit-joker",   lit: false, dim: true },
      { key: "small_joker", label: "小", suitClass: "suit-joker",   lit: false, dim: true },
      { key: "spade",       label: "♠", suitClass: "suit-spade",   lit: false, dim: true },
      { key: "heart",       label: "♥", suitClass: "suit-heart",   lit: false, dim: true },
      { key: "club",        label: "♣", suitClass: "suit-club",    lit: false, dim: true },
      { key: "diamond",     label: "♦", suitClass: "suit-diamond", lit: false, dim: true }
    ],
    trumpCaption: "等待叫主",
    // 发牌动画
    dealing: false,
    dealingText: "发牌中...",
    dealingDone: 0,
    // 反牌倒计时（发完牌后给其他人 15s 考虑反主）
    reverseCountdown: 0,
    reverseCountdownActive: false,
    reverseCountdownTotal: 15
  },

  onLoad: function(options) {
    var app = require("../../utils/wsClient");
    wsClient = app.createWsClient();
    var self = this;  // 顶层 self，供异步回调使用
    var roomId = options.roomId || wx.getStorageSync("currentRoomId") || "";
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
    if (players.length > 0) {
      myIndex = Math.min(Math.max(myIndex, 0), players.length - 1);
    }

    this.setData({
      gameStarted: false,
      roomId: roomId,
      myIndex: myIndex,
      roomPlayers: players,
      roomPlayerCount: players.length,
      selfReady: players[myIndex] ? players[myIndex].ready : false,
      allReady: players.length > 0 ? players.every(function(p){return p.ready;}) : false
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

    wsClient.onMessage("roomUpdate", this._onRoomUpdate.bind(this));
    wsClient.onMessage("playerReady", this._onPlayerReady.bind(this));
    wsClient.onMessage("gameStart", this._onGameStart.bind(this));
    wsClient.onMessage("bidResult", this._onBidResult.bind(this));
    wsClient.onMessage("playResult", this._onPlayResult.bind(this));
    wsClient.onMessage("reverseResult", this._onReverseResult.bind(this));
    wsClient.onMessage("roundEnd", this._onRoundEnd.bind(this));
    wsClient.onMessage("playerOffline", this._onPlayerOffline.bind(this));
    wsClient.onMessage("gameReconnect", this._onGameReconnect.bind(this));
    wsClient.onMessage("error", this._onError.bind(this));

    // 关键修复：gameStart 消息在本页 onLoad 之前就已到达（index 页收到后才跳转过来），
    // 本页注册处理器时早已错过。index 页跳转前把 session 存进了 storage，这里直接采用。
    // ★ 关键：采纳 session 时必须先播发牌动画（如果本会话还没播过），再让 refreshUI 接管。
    // 防止重复触发：用 storage 记录 "已播过发牌的 sessionId"，同一会话只在首次进入时播放。
    var pendingSession = wx.getStorageSync("gameSession");
    if (pendingSession) {
      try {
        var sess = JSON.parse(pendingSession);
        if (sess && sess.state && sess.state !== "finished") {
          console.log("[Game] Adopting pending gameSession from storage, state=", sess.state);
          this.session = sess;
          this.setData({
            gameStarted: true,
            allReady: false,
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

  // 从后台/其他页面切回前台时，若 WebSocket 已断开，立即重连并恢复对局
  onShow: function() {
    var app = require("../../utils/wsClient");
    var c = app.createWsClient();
    if (c.reconnectNow) c.reconnectNow();
  },

  _onRoomUpdate: function(msg) {
    console.log("[Game] roomUpdate", msg);
    if (msg.players) {
      // Add initial property to each player
      var players = msg.players.map(function(p) {
        var initial = getInitial(p.name || p.nickname || '?');
        return {...p, initial: initial};
      });
      this.setData({
        roomPlayers: players,
        roomPlayerCount: players.length,
        allReady: players.every(function(p){return p.ready;}),
        p1Ready: players[1]?players[1].ready:false,
        p2Ready: players[2]?players[2].ready:false,
        p3Ready: players[3]?players[3].ready:false,
        selfReady: players[this.data.myIndex]?players[this.data.myIndex].ready:false
      });
    }
  },

  _onPlayerReady: function(msg) {
    console.log("[Game] playerReady", msg);
    // Use the players array from backend directly instead of guessing
    if (msg.players) {
      // Add initial property to each player
      var players = msg.players.map(function(p) {
        var initial = getInitial(p.name || p.nickname || '?');
        return {...p, initial: initial};
      });
      this.setData({
        roomPlayers: players,
        roomPlayerCount: players.length,
        allReady: players.every(function(p){return p.ready;}),
        selfReady: players[this.data.myIndex]?players[this.data.myIndex].ready:false,
        p1Ready: players[1]?players[1].ready:false,
        p2Ready: players[2]?players[2].ready:false,
        p3Ready: players[3]?players[3].ready:false
      });
    } else {
      var players = this.data.roomPlayers;
      for (var i=0;i<players.length;i++){
        if(players[i].playerIndex===msg.playerIndex) players[i].ready=true;
      }
      // Add initial property if missing
      players = players.map(function(p) {
        if (!p.initial) {
          p.initial = getInitial(p.name || p.nickname || '?');
        }
        return p;
      });
      this.setData({
        roomPlayers: players,
        allReady: players.every(function(p){return p.ready;}),
        selfReady: players[this.data.myIndex]?players[this.data.myIndex].ready:false,
        p1Ready: players[1]?players[1].ready:false,
        p2Ready: players[2]?players[2].ready:false,
        p3Ready: players[3]?players[3].ready:false
      });
    }
  },

  _onGameStart: function(msg) {
    console.log("[Game] gameStart", msg);
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    // 注意：dealingShown 标记改到 _animateDeal 播完时才置位，避免提前置位导致
    // onLoad 采纳 session 时误判"已播过"而跳过逐张发牌动画

    this.setData({
      gameStarted: true,
      allReady: false,
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

  // 发牌动画：逐张把牌从我方手牌区加入，每张 200ms 错开
  // 同步把 4 家手牌数从 0 涨到 total
  // 全部发完后启动 15 秒"反牌倒计时"，给非庄家考虑反主的机会
  // fromAdoption: true=来自 onLoad 采纳（标记已发牌完成，避免重入时再播）
  _animateDeal: function(s, fromAdoption) {
    var me = s.players ? s.players[this.data.myIndex] : null;
    // 先按升级规则排序（大王→小王→级牌→主花色→副牌），再逐张发，发完即有序
    var rawHand = (me && me.hand) ? me.hand : [];
    var sortedHand = sortHandByRule(rawHand, s.trumpSuit, s.level);
    var fullHand = sortedHand.map(function(c, i) { return cardToHandItem(c, i); });
    var total = fullHand.length || 25;
    var self = this;
    // 防重入：同一会话只播一次，避免 _onGameStart 与 onLoad 采纳重复触发
    if (self._dealAnimating) return;
    self._dealAnimating = true;
    var stepMs = 500;  // 每张牌 500ms（用户要求"0.5秒发一张"），25 张 = 12.5s 明显可见

    // 发牌一开始就把对手区、记分面板、亮主色条等 UI 全部渲染出来。
    // 之前的实现这里直接进逐张动画循环，导致 oppTop/oppLeft/oppRight 一直是 undefined，
    // 三个对手整局都看不见。refreshUI 只读 session 不会动 myHand（发牌循环自己逐张追加），
    // 所以这里调用一次不会破坏发牌动画。
    self._safeRefreshUI(s);

    // 发牌一开始就把“可亮/可反主花色”点亮到中间色条（满足“发牌过程中色条亮起”的需求）
    self._updateTrumpDisplay(s);

    // 起始：清空手牌（防重入）
    this.setData({
      myHand: [],
      myHandCount: 0,
      p1Count: 0, p2Count: 0, p3Count: 0,
      dealingDone: 0
    });

    var k = 0;
    function next() {
      if (k >= total) {
        // 全部发完：标记"已播过发牌动画"，启动 15 秒反牌倒计时
        self._dealAnimating = false;
        wx.setStorageSync("dealingShown_" + (s.id || self.data.roomId), "1");
        self.setData({
          dealing: false,
          dealingDone: total,
          dealingText: "发牌完成"
        });
        // 短暂停顿 400ms 让用户看到"发牌完成"提示
        setTimeout(function() { self._startReverseCountdown(s); }, 400);
        return;
      }
      // 把第 k 张牌加到 myHand，并附 dealing-in class 触发翻牌动画
      var newCard = Object.assign({}, fullHand[k], { dealing: true });
      var newHand = self.data.myHand.concat([newCard]);
      self.setData({
        myHand: newHand,
        myHandCount: newHand.length,
        p1Count: k + 1,
        p2Count: k + 1,
        p3Count: k + 1,
        dealingDone: k + 1,
        dealingText: "发牌中 " + (k + 1) + "/" + total
      });
      k++;
      setTimeout(next, stepMs);
    }
    setTimeout(next, 300);  // 初始 300ms 缓冲（让 setData 生效）
  },

  // 启动 15 秒"反牌倒计时"
  _startReverseCountdown: function(s) {
    var self = this;
    var total = this.data.reverseCountdownTotal || 15;
    console.log("[Game] 启动反牌倒计时 " + total + "s");
    this.setData({
      reverseCountdownActive: true,
      reverseCountdown: total,
      showBidActions: false,
      showReverseActions: false,
      waitingText: "请看牌，剩余 " + total + " 秒可反主"
    });
    var _tick = function() {
      if (!self.data.reverseCountdownActive) return;
      var n = self.data.reverseCountdown - 1;
      if (n <= 0) {
        // 倒计时结束：进入叫分阶段
        self.setData({
          reverseCountdown: 0,
          reverseCountdownActive: false,
          waitingText: (s.currentBidderIndex === self.data.myIndex) ? "轮到您叫分" : ("等待玩家" + (s.currentBidderIndex + 1) + "叫分..."),
          showBidActions: (s.currentBidderIndex === self.data.myIndex)
        });
        return;
      }
      self.setData({
        reverseCountdown: n,
        waitingText: "请看牌，剩余 " + n + " 秒可反主"
      });
      setTimeout(_tick, 1000);
    };
    setTimeout(_tick, 1000);
  },

  // 用户点击"开始叫分"提前结束反牌倒计时
  onSkipReverseCountdown: function() {
    if (!this.data.reverseCountdownActive) return;
    this.setData({ reverseCountdown: 0, reverseCountdownActive: false });
    var s = this.session;
    if (!s) return;
    this.setData({
      waitingText: (s.currentBidderIndex === this.data.myIndex) ? "轮到您叫分" : ("等待玩家" + (s.currentBidderIndex + 1) + "叫分..."),
      showBidActions: (s.currentBidderIndex === this.data.myIndex)
    });
    wx.showToast({ title: "进入叫分阶段", icon: "none", duration: 1200 });
  },

  // 点击亮主区横条的某个 chip：
  //  - 叫分阶段：以"亮主"(0分)叫分并指定花色（后端已放开回合，任何持有王+级牌者可随时亮主）
  //  - 反主阶段且轮到自己：以该花色反主
  // 大/小王 chip 暂不支持无主，提示改用花色
  onTrumpChipTap: function(e) {
    if (!wsClient || !this.session) return;
    var suit = e.currentTarget.dataset.suit;
    if (!suit) return;
    // 大/小王 chip 不支持无主，引导点花色
    if (suit === "big_joker" || suit === "small_joker") {
      wx.showToast({ title: "请点 红桃/方片/黑桃/梅花 亮主或反主", icon: "none" });
      return;
    }
    var s = this.session;
    var myTurn = (s.state === "bidding" && s.currentBidderIndex === this.data.myIndex)
              || (s.state === "reverse" && s.currentBidderIndex === this.data.myIndex);
    var action = "";
    if (s.state === "bidding") action = "bid";                 // 亮主：叫分阶段可随时
    else if (s.state === "reverse" && myTurn) action = "reverse";
    if (!action) {
      wx.showToast({ title: (s.state === "reverse" ? "还没轮到你反主" : "当前不能亮主"), icon: "none" });
      return;
    }
    var suitLabel = suitNames[suit] || suit;
    var verb = (action === "reverse") ? "反主" : "亮主";
    wx.showModal({
      title: verb + "确认",
      content: "以 " + suitLabel + " 为主花色（" + verb + "），是否确定？",
      confirmText: verb,
      cancelText: "取消",
      success: function(res) {
        if (res.confirm) {
          if (action === "reverse") {
            wsClient.send({ type: "reverse", option: { suit: suit } });
          } else {
            wsClient.send({ type: "bid", bid: "0", suit: suit });
          }
        }
      }
    });
  },

  _onBidResult: function(msg) {
    console.log("[Game] bidResult", msg);
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    this.setData({showSuitSelector: false, waitingText: "等待其他玩家叫分..."});
    this.refreshUI();
  },

  _onReverseResult: function(msg) {
    console.log("[Game] reverseResult", msg);
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    this.refreshUI();
  },

  _onPlayResult: function(msg) {
    console.log("[Game] playResult", msg);
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    this.refreshUI();
  },

  _onRoundEnd: function(msg) {
    console.log("[Game] roundEnd", msg);
    this.session = msg.session;
    wx.setStorageSync("gameSession", JSON.stringify(msg.session));
    this.refreshUI();
  },

  _onError: function(msg) {
    console.error("[Game] error", msg);
    // 兼容 message 可能是对象/数字/null 的情况（之前直接传对象会被 WeChat 强制 toString 成 "[object Object]"）
    var raw = msg && msg.message;
    var title;
    if (raw == null) {
      title = "错误";
    } else if (typeof raw === "string") {
      title = raw;
    } else {
      try { title = JSON.stringify(raw); } catch (e) { title = "错误"; }
    }
    if (!title) title = "错误";
    wx.showToast({title: title, icon:"none"});
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
    if (!msg.session) return;
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

  refreshUI: function() {
    if (!this.session) return;
    this._safeRefreshUI(this.session);
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
    if (isPlaying) {
      var trick = s.currentTrick || [];
      var expected = trick.length === 0
        ? s.currentTrickWinner
        : (trick[trick.length - 1].player + 1) % 4;
      myPlayTurn = expected === myIdx;
    }
    var trumpText = s.trumpSuit ? suitNames[s.trumpSuit] || s.trumpSuit : "无主";
    var levelText = levelNames[s.level] || s.level || "2";
    var bidScoreText = (s.bidScore > 0 ? s.bidScore + "分" : "-");

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
      p1Count: s.players && s.players[1] ? s.players[1].hand.length : 25,
      p2Count: s.players && s.players[2] ? s.players[2].hand.length : 25,
      p3Count: s.players && s.players[3] ? s.players[3].hand.length : 25,
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

  _updateScorePanel: function(s) {
    var myIdx = this.data.myIndex;
    var myTeam = myIdx % 2;          // 0 或 1
    var oppTeam = 1 - myTeam;
    var myLevel = (s.teamLevels && s.teamLevels[myTeam] !== undefined) ? (s.teamLevels[myTeam] + 2) : 2;
    var oppLevel = (s.teamLevels && s.teamLevels[oppTeam] !== undefined) ? (s.teamLevels[oppTeam] + 2) : 2;
    var pts = this._calcRoundPoints(s, myTeam);
    // trumpText 用 finalSuit 或 trumpSuit
    var trumpSuit = s.finalSuit || s.trumpSuit;
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
    // 当前已确认的主花色：叫分阶段用最后一次有效叫分（从 bidHistory），其他阶段用 finalSuit/trumpSuit
    var currentSuit = s.finalSuit || s.trumpSuit || null;
    if (s.state === "bidding" && s.bidHistory && s.bidHistory.length > 0 && !currentSuit) {
      // 找最后一次非 pass 的叫分
      for (var i = s.bidHistory.length - 1; i >= 0; i--) {
        var b = s.bidHistory[i];
        if (b.bid !== "pass" && b.suit) {
          currentSuit = b.suit;
          break;
        }
      }
    }
    var myIdx = this.data.myIndex;
    var myTurn = (s.state === "bidding" && s.currentBidderIndex === myIdx)
              || (s.state === "reverse" && s.currentBidderIndex === myIdx);
    // 本局“我”可亮/可反的主花色（基于本人手牌 + 当前级别）
    var meHand = (s.players && s.players[myIdx]) ? s.players[myIdx].hand : [];
    var decl = _computeDeclarableSuits(meHand, s.level);
    var declSuits = decl.suits;
    var declNoTrump = decl.noTrump;
    // 当前阶段是否允许操作：叫分阶段任何玩家可亮主；反主阶段仅轮到者
    var canAct = (s.state === "bidding") || (s.state === "reverse" && myTurn);

    var chipDefs = [
      { key: "big_joker",   label: "大", suitClass: "suit-joker" },
      { key: "small_joker", label: "小", suitClass: "suit-joker" },
      { key: "spade",       label: "♠", suitClass: "suit-spade" },
      { key: "heart",       label: "♥", suitClass: "suit-heart" },
      { key: "club",        label: "♣", suitClass: "suit-club" },
      { key: "diamond",     label: "♦", suitClass: "suit-diamond" }
    ];
    var chips = chipDefs.map(function(d) {
      var isCurrent = (d.key === currentSuit);
      var isAvail = (declSuits.indexOf(d.key) >= 0) ||
                    (declNoTrump && (d.key === "big_joker" || d.key === "small_joker"));
      return {
        key: d.key,
        label: d.label,
        suitClass: d.suitClass,
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
        caption = "已叫" + (suitNames[currentSuit] || currentSuit) + " " + bidScoreStr;
      } else if (declSuits.length > 0) {
        caption = "你有可亮主花色，点上方色块即可亮主";
      } else {
        caption = myTurn ? "点上方花色亮主" : "等待叫主";
      }
    } else if (s.state === "reverse") {
      if (declSuits.length > 0) {
        var availNames = declSuits.map(function(x) { return suitNames[x] || x; }).join("/");
        caption = myTurn ? ("点上方色块反主（可反 " + availNames + "）") : ("等待反主，你可反 " + availNames);
      } else {
        caption = myTurn ? "你无可反主，点“不反主”" : "等待其他玩家反主";
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
    this.setData({
      trumpDisplayVisible: visible,
      trumpChips: chips,
      trumpCaption: caption,
      declarableSuits: declSuits,
      declarableNoTrump: declNoTrump
    });
  },

  _oppInfo: function(s, absIdx) {
    var rp = this.data.roomPlayers[absIdx];
    var count = (s.players && s.players[absIdx]) ? s.players[absIdx].hand.length : 25;
    // 找该玩家最后一次非 pass 的叫分（亮主）
    var bidInfo = this._getOppBidInfo(s, absIdx);
    // 背面牌扇：用一组下标渲染对应数量的"牌背"，直观显示该玩家手里有一叠牌
    var n = Math.min(count, 17);
    var backs = [];
    for (var b = 0; b < n; b++) backs.push(b);
    return {
      initial: rp ? (rp.initial || getInitial(rp.nickname || rp.name)) : '?',
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
    var trickCards = [null,null,null,null];
    if (s.currentTrick && s.currentTrick.length > 0) {
      for (var i=0;i<s.currentTrick.length;i++){
        var t = s.currentTrick[i];
        var lastCard = t.cards[t.cards.length-1];
        trickCards[t.player] = {display: lastCard.display||lastCard.toString(), red: lastCard.suit==="diamond"||lastCard.suit==="heart"};
      }
    }
    this.setData({trickCards: trickCards, hasPlayedCards: s.currentTrick&&s.currentTrick.length>0});
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
  onSelfReady: function() {
    if (!wsClient) return;
    wsClient.send({type:"ready"});
  },
  onDealCards: function() {
    if (!wsClient) return;
    wsClient.send({type:"dealCards"});
  },

  onBidPass: function() {
    if (!wsClient||!this.session) return;
    wsClient.send({type:"bid", bid:"pass"});
  },

  onBidZero: function() {
    if (!wsClient||!this.session) return;
    wx.showActionSheet({
      itemList:["黑桃","红桃","梅花","方块"],
      success: function(res){
        var suits=["spade","heart","club","diamond"];
        wsClient.send({type:"bid", bid:"0", suit:suits[res.tapIndex]});
      }
    });
  },

  // 数字叫分必须带主花色（后端强制校验）
  _bidWithSuit: function(bid) {
    if (!wsClient || !this.session) return;
    wx.showActionSheet({
      itemList: ["黑桃", "红桃", "梅花", "方块"],
      success: function(res) {
        var suits = ["spade", "heart", "club", "diamond"];
        wsClient.send({ type: "bid", bid: bid, suit: suits[res.tapIndex] });
      }
    });
  },
  onBidOne: function() { this._bidWithSuit("1"); },
  onBidTwo: function() { this._bidWithSuit("2"); },
  onBidThree: function() { this._bidWithSuit("3"); },

  onSkipReverse: function() {
    if (!wsClient || !this.session) return;
    wsClient.send({ type: "skipReverse" });
  },

  onCardTap: function(e) {
    var idx = parseInt(e.currentTarget.dataset.index);
    var h = this.data.myHand;
    h[idx].selected = !h[idx].selected;
    var sel = h.filter(function(x){return x.selected;});
    this.setData({myHand:h, selectedCards:sel});
  },

  onPlayConfirm: function() {
    if (!wsClient||!this.session) return;
    var sel = this.data.selectedCards;
    if (!sel||sel.length===0) { wx.showToast({title:"请选择要出的牌",icon:"none"}); return; }
    var cards = sel.map(function(h){return h.card;});
    wsClient.send({type:"playCards", cards:cards});
  },

  onClearSelection: function() {
    var h = this.data.myHand.map(function(x){return {card:x.card,display:x.display,selected:false,playable:true,red:x.red};});
    this.setData({myHand:h, selectedCards:[]});
  },

  onShareAppMessage: function() {
    return {title:"升级扑克 - 四人在线对战", path:"/pages/index/index"};
  }
});
