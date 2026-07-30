/**
 * WebSocket 客户端工具
 * - 连接后端服务器
 * - 管理房间和游戏状态同步
 * - 断线后自动重连，恢复座位和准备状态
 */

// Railway deployment URL
var SERVER_URL = 'wss://shengji-backend-production.up.railway.app';

// 全局单例
var wsClient = null;

// 指数退避：1s, 2s, 4s, 8s, 16s, 30s（上限）
var RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

function createWsClient() {
  if (wsClient) return wsClient;

  console.log('[WS] Creating client, connecting to:', SERVER_URL);

  var self = {
    _socketTask: null,
    _connected: false,
    _msgId: 0,
    _messageHandlers: {},
    _onConnect: null,
    _onDisconnect: null,
    _onReconnecting: null,
    _connectCallbacks: [],   // 多个 onConnect 回调都保留
    _disconnectCallbacks: [], // 多个 onDisconnect 回调
    _reconnectCallbacks: [],  // 多个 onReconnecting 回调
    _reconnectAttempt: 0,
    _reconnectTimer: null,
    _connecting: false,
    _intentionalClose: false,
    // 持久化的身份信息（用于断线重连后自动 rejoin）
    _savedName: '',
    _savedNickname: '',
    _savedAvatar: '',
    _savedPlayerId: '',
    _savedRoomId: '',
    _savedMyIndex: -1,

    onConnect: function(fn) {
      if (fn) this._connectCallbacks.push(fn);
    },
    onDisconnect: function(fn) {
      if (fn) this._disconnectCallbacks.push(fn);
    },
    onReconnecting: function(fn) {
      if (fn) this._reconnectCallbacks.push(fn);
    },
    onMessage: function(type, fn) {
      if (!this._messageHandlers[type]) this._messageHandlers[type] = [];
      this._messageHandlers[type].push(fn);
    },
    offMessage: function(type, fn) {
      if (!this._messageHandlers[type]) return;
      this._messageHandlers[type] = this._messageHandlers[type].filter(function(h) { return h !== fn; });
    },

    /**
     * 记录身份信息，断线重连时用
     */
    saveIdentity: function(opts) {
      if (opts.name) this._savedName = opts.name;
      if (opts.nickname !== undefined) this._savedNickname = opts.nickname;
      if (opts.avatar !== undefined) this._savedAvatar = opts.avatar;
      if (opts.playerId) this._savedPlayerId = opts.playerId;
      if (opts.roomId) this._savedRoomId = opts.roomId;
      if (typeof opts.myIndex === 'number' && opts.myIndex >= 0) this._savedMyIndex = opts.myIndex;
    },

    getIdentity: function() {
      return {
        name: this._savedName,
        nickname: this._savedNickname,
        avatar: this._savedAvatar,
        playerId: this._savedPlayerId || getOrCreatePlayerId(),
        roomId: this._savedRoomId,
        myIndex: this._savedMyIndex
      };
    },

    send: function(data) {
      if (!this._connected) {
        console.warn('[WS] Not connected, message dropped:', data.type);
        return false;
      }
      this._msgId++;
      data.msgId = this._msgId;
      var json = JSON.stringify(data);
      this._socketTask.send({ data: json });
      console.log('[WS] Sent:', data.type, data.msgId);
      return true;
    },

    close: function() {
      // 用户主动退出：标记不再重连
      this._intentionalClose = true;
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      if (this._socketTask) {
        try { this._socketTask.close(); } catch (e) {}
      }
      this._connected = false;
      this._savedRoomId = '';
      this._savedMyIndex = -1;
      wsClient = null;
    },

    isConnected: function() {
      return this._connected;
    },

    // 暴露获取/创建稳定 playerId 的方法（断线重连用）
    getOrCreatePlayerId: function() {
      return getOrCreatePlayerId();
    },

    /**
     * 立即重连（用于 onShow：从后台切回前台时，若发现已掉线，马上重建连接，
     * 而不是等下一次退避计时器）。非主动关闭时才生效。
     */
    reconnectNow: function() {
      if (this._intentionalClose) return;
      if (this._connected) return;
      if (this._connecting) return; // 已有连接尝试在进行，避免重复建连
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      this._reconnectAttempt = 0;
      console.log('[WS] reconnectNow() 立即重连');
      this._connect();
    },

    /**
     * 实际创建 socket task
     */
    _connect: function() {
      this._connecting = true;
      var socketTask = wx.connectSocket({
        url: SERVER_URL,
        success: function() { console.log('[WS] connectSocket called'); },
        fail: function(err) { console.error('[WS] connectSocket fail:', err); }
      });
      this._socketTask = socketTask;

      socketTask.onOpen(function() {
        console.log('[WS] Socket OPEN');
        self._connected = true;
        self._connecting = false;
        self._reconnectAttempt = 0;
        // 调用所有 onConnect 回调
        self._connectCallbacks.forEach(function(fn) {
          try { fn(); } catch(e) { console.error('[WS] onConnect cb error', e); }
        });

        // 自动重新加入房间（断线重连场景）
        var ident = self.getIdentity();
        if (ident.roomId && ident.name) {
          console.log('[WS] 自动重新加入房间', ident.roomId, 'as', ident.name, 'playerId=', ident.playerId);
          setTimeout(function() {
            self._socketTask.send({ data: JSON.stringify({
              type: 'joinRoom',
              roomId: ident.roomId,
              name: ident.name,
              nickname: ident.nickname || '',
              avatar: ident.avatar || '',
              playerId: ident.playerId
            })});
          }, 100);
        }
      });

      socketTask.onMessage(function(res) {
        try {
          var msg = JSON.parse(res.data);
          console.log('[WS] Received:', msg.type);
          if (self._messageHandlers && self._messageHandlers[msg.type]) {
            self._messageHandlers[msg.type].forEach(function(fn) {
              try { fn(msg); } catch (e) { console.error('[WS] Handler error', e); }
            });
          }
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      });

      socketTask.onClose(function() {
        console.log('[WS] Socket CLOSE, intentional=' + self._intentionalClose);
        var wasConnected = self._connected;
        self._connected = false;
        self._connecting = false;

        if (self._intentionalClose) return; // 主动关闭，不重连

        // 触发 onDisconnect 回调（首次断开）
        if (wasConnected) {
          self._disconnectCallbacks.forEach(function(fn) {
            try { fn(); } catch(e) { console.error('[WS] onDisconnect cb error', e); }
          });
        }

        // 触发 onReconnecting
        var delay = RECONNECT_DELAYS[Math.min(self._reconnectAttempt, RECONNECT_DELAYS.length-1)];
        self._reconnectCallbacks.forEach(function(fn) {
          try { fn(self._reconnectAttempt, delay); } catch(e) {}
        });

        // 安排重连
        self._reconnectAttempt++;
        console.log('[WS] 将在 ' + delay + 'ms 后重连（第 ' + self._reconnectAttempt + ' 次）');
        self._reconnectTimer = setTimeout(function() {
          self._reconnectTimer = null;
          self._connect();
        }, delay);
      });

      socketTask.onError(function(err) {
        console.error('[WS] Socket ERROR:', err);
        self._connected = false;
        // onClose 会紧接着触发，那里负责重连
      });
    }
  };

  self._connect();
  wsClient = self;
  return wsClient;
}

// 生成客户端稳定身份标识（playerId），用于断线重连时匹配原座位。
// 优先读本地存储，避免每次进入都变；存到 wx storage 持久化。
function getOrCreatePlayerId() {
  try {
    var pid = wx.getStorageSync('playerId');
    if (pid) return pid;
    pid = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    wx.setStorageSync('playerId', pid);
    return pid;
  } catch (e) {
    return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }
}

module.exports = {
  createWsClient: createWsClient,
  getOrCreatePlayerId: getOrCreatePlayerId,
  SERVER_URL: SERVER_URL
};
