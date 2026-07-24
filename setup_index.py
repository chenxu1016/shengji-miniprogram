import os

base = r'D:\Software\shengji-miniprogram\frontend\miniprogram'

# ===== index.wxml =====
path = os.path.join(base, 'pages/index/index.wxml')
content = """<view class="container">
  <view class="title-area">
    <text class="title">升级</text>
    <text class="subtitle">四人在线对战</text>
  </view>

  <!-- 未连接状态 -->
  <view class="section" wx:if="{{!connected}}">
    <view class="status-text">正在连接服务器...</view>
  </view>

  <!-- 已连接 - 房间大厅 -->
  <view class="lobby" wx:if="{{connected}}">
    <view class="lobby-card">
      <view class="card-header">
        <text class="card-title">在线房间</text>
        <text class="room-count">共 {{roomList.length}} 间</text>
      </view>

      <button class="btn btn-create" bindtap="onCreateRoom">
        <text class="btn-icon">+</text>
        <text>创建房间</text>
      </button>

      <view class="join-section">
        <input class="input-room-id" placeholder="输入房间号" value="{{joinRoomId}}" bindinput="onJoinRoomIdInput" />
        <button class="btn btn-join" bindtap="onJoinRoom" disabled="{{!joinRoomId}}">加入房间</button>
      </view>

      <view class="room-list" wx:if="{{roomList.length > 0}}">
        <view class="room-item" wx:for="{{roomList}}" wx:key="id" bindtap="onJoinRoomById" data-room="{{item}}">
          <view class="room-info">
            <text class="room-name">房间 {{item.id}}</text>
            <text class="room-players">{{item.playerCount}}/{{item.maxPlayers}} 人</text>
          </view>
          <view class="room-status {{item.playerCount >= item.maxPlayers ? 'full' : 'open'}}">
            {{item.playerCount >= item.maxPlayers ? '已满' : '可加入'}}
          </view>
        </view>
      </view>
    </view>
  </view>

  <!-- 在房间内 -->
  <view class="in-room" wx:if="{{inRoom}}">
    <view class="room-panel">
      <view class="room-header">
        <text class="room-id">房间 {{currentRoomId}}</text>
        <text class="player-count">{{roomPlayerCount}}/4 人</text>
      </view>

      <view class="player-list">
        <view class="player-item {{index === myIndex ? 'self' : ''}}" wx:for="{{roomPlayers}}" wx:key="index">
          <view class="player-avatar">{{index + 1}}</view>
          <text class="player-name">{{item.name}}</text>
          <text class="player-ready {{item.ready ? 'ready' : ''}}">{{item.ready ? '已准备' : '等待'}}</text>
        </view>
      </view>

      <view class="action-area">
        <button class="btn btn-ready {{selfReady ? 'ready-btn' : ''}}" bindtap="onToggleReady">
          {{selfReady ? '已准备' : '准备'}}
        </button>
        <button class="btn btn-start" bindtap="onStartGame" wx:if="{{allReady}}">
          开始游戏
        </button>
        <button class="btn btn-leave" bindtap="onLeaveRoom">
          退出房间
        </button>
      </view>

      <view class="waiting-hint" wx:if="{{!allReady && roomPlayerCount < 4}}">
        <text>等待其他玩家加入...</text>
      </view>
      <view class="waiting-hint" wx:elif="{{!allReady}}">
        <text>所有人准备好后开始游戏</text>
      </view>
    </view>
  </view>

  <view class="info">
    <text>双升 · 拖拉机 · 升级</text>
    <text class="version">v1.0 在线版</text>
  </view>
</view>
"""
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done:', path)

