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
    // Set default player name from WeChat
    let playerName = '玩家';
    try {
      const setting = wx.getSystemSetting ? wx.getSystemSetting() : {};
      const appBaseInfo = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {};
      if (appBaseInfo.nickName) {
        playerName = appBaseInfo.nickName.substring(0, 8);
      } else if (appBaseInfo.deviceBrand) {
        playerName = appBaseInfo.deviceBrand.substring(0, 6);
      }
    } catch(e) {}
    wx.setStorageSync('playerName', playerName);
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
      // Update room list whenever any room changes
      if (msg.room) {
        // Fetch updated room list
        wsClient.send({ type: 'getRooms' });
      }
      if (msg.room && msg.players) {
        // This is a room we joined
        var players = (msg.players || []).map(function(p) {
          return {
            name: p.name,
            nickname: p.nickname || '',
            avatar: p.avatar || '',
            playerIndex: p.playerIndex,
            ready: p.ready || false
          };
        });
        var storedName = wx.getStorageSync("playerName") || "";
        var selfIdx = storedName ? players.findIndex(function(p){return p.name === storedName;}) : parseInt(wx.getStorageSync("myIndex")) || 0;
        wx.setStorageSync('currentRoomId', msg.room.id);
        // Store players with initial property for game page
        players = players.map(function(p) {
          var initial = p.name ? p.name.charAt(0).toUpperCase() : '?';
          return {...p, initial: initial};
        });
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
      this.setData({ connected: true, roomList: rooms });
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
          // Ensure initial property exists
          players = players.map(function(p) {
            if (!p.initial) {
              p.initial = p.name ? p.name.charAt(0).toUpperCase() : '?';
            }
            return p;
          });
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
    if (!wsClient || !wsClient.isConnected()) { wx.showToast({ title: "服务器未连接", icon: "none" }); return; }
    if (this.data.inRoom) { wx.showToast({ title: "已在房间内", icon: "none" }); return; }
    this.setData({ inRoom: true });
    wsClient.send({ type: 'createRoom', name: wx.getStorageSync('playerName') || '玩家', nickname: wx.getStorageSync('playerNickname') || '', avatar: wx.getStorageSync('playerAvatar') || '' });
  },

  onJoinRoomIdInput: function(e) {
    this.setData({ joinRoomId: e.detail.value.trim() });
  },

  onJoinRoom: function() {
    var roomId = this.data.joinRoomId;
    if (!roomId) return;
    if (!wsClient) return;
    if (this.data.inRoom) {
      wx.showToast({ title: '已在房间内，请先退出', icon: 'none' });
      return;
    }
    wsClient.send({ type: 'joinRoom', roomId: roomId, name: wx.getStorageSync('playerName') || '玩家', nickname: wx.getStorageSync('playerNickname') || '', avatar: wx.getStorageSync('playerAvatar') || '' });
    this.setData({ joinRoomId: '' });
  },

  onJoinRoomById: function(e) {
    var room = e.currentTarget.dataset.room;
    if (!room || room.playerCount >= room.maxPlayers) return;
    if (!wsClient) return;
    if (this.data.inRoom) {
      wx.showToast({ title: '已在房间内，请先退出', icon: 'none' });
      return;
    }
    wsClient.send({ type: 'joinRoom', roomId: room.id, name: wx.getStorageSync('playerName') || '玩家', nickname: wx.getStorageSync('playerNickname') || '', avatar: wx.getStorageSync('playerAvatar') || '' });
  },

  onToggleReady: function() {
    if (!wsClient || !this.data.inRoom) return;
    wsClient.send({ type: 'ready' });
  },
  
  onRules: function() {
    wx.navigateTo({ url: '/pages/rules/rules' });
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

  onInviteFriends: function() {
    // Show share popup
    wx.showShareMenu({ withShareTicket: true });
    wx.showToast({ title: '点击右上角"分享"按钮邀请好友', icon: 'none', duration: 3000 });
  },

  onAbout: function() {
    wx.showToast({ title: '升级扑克 v1.0 在线版', icon: 'none' });
  },

  onShareAppMessage: function() {
    return {
      title: '来玩升级扑克！四人在线对战',
      path: '/pages/index/index?roomId=' + this.data.currentRoomId
    };
  }
});


