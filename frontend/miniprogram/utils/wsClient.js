/**
 * WebSocket 客户端工具
 * - 连接后端服务器
 * - 管理房间和游戏状态同步
 * - 断线后自动重连，恢复座位和准备状态
 */

// 服务器地址：
// - 默认连本机后端 ws://localhost:8888（微信开发者工具模拟器可直接连，需先运行根目录 start-backend.cmd）
// - 真机调试：在首页「服务器地址」填 ws://<电脑局域网IP>:8888，会写入 storage 并优先使用
// - 线上 Railway 地址当前返回 404 Application not found，仅作为本地未启动时的备用尝试
var DEFAULT_SERVER_URL = 'ws://localhost:8888';
var BACKUP_SERVER_URL = 'wss://shengji-backend-production.up.railway.app';

function readCustomServerUrl() {
  try { return wx.getStorageSync('serverUrl') || ''; } catch (e) { return ''; }
}

function getServerUrl() {
  return readCustomServerUrl() || DEFAULT_SERVER_URL;
}

function buildCandidates() {
  var list = [];
  var custom = readCustomServerUrl();
  if (custom) list.push(custom);
  if (list.indexOf(DEFAULT_SERVER_URL) < 0) list.push(DEFAULT_SERVER_URL);
  if (list.indexOf(BACKUP_SERVER_URL) < 0) list.push(BACKUP_SERVER_URL);
  return list;
}

// 切换服务器地址：保存配置 + 关掉旧连接。
// 调用方随后重新加载页面，由 connectServer() 用新地址重建客户端并重新注册消息处理器。
function setServerUrl(url) {
  try {
    if (url) wx.setStorageSync('serverUrl', url);
    else wx.removeStorageSync('serverUrl');
  } catch (e) {}
  if (wsClient) {
    try { wsClient.close(); } catch (e) {}
    wsClient = null;
  }
}

// 全局单例
var wsClient = null;

// ===== 本窗口私有状态（内存，不落 storage）=====
// 微信开发者工具「多账号调试」的多个窗口共享同一份 wx.Storage，
// 但每个窗口有独立的 JS 运行时内存。playerId / myIndex / gameSession /
// dealingShown 这类「我是谁、我这局的状态」必须存内存，否则 4 个窗口
// 互相覆盖，表现为「四人同不了桌 / 只看得到一家牌 / 都以为自己是座位0」。
// 内存里没有时（冷启动）才回退到 storage。
var _local = {
  playerId: '',
  myIndex: -1,
  roomId: '',
  gameSession: null,   // 已解析对象，不是字符串
  dealingShown: {}     // key: sessionId -> true
};
function localGet(key) { return _local[key]; }
function localSet(key, val) { _local[key] = val; }
function localClear() {
  _local.playerId = '';
  _local.myIndex = -1;
  _local.roomId = '';
  _local.gameSession = null;
  _local.dealingShown = {};
}

// 指数退避：1s, 2s, 4s, 8s, 16s, 30s（上限）
var RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

