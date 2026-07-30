const WebSocket = require('ws');
const SERVER_URL = 'ws://localhost:8888';
var players = [];
var roomId = '';
var roomUpdateCount = [0, 0, 0, 0];
var gameStartReceived = [false, false, false, false];
var connectionErrors = [0, 0, 0, 0];
var currentIdx = 0;

function createPlayer(idx) {
  return new Promise(function(resolve) {
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
            console.log('Player' + (idx+1) + ' Joined room');
          } else {
            console.log('Player' + (idx+1) + ' waiting for room ID...');
          }
        }, 500);
      }
    });

    ws.on('message', function(data) {
      try {
        var msg = JSON.parse(data);
        if (msg.type === 'roomUpdate') {
          roomUpdateCount[idx]++;
          console.log('Player' + (idx+1) + ' roomUpdate: players=' + msg.players.length);
          if (idx === 0 && !roomId) {
            roomId = msg.room.id;
            console.log('Got room ID:', roomId);
            // After getting room ID, continue to next player
            setTimeout(function() {
              if (currentIdx < 4) {
                currentIdx++;
                createPlayer(currentIdx).then(resolve);
              } else {
                // All players connected, now have them all ready simultaneously
                setTimeout(functionAllReady(), 1000);
              }
            }, 300);
          }
        } else if (msg.type === 'playerReady') {
          console.log('Player' + (idx+1) + ' playerReady: allReady=' + (msg.allReady || 'N/A'));
        } else if (msg.type === 'gameStart') {
          gameStartReceived[idx] = true;
          console.log('Player' + (idx+1) + ' GAME START!');
        }
      } catch(e) {}
    });

    ws.on('close', function(code, reason) {
      console.log('Player' + (idx+1) + ' Closed:' + code);
    });

    ws.on('error', function(err) {
      connectionErrors[idx]++;
      console.error('Player' + (idx+1) + ' Error:' + (err.message || ''));
    });

    players.push(ws);
    ws.on('close', resolve);
  });
}

function functionAllReady() {
  // All players ready - each sends ready message
  players.forEach(function(ws, idx) {
    setTimeout(function() {
      ws.send(JSON.stringify({ type: 'ready' }));
      console.log('Player' + (idx+1) + ' sent READY');
    }, idx * 200);
  });
  setTimeout(function() {
    reportResults();
  }, 3000);
}

function reportResults() {
  console.log('\n=== TEST RESULTS ===');
  for (var i = 0; i < 4; i++) {
    console.log('Player' + (i+1) + ': RU=' + roomUpdateCount[i] + ', GS=' + gameStartReceived[i] + ', CE=' + connectionErrors[i]);
  }
  var allStarted = gameStartReceived.every(function(v){ return v; });
  console.log('All gameStarted:' + allStarted);
  players.forEach(function(p){ p.close(); });
  process.exit(allStarted ? 0 : 1);
}

// Start with player 0
currentIdx = 0;
createPlayer(0).then(function() {
  console.log('First player done, continuing...');
});
