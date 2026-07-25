/**
 * WebSocket 客户端工具
 * 连接后端服务器，管理房间和游戏状态同步
 */

// 开发环境用本地地址，部署时改成云函数或公网地址
// Railway deployment URL
var SERVER_URL = 'wss://shengji-backend-production.up.railway.app';

// 全局单例
var wsClient = null;

function createWsClient() {
  if (wsClient) return wsClient;

  console.log('[WS] Creating client, connecting to:', SERVER_URL);
  
  var socketTask = wx.connectSocket({
    url: SERVER_URL,
    success: function() {
      console.log('[WS] connectSocket called successfully');
    },
    fail: function(err) {
      console.error('[WS] connectSocket failed:', err);
    }
  });

  wsClient = {
    _socketTask: socketTask,
    _connected: false,
    _msgId: 0,
    _messageHandlers: {},
    _onConnect: null,
    _onMessage: null,

    onConnect: function(fn) { this._onConnect = fn; },
    onMessage: function(type, fn) {
      if (!this._messageHandlers[type]) this._messageHandlers[type] = [];
      this._messageHandlers[type].push(fn);
    },
    offMessage: function(type, fn) {
      if (!this._messageHandlers[type]) return;
      this._messageHandlers[type] = this._messageHandlers[type].filter(function(h) { return h !== fn; });
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
      if (this._socketTask) {
        this._socketTask.close();
      }
      this._connected = false;
      wsClient = null;
    },

    isConnected: function() {
      return this._connected;
    }
  };

  socketTask.onOpen(function() {
    console.log('[WS] Socket OPEN - connection established!');
    wsClient._connected = true;
    if (wsClient._onConnect) wsClient._onConnect();
  });

  socketTask.onMessage(function(res) {
    try {
      var msg = JSON.parse(res.data);
      console.log('[WS] Received:', msg.type, msg.msgId || '');

      if (wsClient._messageHandlers && wsClient._messageHandlers[msg.type]) {
        wsClient._messageHandlers[msg.type].forEach(function(fn) {
          fn(msg);
        });
      }

      if (wsClient._onMessage) wsClient._onMessage(msg);
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  });

  socketTask.onClose(function() {
    console.log('[WS] Socket CLOSE');
    wsClient._connected = false;
    wsClient = null;
  });

  socketTask.onError(function(err) {
    console.error('[WS] Socket ERROR:', err);
    console.error('[WS] Error details:', JSON.stringify(err));
    wsClient._connected = false;
  });

  return wsClient;
}

module.exports = {
  createWsClient: createWsClient,
  SERVER_URL: SERVER_URL
};
