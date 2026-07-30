const WebSocket = require('ws');
const SERVER_URL = 'ws://localhost:8888';
var players = [];
var roomId = '';
var roomUpdateCount = [0, 0, 0, 0];
var playerReadyCount = [0, 0, 0, 0];
var gameStartReceived = [false, false, false, false];
var connectionErrors = [0, 0, 0, 0];

console.log('=== Starting 4-player sync test ===\n');

for (var i = 0; i < 4; i++) {
  (function(idx) {
    var ws = new WebSocket(SERVER_URL, { permessageDeflate: false });
    
    ws.on('open', function() {
      console.log('Player' + (idx+1) + ' CONNECTED');
      if (idx === 0) {
        setTimeout(function() {
          ws.send(JSON.stringify({ type: 'createRoom', name: 'Player1', nickname: '', avatar: '' }));
          console.log('Player1 Created room');
        }, 100);
      } else {
        setTimeout(function() {
          if (roomId) {
            ws.send(JSON.stringify({ type: 'joinRoom', roomId: roomId, name: 'Player' + (idx+1), nickname: '', avatar: '' }));
            console.log('Player' + (idx+1) + ' Joined room' + roomId);
          }
        }, 800 + idx * 200);
      }
    });

    ws.on('message', function(data) {
      try {
        var msg = JSON.parse(data);
        if (msg.type === 'roomUpdate') {
          roomUpdateCount[idx]++;
          var pc = msg.players ? msg.players.length : 0;
          console.log('Player' + (idx+1) + ' roomUpdate: players=' + pc);
          if (idx === 0 && !roomId) {
            roomId = msg.room.id;
            console.log('Player1 Got room ID:' + roomId);
          }
        } else if (msg.type === 'playerReady') {
          playerReadyCount[idx]++;
          console.log('Player' + (idx+1) + ' playerReady: allReady=' + (msg.allReady || 'N/A'));
        } else if (msg.type === 'gameStart') {
          gameStartReceived[idx] = true;
          console.log('Player' + (idx+1) + ' GAME START!');
        } else if (msg.type === 'error') {
          console.error('Player' + (idx+1) + ' ERROR:', msg.message);
        }
      } catch (e) {
        console.error('Player' + (idx+1) + ' Parse error:', e.message);
      }
    });

    ws.on('close', function(code, reason) {
      console.log('Player' + (idx+1) + ' DISCONNECTED');
    });

    ws.on('error', function(err) {
      connectionErrors[idx]++;
      console.error('Player' + (idx+1) + ' Error:' + (err.message || err.toString()));
    });

    players.push(ws);
  })(i);
}

setTimeout(reportResults, 15000);

function reportResults() {
  console.log('\n=== TEST RESULTS ===');
  for (var i = 0; i < 4; i++) {
    console.log('Player' + (i+1) + ': RU=' + roomUpdateCount[i] + ', PR=' + playerReadyCount[i] + ', GS=' + gameStartReceived[i] + ', CE=' + connectionErrors[i]);
  }
  var allStarted = gameStartReceived.every(function(v){ return v; });
  console.log('All gameStarted:' + allStarted);
  players.forEach(function(p){ p.close(); });
  process.exit(allStarted ? 0 : 1);
}