# ===== index.wxss =====
path = os.path.join(base, 'pages/index/index.wxss')
content = """.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #0f4c2e 0%, #1a6e3a 50%, #0f4c2e 100%);
  padding: 40rpx;
}

.title-area {
  text-align: center;
  margin-bottom: 60rpx;
}

.title {
  font-size: 80rpx;
  font-weight: bold;
  color: #ffd700;
  text-shadow: 2rpx 4rpx 8rpx rgba(0,0,0,0.5);
}

.subtitle {
  font-size: 28rpx;
  color: rgba(255,255,255,0.7);
  margin-top: 12rpx;
}

.status-text {
  color: rgba(255,255,255,0.6);
  font-size: 28rpx;
}

.lobby {
  width: 100%;
  max-width: 680rpx;
}

.lobby-card {
  background: rgba(0,0,0,0.3);
  border-radius: 24rpx;
  padding: 32rpx;
  backdrop-filter: blur(10rpx);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}

.card-title {
  font-size: 32rpx;
  font-weight: bold;
  color: white;
}

.room-count {
  font-size: 24rpx;
  color: rgba(255,255,255,0.5);
}

.btn {
  width: 100%;
  height: 88rpx;
  border-radius: 16rpx;
  font-size: 32rpx;
  font-weight: 500;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
}

.btn-icon {
  font-size: 36rpx;
  font-weight: bold;
}

.btn-create {
  background: linear-gradient(135deg, #ffd700, #ffaa00);
  color: #333;
  box-shadow: 0 8rpx 24rpx rgba(255,215,0,0.3);
  margin-bottom: 24rpx;
}

.join-section {
  display: flex;
  gap: 16rpx;
  margin-bottom: 32rpx;
}

.input-room-id {
  flex: 1;
  height: 88rpx;
  background: rgba(255,255,255,0.15);
  border-radius: 16rpx;
  padding: 0 24rpx;
  color: white;
  font-size: 28rpx;
}

.input-room-id::placeholder {
  color: rgba(255,255,255,0.4);
}

.btn-join {
  width: 200rpx;
  background: rgba(255,255,255,0.2);
  color: white;
  backdrop-filter: blur(10rpx);
}

.btn-join[disabled] {
  opacity: 0.4;
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.room-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255,255,255,0.1);
  border-radius: 16rpx;
  padding: 24rpx;
}

.room-info {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.room-name {
  font-size: 28rpx;
  font-weight: bold;
  color: white;
}

.room-players {
  font-size: 24rpx;
  color: rgba(255,255,255,0.6);
}

.room-status {
  font-size: 24rpx;
  padding: 8rpx 16rpx;
  border-radius: 20rpx;
}

.room-status.open {
  background: rgba(34,197,94,0.2);
  color: #4ade80;
}

.room-status.full {
  background: rgba(239,68,68,0.2);
  color: #f87171;
}

/* ===== 在房间内 ===== */
.in-room {
  width: 100%;
  max-width: 680rpx;
}

.room-panel {
  background: rgba(0,0,0,0.3);
  border-radius: 24rpx;
  padding: 32rpx;
}

.room-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32rpx;
}

.room-id {
  font-size: 36rpx;
  font-weight: bold;
  color: #ffd700;
}

.player-count {
  font-size: 28rpx;
  color: rgba(255,255,255,0.7);
}

.player-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-bottom: 32rpx;
}

.player-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: rgba(255,255,255,0.08);
  border-radius: 16rpx;
  padding: 20rpx;
}

.player-item.self {
  background: rgba(255,215,0,0.15);
  border: 2rpx solid rgba(255,215,0,0.3);
}

.player-avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  font-weight: bold;
  color: white;
  flex-shrink: 0;
}

.player-item.self .player-avatar {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}

.player-name {
  flex: 1;
  font-size: 28rpx;
  color: white;
}

.player-ready {
  font-size: 24rpx;
  color: rgba(255,255,255,0.5);
}

.player-ready.ready {
  color: #4ade80;
}

.action-area {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.btn-ready {
  background: rgba(255,255,255,0.2);
  color: white;
}

.btn-ready.ready-btn {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: white;
}

.btn-start {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
  box-shadow: 0 8rpx 24rpx rgba(245,158,11,0.4);
}

.btn-leave {
  background: rgba(239,68,68,0.2);
  color: #f87171;
}

.waiting-hint {
  text-align: center;
  margin-top: 24rpx;
  font-size: 24rpx;
  color: rgba(255,255,255,0.5);
}

.info {
  margin-top: 60rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  font-size: 24rpx;
  color: rgba(255,255,255,0.4);
}
"""
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done:', path)

# ===== index.js =====
path = os.path.join(base, 'pages/index/index.js')
content = """var wsClient = null;

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

  onLaunch() {
    this.connectServer();
  },

  connectServer() {
    var app = require('../../utils/wsClient');
    wsClient = app.createWsClient();

    wsClient.onConnect(function() {
      console.log('[Index] Connected to server');
      // 本地测试：自动创建房间
      wsClient.send({ type: 'createRoom', name: '我' });
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

    wsClient.onMessage('playerReady', function(msg) {
      console.log('[Index] playerReady:', msg);
      // 刷新玩家列表
      var stored = wx.getStorageSync('roomPlayers');
      if (stored) {
        try {
          var players = JSON.parse(stored);
          for (var i = 0; i < players.length; i++) {
            if (players[i].playerIndex === msg.playerIndex) {
              players[i].ready = true;
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
"""
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done:', path)

print('All index files done')
