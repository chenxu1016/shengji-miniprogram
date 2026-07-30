const WebSocket = require('ws');
const SERVER_URL = 'ws://localhost:8888';
var players = [];
var roomId = '';

for (var i = 0; i < 2; i++) {
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
            ws.send(JSON.stringify({ type: 'joinRoom', roomId: roomId, name: 'Player2', nickname: '', avatar: '' }));
            console.log('Player2 Joined room');
          } else {
            console.log('Player2 waiting for room ID...');
          }
        }, 500);
      }
    });

    ws.on('message', function(data) {
      try {
        var msg = JSON.parse(data);
        console.log('Player' + (idx+1) + ' Received:' + msg.type);
        if (msg.type === 'roomUpdate') {
          console.log('  Room players count:', msg.players.length);
          if (msg.room && !roomId) {
            roomId = msg.room.id;
            console.log('Got room ID:', roomId);
          }
        }
      } catch(e) {}
    });

    ws.on('close', function(code, reason) {
      console.log('Player' + (idx+1) + ' Closed:' + code);
    });

    ws.on('error', function(err) {
      console.error('Player' + (idx+1) + ' Error:' + err.message);
    });

    players.push(ws);
  })(i);
}

setTimeout(function() { 
  players.forEach(function(p){ p.close(); }); 
  process.exit(0); 
}, 8000);
