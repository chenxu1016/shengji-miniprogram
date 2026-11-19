var wsClient = null;

// 房间固定 4 个座位：即使还没坐满，也把空位渲染出来，一屏看清四人同桌状态
function buildRoomSeats(players, myIndex) {
  var seats = [];
  for (var i = 0; i < 4; i++) {
    var p = players[i];
    if (p) {
      seats.push(Object.assign({}, p, {
        seatNo: i + 1,
        isSelf: i === myIndex,
        empty: false,
        initial: p.initial || (p.name ? p.name.charAt(0).toUpperCase() : String(i + 1))
      }));
    } else {
      seats.push({ seatNo: i + 1, isSelf: i === myIndex, empty: true, name: '', nickname: '', avatar: '', initial: '', ready: false });
    }
  }
  return seats;
}

Page({
  data: {
    connected: false,
    connectFailed: false,
    inRoom: false,
    currentRoomId: '',
    roomPlayers: [],
    roomPlayerCount: 0,
    myIndex: -1,
    selfReady: false,
    allReady: false,
    roomList: [],
    joinRoomId: '',
    myNickname: '',
    myAvatar: '',
    refreshing: false,
    serverUrl: '',
    serverUrlInput: '',
    roomSeats: buildRoomSeats([], -1),
    autoStarting: false
  },

  onLoad(options) {
    // 好友通过分享卡片进入时携带的房间号，连上服务器后自动加入
    this._shareRoomId = (options && options.roomId) ? String(options.roomId) : '';
    this._autoStartTimer = null;
    this._lastNavAt = 0;
    var wsUtil = require('../../utils/wsClient');
    this.setData({ serverUrl: wsUtil.getServerUrl(), serverUrlInput: wsUtil.getServerUrl() });
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
      this.setData({ connectFailed: false });
      // Fetch existing rooms（收到 roomList 后才置 connected=true，避免大厅空着闪一下）
      wsClient.send({ type: 'getRooms' });
      // 好友经分享卡片进入：连上后自动加入对应房间
      if (this._shareRoomId && !this.data.inRoom) {
        var rid = this._shareRoomId;
        this._shareRoomId = '';
        var pid = wsClient.getOrCreatePlayerId ? wsClient.getOrCreatePlayerId() : '';
        wsClient.send({ type: 'joinRoom', roomId: rid, name: wx.getStorageSync('playerName') || '玩家', nickname: wx.getStorageSync('playerNickname') || '', avatar: wx.getStorageSync('playerAvatar') || '', playerId: pid });
      }
    }.bind(this));

    wsClient.onConnectFailed(function(lastUrl) {
      console.log('[Index] 所有服务器候选均连接失败，最后尝试:', lastUrl);
      this.setData({ connectFailed: true });
    }.bind(this));

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
        // 优先用后端 joined 消息下发的权威座位号（昵称匹配在重名时会判错）
        var selfIdx = (typeof this.data.myIndex === 'number' && this.data.myIndex >= 0) ? this.data.myIndex : 0;
        // 本窗口内存里若有服务端下发的权威座位号，优先用它（多账号调试共享 storage 不可信）
        if (wsClient.localGet) {
          var memIdx = wsClient.localGet('myIndex');
          if (typeof memIdx === 'number' && memIdx >= 0) selfIdx = memIdx;
        }
        if (selfIdx >= players.length) selfIdx = 0;
        try {
          wx.setStorageSync('currentRoomId', msg.room.id);
          wx.setStorageSync('myIndex', String(selfIdx));
        } catch (e) {}
        if (wsClient.localSet) wsClient.localSet('myIndex', selfIdx);
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
          allReady: players.length === 4 && players.every(function(p) { return p.ready; }),
          roomSeats: buildRoomSeats(players, selfIdx)
        });
      }
    }.bind(this));

    // 后端单发：自己的权威座位号（建房=0，进房=实际序号，有人退出后会重发）
    wsClient.onMessage('joined', function(msg) {
      console.log('[Index] joined:', msg);
      try {
        wx.setStorageSync('myIndex', String(msg.playerIndex));
        wx.setStorageSync('currentRoomId', msg.roomId);
        if (msg.playerId) wx.setStorageSync('playerId', msg.playerId);
      } catch (e) {}
      // ★ 本窗口内存同步：多账号调试各窗口共享 storage，座位号必须以本窗口内存为准
      if (wsClient.localSet) {
        wsClient.localSet('myIndex', msg.playerIndex);
        wsClient.localSet('roomId', msg.roomId);
        if (msg.playerId) wsClient.localSet('playerId', msg.playerId);
      }
      if (wsClient && wsClient.saveIdentity) {
        wsClient.saveIdentity({ playerId: msg.playerId || '', roomId: msg.roomId, myIndex: msg.playerIndex });
      }
      this.setData({ myIndex: msg.playerIndex, inRoom: true, currentRoomId: msg.roomId });
    }.bind(this));

    wsClient.onMessage('gameStart', function(msg) {
      var self = this;
      console.log('[Index] Game starting...');
      if (self._autoStartTimer) { clearTimeout(self._autoStartTimer); self._autoStartTimer = null; }
      self.setData({ autoStarting: false });
      var now = Date.now();
      // 3s 内重复的 gameStart 只处理一次，避免重复压栈多个牌桌页
      if (self._lastNavAt && now - self._lastNavAt < 3000) return;
      self._lastNavAt = now;
      // ★ 会话写本窗口内存（权威），storage 仅留作单窗口冷启动兜底。
      // 多账号调试共享 storage，若只写 storage 4 个窗口会采纳同一份 session。
      if (wsClient.localSet) wsClient.localSet('gameSession', msg.session);
      try { wx.setStorageSync('gameSession', JSON.stringify(msg.session)); } catch (e) {}
      // 已经在牌桌页时只更新会话，由牌桌页自己处理 gameStart
      var onGame = getCurrentPages().some(function(p) { return p.route === 'pages/game/game'; });
      if (onGame) return;
      wx.navigateTo({ url: '/pages/game/game?roomId=' + (msg.room && msg.room.id || self.data.currentRoomId) });
    }.bind(this));

    wsClient.onMessage('error', function(msg) {
      wx.showToast({ title: msg.message || '错误', icon: 'none' });
    });

    wsClient.onMessage('roomList', function(msg) {
      console.log('[Index] roomList:', msg);
      var rooms = (msg.rooms || []).map(function(r) {
        return { id: r.id, playerCount: r.playerCount, maxPlayers: r.maxPlayers, gameState: r.gameState };
      });
      this.setData({ connected: true, roomList: rooms, refreshing: false });
    }.bind(this));


    wsClient.onMessage('playerReady', function(msg) {
      console.log('[Index] playerReady:', msg);
      // 直接采用后端广播的权威 players 数组（含每人最新 ready 状态）
      var players = (msg.players || []).map(function(p) {
        return {
          name: p.name,
          nickname: p.nickname || '',
          avatar: p.avatar || '',
          playerIndex: p.playerIndex,
          ready: p.ready || false,
          initial: p.name ? p.name.charAt(0).toUpperCase() : '?'
        };
      });
      if (!players.length) return;
      var myIdx = this.data.myIndex;
      var me = players.find(function(p) { return p.playerIndex === myIdx; });
      wx.setStorageSync('roomPlayers', JSON.stringify(players));
      var canStart = !!msg.canStart || (players.length === 4 && players.every(function(p) { return p.ready; }));
      this.setData({
        roomPlayers: players,
        roomPlayerCount: players.length,
        roomSeats: buildRoomSeats(players, myIdx),
        selfReady: me ? me.ready : false,
        allReady: canStart,
        autoStarting: canStart
      });

      // 兜底：后端正常情况下会立刻广播 gameStart；若 1.5s 内没收到（旧版服务端 /
      // 消息丢失），客户端主动请求一次开局，保证「四人都准备 → 自动发牌」一定发生。
      // 服务端 startGame 有 3s 去重，重复请求不会洗两次牌。
      if (canStart && !this._autoStartTimer) {
        var self = this;
        this._autoStartTimer = setTimeout(function() {
          self._autoStartTimer = null;
          if (self._lastNavAt && Date.now() - self._lastNavAt < 4000) return;  // 已经进牌桌了
          if (wsClient && wsClient.isConnected()) {
            console.log('[Index] 未收到 gameStart，兜底请求 startGame');
            wsClient.send({ type: 'startGame' });
          }
        }, 1500);
      }
    }.bind(this));
  },

  onCreateRoom: function() {
    if (!wsClient || !wsClient.isConnected()) { wx.showToast({ title: "服务器未连接", icon: "none" }); return; }
    if (this.data.inRoom) { wx.showToast({ title: "已在房间内", icon: "none" }); return; }
    this.setData({ inRoom: true });
    var name = wx.getStorageSync('playerName') || '玩家';
    var nickname = wx.getStorageSync('playerNickname') || '';
    var avatar = wx.getStorageSync('playerAvatar') || '';
    var playerId = wsClient.getOrCreatePlayerId ? wsClient.getOrCreatePlayerId() : '';
    wsClient.saveIdentity({ name: name, nickname: nickname, avatar: avatar, playerId: playerId });
    wsClient.send({ type: 'createRoom', name: name, nickname: nickname, avatar: avatar, playerId: playerId });
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
    var name = wx.getStorageSync('playerName') || '玩家';
    var nickname = wx.getStorageSync('playerNickname') || '';
    var avatar = wx.getStorageSync('playerAvatar') || '';
    var playerId = wsClient.getOrCreatePlayerId ? wsClient.getOrCreatePlayerId() : '';
    wsClient.saveIdentity({ name: name, nickname: nickname, avatar: avatar, playerId: playerId, roomId: roomId });
    wsClient.send({ type: 'joinRoom', roomId: roomId, name: name, nickname: nickname, avatar: avatar, playerId: playerId });
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
    var name = wx.getStorageSync('playerName') || '玩家';
    var nickname = wx.getStorageSync('playerNickname') || '';
    var avatar = wx.getStorageSync('playerAvatar') || '';
    var playerId = wsClient.getOrCreatePlayerId ? wsClient.getOrCreatePlayerId() : '';
    wsClient.saveIdentity({ name: name, nickname: nickname, avatar: avatar, playerId: playerId, roomId: room.id });
    wsClient.send({ type: 'joinRoom', roomId: room.id, name: name, nickname: nickname, avatar: avatar, playerId: playerId });
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

  // ===== 服务器地址设置（开发者工具默认连本机 8888；真机填电脑局域网 IP）=====
  onServerUrlInput: function(e) {
    this.setData({ serverUrlInput: (e.detail.value || '').trim() });
  },

  onApplyServerUrl: function() {
    var url = (this.data.serverUrlInput || '').trim();
    var app = require('../../utils/wsClient');
    app.setServerUrl(url);   // 留空 = 恢复默认 ws://localhost:8888
    wx.showToast({ title: '已切换，正在重连', icon: 'none', duration: 1200 });
    setTimeout(function() {
      wx.reLaunch({ url: '/pages/index/index' });  // 重新加载以注册新连接的消息处理器
    }, 500);
  },

  onLeaveRoom: function() {
    if (this._autoStartTimer) { clearTimeout(this._autoStartTimer); this._autoStartTimer = null; }
    if (wsClient) {
      wsClient.send({ type: 'leaveRoom' });
      // 清除身份信息（断线重连就不会再自动 rejoin 这个房间）
      if (wsClient.saveIdentity) {
        wsClient.saveIdentity({ roomId: '', myIndex: -1 });
      }
      // 同步清本窗口内存，否则下次进房仍带着旧座位号
      if (wsClient.localSet) {
        wsClient.localSet('myIndex', -1);
        wsClient.localSet('roomId', '');
        wsClient.localSet('gameSession', null);
        wsClient.localSet('dealingShown', {});
      }
    }
    try {
      wx.removeStorageSync('currentRoomId');
    wx.removeStorageSync('myIndex');
      wx.removeStorageSync('roomPlayers');
      wx.removeStorageSync('gameSession');
    } catch (e) {}
    this.setData({
      inRoom: false,
      currentRoomId: '',
      roomPlayers: [],
      roomPlayerCount: 0,
      myIndex: -1,
      selfReady: false,
      allReady: false,
      autoStarting: false,
      roomSeats: buildRoomSeats([], -1)
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

  // 右上角"刷新"按钮：手动向服务器拉取最新房间列表
  onRefreshRooms: function() {
    if (!wsClient || !wsClient.isConnected()) {
      wx.showToast({ title: '服务器未连接', icon: 'none' });
      return;
    }
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    wsClient.send({ type: 'getRooms' });
    // 兜底：若 800ms 内未收到 roomList，也停止旋转动画
    setTimeout(function() {
      if (this.data.refreshing) this.setData({ refreshing: false });
    }.bind(this), 800);
  },

  // 切回前台时，若已掉线立即重连（修复：切后台再回来变成离线、别人无法准备）
  onShow: function() {
    var app = require('../../utils/wsClient');
    var c = app.createWsClient();
    if (c.reconnectNow) c.reconnectNow();
    this.setData({ serverUrl: c.getActiveUrl ? c.getActiveUrl() : app.getServerUrl() });
    // 回显已同步的微信昵称 / 头像
    var nick = wx.getStorageSync('playerNickname') || '';
    var av = wx.getStorageSync('playerAvatar') || '';
    if (nick !== this.data.myNickname || av !== this.data.myAvatar) {
      this.setData({ myNickname: nick, myAvatar: av });
    }
  },

  // 微信头像选择（button open-type="chooseAvatar"）
  onChooseAvatar: function(e) {
    var avatarUrl = (e.detail && e.detail.avatarUrl) || '';
    if (!avatarUrl) return;
    wx.setStorageSync('playerAvatar', avatarUrl);
    this.setData({ myAvatar: avatarUrl });
    this._syncProfile();
  },

  // 微信昵称输入（input type="nickname"）
  onNicknameInput: function(e) {
    var nick = (e.detail && e.detail.value) || '';
    wx.setStorageSync('playerNickname', nick);
    this.setData({ myNickname: nick });
    this._syncProfile();
  },

  // 把最新头像/昵称同步给后端（若已在房间则实时更新所有人显示）
  _syncProfile: function() {
    var nickname = wx.getStorageSync('playerNickname') || '';
    var avatar = wx.getStorageSync('playerAvatar') || '';
    if (wsClient && wsClient.isConnected()) {
      var playerId = wsClient.getOrCreatePlayerId ? wsClient.getOrCreatePlayerId() : '';
      wsClient.send({ type: 'updateProfile', nickname: nickname, avatar: avatar, playerId: playerId });
    }
  },

  onShareAppMessage: function() {
    return {
      title: '来玩升级扑克！四人在线对战',
      path: '/pages/index/index?roomId=' + this.data.currentRoomId
    };
  }
});