function createWsClient() {
  if (wsClient) return wsClient;

  console.log('[WS] Creating client, connecting to:', getServerUrl());

  var self = {
    _socketTask: null,
    _connected: false,
    _msgId: 0,
    _messageHandlers: {},
    _onConnect: null,
    _onDisconnect: null,
    _onReconnecting: null,
    _onConnectFailed: null,
    _connectCallbacks: [],   // 多个 onConnect 回调都保留
    _disconnectCallbacks: [], // 多个 onDisconnect 回调
    _reconnectCallbacks: [],  // 多个 onReconnecting 回调
    _reconnectAttempt: 0,
    _reconnectTimer: null,
    _connecting: false,
    _intentionalClose: false,
    // 多候选地址：本地后端优先；本地没启动时自动尝试备用地址
    _candidates: buildCandidates(),
    _candidateIndex: 0,
    _lockedUrl: '',       // 连通过一次后锁定该地址，之后断线只重连它
    _everOpened: false,
    _currentUrl: '',
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
    onConnectFailed: function(fn) {
      this._onConnectFailed = fn;
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
      if (opts.roomId !== undefined) this._savedRoomId = opts.roomId;
      if (typeof opts.myIndex === 'number' && opts.myIndex >= 0) this._savedMyIndex = opts.myIndex;
    },

    // 旁观态：站起后仍留在房间，但断线重连只能恢复旁观，不能自动占座
    setSpectatorMode: function(flag) {
      try {
        if (flag) wx.setStorageSync('spectatorMode', '1');
        else wx.removeStorageSync('spectatorMode');
      } catch (e) {}
    },

    isSpectator: function() {
      try {
        var v = wx.getStorageSync('spectatorMode');
        return v === '1' || v === 1 || v === true;
      } catch (e) { return false; }
    },

    // 退出房间：清掉身份与对局缓存，防止重连时又自动 joinRoom
    clearRoom: function() {
      this._savedRoomId = '';
      this._savedMyIndex = -1;
      _local.roomId = '';
      _local.myIndex = -1;
      _local.gameSession = null;
      _local.dealingShown = {};
      try {
        wx.removeStorageSync('currentRoomId');
        wx.removeStorageSync('myIndex');
        wx.removeStorageSync('roomPlayers');
        wx.removeStorageSync('gameSession');
        wx.removeStorageSync('spectatorMode');
      } catch (e) {}
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

    getActiveUrl: function() {
      return this._currentUrl || getServerUrl();
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
      var url = this._lockedUrl || this._candidates[Math.min(this._candidateIndex, this._candidates.length - 1)];
      this._currentUrl = url;
      console.log('[WS] Connecting to:', url);
      var socketTask = wx.connectSocket({
        url: url,
        success: function() { console.log('[WS] connectSocket called'); },
        fail: function(err) { console.error('[WS] connectSocket fail:', err); }
      });
      this._socketTask = socketTask;

      socketTask.onOpen(function() {
        console.log('[WS] Socket OPEN:', url);
        self._connected = true;
        self._connecting = false;
        self._reconnectAttempt = 0;
        self._everOpened = true;
        self._lockedUrl = url;
        // 调用所有 onConnect 回调
        self._connectCallbacks.forEach(function(fn) {
          try { fn(); } catch(e) { console.error('[WS] onConnect cb error', e); }
        });

        // 自动恢复房间：入座玩家 joinRoom，已站起的旁观者 observeRoom
        var ident = self.getIdentity();
        if (ident.roomId && ident.name) {
          var spectator = self.isSpectator();
          console.log('[WS] 自动恢复房间', ident.roomId, 'as', ident.name,
            'playerId=', ident.playerId, 'spectator=', spectator);
          var joinMsg = {
            type: spectator ? 'observeRoom' : 'joinRoom',
            roomId: ident.roomId,
            name: ident.name,
            nickname: ident.nickname || '',
            avatar: ident.avatar || '',
            playerId: ident.playerId
          };
          setTimeout(function() {
            self._socketTask.send({ data: JSON.stringify(joinMsg) });
          }, 100);
        }
      });

      socketTask.onMessage(function(res) {
        try {
          var msg = JSON.parse(res.data);
          console.log('[WS] Received:', msg.type);
          // joined 是后端下发的权威身份：座位号 + playerId。
          // 多账号调试时各窗口共享 storage，所以身份必须写进「本窗口内存」，
          // 否则后加入者回写 storage 会把先加入者的座位号覆盖掉。
          if (msg.type === 'joined') {
            if (msg.playerId) {
              self._savedPlayerId = msg.playerId;
              _local.playerId = msg.playerId;
              try { wx.setStorageSync('playerId', msg.playerId); } catch (e) {}
            }
            if (msg.roomId) { self._savedRoomId = msg.roomId; _local.roomId = msg.roomId; }
            if (typeof msg.playerIndex === 'number' && msg.playerIndex >= 0) {
              self._savedMyIndex = msg.playerIndex;
              _local.myIndex = msg.playerIndex;
              try { wx.setStorageSync('myIndex', String(msg.playerIndex)); } catch (e) {}
            }
          }
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

        // 从未连通过、且所有候选地址都试完了：通知 UI「连接失败」，提示用户改地址。
        // 真机上默认 localhost 指向手机自己、备用 Railway 又可能不可用，必须让用户能察觉。
        if (!self._everOpened && self._candidateIndex >= self._candidates.length - 1 && self._onConnectFailed) {
          try { self._onConnectFailed(self._candidates[self._candidateIndex]); } catch(e) {}
        }

        // 从未连通过任何服务器：立即换下一个候选地址重试（不等退避计时器）。
        // 这样「本地后端没启动」时会自动尝试备用地址，且不会一直弹「重连中」遮罩。
        if (!self._everOpened && self._candidateIndex < self._candidates.length - 1) {
          self._candidateIndex++;
          console.log('[WS] 换用备用服务器:', self._candidates[self._candidateIndex]);
          setTimeout(function() { self._connect(); }, 300);
          return;
        }

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
  // 1) 本窗口内存优先（多账号调试时各窗口彼此独立，这是权威来源）
  if (_local.playerId) return _local.playerId;
  try {
    // 2) 冷启动兜底：storage 里有就沿用（仅供单窗口真机重连；多开时下面 joined 会用服务端下发的权威 ID 覆盖内存）
    var pid = wx.getStorageSync('playerId');
    if (!pid) {
      pid = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }
    _local.playerId = pid;
    return pid;
  } catch (e) {
    _local.playerId = _local.playerId || ('u_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9));
    return _local.playerId;
  }
}

module.exports = {
  createWsClient: createWsClient,
  getOrCreatePlayerId: getOrCreatePlayerId,
  getServerUrl: getServerUrl,
  setServerUrl: setServerUrl,
  // 本窗口私有状态：多账号调试时替代共享 storage 存身份/会话
  localGet: localGet,
  localSet: localSet,
  localClear: localClear,
  DEFAULT_SERVER_URL: DEFAULT_SERVER_URL,
  BACKUP_SERVER_URL: BACKUP_SERVER_URL,
  SERVER_URL: DEFAULT_SERVER_URL
};
