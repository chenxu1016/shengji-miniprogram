var wsClient = null;

Page({
  data: {
    connected: false,
    inRoom: false,
    currentRoomId: '',
    roomPlayers: [],
    roomPlayerCount: 0,
    myIndex: -1,
    selfReady: false,
    allReady: false,
    roomList: [],
    joinRoomId: ''
  },

  onLoad() {
    this.connectServer();
  },

  connectServer() {
    var app = require('../../utils/wsClient');
    wsClient = app.createWsClient();

    wsClient.onConnect(function() {
      console.log('[Index] Connected to server');
      // Fetch existing rooms
      wsClient.send({ type: 'getRooms' });
    });

    wsClient.onMessage('roomUpdate', function(msg) {
      console.log('[Index] roomUpdate:', msg);
      if (msg.room) {
        var players = (msg.players || []).map(function(p) {
          return {
            name: p.name,
            playerIndex: p.playerIndex,
            ready: p.ready || false
          };
        });
        var selfIdx = parseInt(wx.getStorageSync('myIndex')) || 0;
        wx.setStorageSync('currentRoomId', msg.room.id);
        wx.setStorageSync('roomPlayers', JSON.stringify(players));
        this.setData({
          connected: true,
          inRoom: true,
          currentRoomId: msg.room.id,
          roomPlayers: players,
          roomPlayerCount: players.length,
          myIndex: selfIdx,
          selfReady: players[selfIdx] ? players[selfIdx].ready : false,
          allReady: players.every(function(p) { return p.ready; })
        });
      }
    }.bind(this));

    wsClient.onMessage('gameStart', function(msg) {
      console.log('[Index] Game starting...');
      wx.setStorageSync('gameSession', JSON.stringify(msg.session));
      wx.navigateTo({ url: '/pages/game/game?roomId=' + msg.room.id });
    });

    wsClient.onMessage('error', function(msg) {
      wx.showToast({ title: msg.message || '错误', icon: 'none' });
    });

    wsClient.onMessage('roomList', function(msg) {
      console.log('[Index] roomList:', msg);
      var rooms = (msg.rooms || []).map(function(r) {
        return { id: r.id, playerCount: r.playerCount, maxPlayers: r.maxPlayers, gameState: r.gameState };
      });
      this.setData({ roomList: rooms });
    }.bind(this));

    wsClient.onMessage('playerReady', function(msg) {
      console.log('[Index] playerReady:', msg);
      var stored = wx.getStorageSync('roomPlayers');
      if (stored) {
        try {
          var players = JSON.parse(stored);
          for (var i = 0; i < players.length; i++) {
            if (players[i].playerIndex === msg.playerIndex) {
              players[i].ready = msg.allReady ? true : players[i].ready;
            }
          }
          wx.setStorageSync('roomPlayers', JSON.stringify(players));
          this.setData({
            roomPlayers: players,
            allReady: players.every(function(p) { return p.ready; })
          });
        } catch(e) {}
      }
    }.bind(this));
  },

  onCreateRoom: function() {
    if (!wsClient) return;
    wsClient.send({ type: 'createRoom', name: '我' });
  },

  onJoinRoomIdInput: function(e) {
    this.setData({ joinRoomId: e.detail.value.trim() });
  },

  onJoinRoom: function() {
    var roomId = this.data.joinRoomId;
    if (!roomId) return;
    if (!wsClient) return;
    wsClient.send({ type: 'joinRoom', roomId: roomId, name: '我' });
    this.setData({ joinRoomId: '' });
  },

  onJoinRoomById: function(e) {
    var room = e.currentTarget.dataset.room;
    if (!room || room.playerCount >= room.maxPlayers) return;
    if (!wsClient) return;
    wsClient.send({ type: 'joinRoom', roomId: room.id, name: '我' });
  },

  onToggleReady: function() {
    if (!wsClient || !this.data.inRoom) return;
    wsClient.send({ type: 'ready' });
    var ready = !this.data.selfReady;
    var players = this.data.roomPlayers.map(function(p, i) {
      if (i === this.data.myIndex) p.ready = ready;
      return p;
    }.bind(this));
    this.setData({ selfReady: ready, roomPlayers: players, allReady: players.every(function(p){return p.ready;}) });
    wx.setStorageSync('roomPlayers', JSON.stringify(players));
  },

  onStartGame: function() {
    if (!wsClient) return;
    wsClient.send({ type: 'startGame' });
  },

  onLeaveRoom: function() {
    if (wsClient) {
      wsClient.send({ type: 'leaveRoom' });
    }
    wx.removeStorageSync('currentRoomId');
    wx.removeStorageSync('myIndex');
    wx.removeStorageSync('roomPlayers');
    wx.removeStorageSync('gameSession');
    this.setData({
      inRoom: false,
      currentRoomId: '',
      roomPlayers: [],
      roomPlayerCount: 0,
      myIndex: -1,
      selfReady: false,
      allReady: false
    });
  },

  onRules() {
    wx.showToast({ title: '规则开发中', icon: 'none' });
  },

  onAbout() {
    wx.showToast({ title: '升级扑克 v1.0 在线版', icon: 'none' });
  }
});
