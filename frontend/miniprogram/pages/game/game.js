var wsClient = null;
var levelNames = {two:"2",three:"3",four:"4",five:"5",six:"6",seven:"7",eight:"8",nine:"9",ten:"10",jack:"J",queen:"Q",king:"K",ace:"A"};
var suitNames = {spade:"黑桃",heart:"红桃",club:"梅花",diamond:"方块",none:"无",null:"无"};

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
    var storedName = wx.getStorageSync("playerName") || "";
    // Fallback: if name matching fails, default to first player in room or index 0
    var myIndex = 0;
    if (storedName && players.length > 0) {
      var foundIdx = players.findIndex(function(p){return p.name === storedName;});
      if (foundIdx >= 0) myIndex = foundIdx;
    } else {
      myIndex = parseInt(wx.getStorageSync("myIndex")) || 0;
    }
    this.setData({
      gameStarted: false,
      roomId: roomId,
      myIndex: myIndex,
      roomPlayers: players,
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
  },

  _onRoomUpdate: function(msg) {
    console.log("[Game] roomUpdate", msg);
    if (msg.players) {
      this.setData({
        roomPlayers: msg.players,
        allReady: msg.players.every(function(p){return p.ready;}),
        p1Ready: msg.players[1]?msg.players[1].ready:false,
        p2Ready: msg.players[2]?msg.players[2].ready:false,
        p3Ready: msg.players[3]?msg.players[3].ready:false,
        selfReady: msg.players[this.data.myIndex]?msg.players[this.data.myIndex].ready:false
      });
    }
  },

  _onPlayerReady: function(msg) {
    console.log("[Game] playerReady", msg);
    // Use the players array from backend directly instead of guessing
    if (msg.players) {
      this.setData({
        roomPlayers: msg.players,
        allReady: msg.players.every(function(p){return p.ready;}),
        selfReady: msg.players[this.data.myIndex]?msg.players[this.data.myIndex].ready:false,
        p1Ready: msg.players[1]?msg.players[1].ready:false,
        p2Ready: msg.players[2]?msg.players[2].ready:false,
        p3Ready: msg.players[3]?msg.players[3].ready:false
      });
    } else {
      var players = this.data.roomPlayers;
      for (var i=0;i<players.length;i++){
        if(players[i].playerIndex===msg.playerIndex) players[i].ready=true;
      }
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
    this.setData({selectedCards: []});
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
    var isBidding = s.state === "bidding" || s.state === "reverse";
    var isPlaying = s.state === "playing";
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
      showBidActions: isBidding,
      showPlayActions: isPlaying,
      waitingText: this._getWaitingText(s),
      currentPlayerIndex: s.currentBidderIndex,
      p1Count: s.players&&s.players[1]?s.players[1].hand.length:25,
      p2Count: s.players&&s.players[2]?s.players[2].hand.length:25,
      p3Count: s.players&&s.players[3]?s.players[3].hand.length:25,
      teamAScore: s.teamLevels?s.teamLevels[0]:0,
      teamBScore: s.teamLevels?s.teamLevels[1]:0
    });
    this._updateTrickArea(s);
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
      if (s.currentTrick && s.currentTrick.length > 0 && s.currentTrick[s.currentTrick.length-1].player === this.data.myIndex) {
        return "等待您出牌";
      }
      return "等待对手出牌...";
    }
    if (s.state === "bidding") return "等待叫分...";
    if (s.state === "reverse") return "等待反主...";
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

  onBidOne: function() { if(wsClient&&this.session) wsClient.send({type:"bid",bid:"1"}); },
  onBidTwo: function() { if(wsClient&&this.session) wsClient.send({type:"bid",bid:"2"}); },
  onBidThree: function() { if(wsClient&&this.session) wsClient.send({type:"bid",bid:"3"}); },

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
