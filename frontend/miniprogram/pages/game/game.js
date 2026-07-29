var wsClient = null;
var levelNames = {two:"2",three:"3",four:"4",five:"5",six:"6",seven:"7",eight:"8",nine:"9",ten:"10",jack:"J",queen:"Q",king:"K",ace:"A"};
var suitNames = {spade:"黑桃",heart:"红桃",club:"梅花",diamond:"方块",none:"无",null:"无"};

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
    roomId: ""
  },

  onLoad: function(options) {
    var app = require("../../utils/wsClient");
    wsClient = app.createWsClient();
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
    
    wsClient.onMessage("roomUpdate", this._onRoomUpdate.bind(this));
    wsClient.onMessage("playerReady", this._onPlayerReady.bind(this));
    wsClient.onMessage("gameStart", this._onGameStart.bind(this));
    wsClient.onMessage("bidResult", this._onBidResult.bind(this));
    wsClient.onMessage("playResult", this._onPlayResult.bind(this));
    wsClient.onMessage("reverseResult", this._onReverseResult.bind(this));
    wsClient.onMessage("roundEnd", this._onRoundEnd.bind(this));
    wsClient.onMessage("error", this._onError.bind(this));

    // 关键修复：gameStart 消息在本页 onLoad 之前就已到达（index 页收到后才跳转过来），
    // 本页注册处理器时早已错过。index 页跳转前把 session 存进了 storage，这里直接采用。
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
            showBidActions: sess.state === "bidding" || sess.state === "reverse",
            showPlayActions: sess.state === "playing",
            waitingText: sess.state === "playing" ? "" : "等待叫分..."
          });
          this.refreshUI();
        }
      } catch(e) { console.error("[Game] Failed to parse pending session", e); }
    }
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
    this.setData({
      gameStarted: true,
      allReady: false,
      showBidActions: true,
      showPlayActions: false,
      waitingText: "等待叫分..."
    });
    this.refreshUI();
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
    wx.showToast({title: msg.message||"错误", icon:"none"});
  },

  refreshUI: function() {
    if (!this.session) return;
    var s = this.session;
    var myHand = [];
    var me = s.players ? s.players[this.data.myIndex] : null;
    if (me && me.hand) {
      myHand = me.hand.map(function(c) {
        return {
          card: c,
          display: c.display || c.toString(),
          selected: false,
          playable: true,
          red: (c.suit === "diamond" || c.suit === "heart")
        };
      });
    }
    var myIdx = this.data.myIndex;
    var isBidding = s.state === "bidding";
    var isReverse = s.state === "reverse";
    var isPlaying = s.state === "playing";
    var myBidTurn = isBidding && s.currentBidderIndex === myIdx;
    var myReverseTurn = isReverse && s.currentBidderIndex === myIdx;
    // 出牌轮次：墩内无人出牌时轮到 currentTrickWinner，否则是上一家的下一位
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
      myHand: myHand,
      myHandCount: myHand.length,
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
      p1Count: s.players&&s.players[1]?s.players[1].hand.length:25,
      p2Count: s.players&&s.players[2]?s.players[2].hand.length:25,
      p3Count: s.players&&s.players[3]?s.players[3].hand.length:25,
      oppTop: this._oppInfo(s, (myIdx + 2) % 4),
      oppLeft: this._oppInfo(s, (myIdx + 3) % 4),
      oppRight: this._oppInfo(s, (myIdx + 1) % 4),
      teamAScore: s.teamLevels?s.teamLevels[myIdx % 2]:0,
      teamBScore: s.teamLevels?s.teamLevels[1 - (myIdx % 2)]:0
    });
    this._updateTrickArea(s);
  },

  _oppInfo: function(s, absIdx) {
    var rp = this.data.roomPlayers[absIdx];
    var count = (s.players && s.players[absIdx]) ? s.players[absIdx].hand.length : 25;
    return {
      initial: rp ? (rp.initial || getInitial(rp.nickname || rp.name)) : '?',
      count: count
    };
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
