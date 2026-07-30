const WebSocket = require('ws');
const SERVER_URL = 'ws://localhost:8888';

var ws = new WebSocket(SERVER_URL, { permessageDeflate: false });

ws.on('open', function() {
  console.log('Connected!');
  ws.send(JSON.stringify({ type: 'createRoom', name: 'TestPlayer', nickname: '', avatar: '' }));
  console.log('Sent createRoom');
});

ws.on('message', function(data) {
  try {
    var msg = JSON.parse(data);
    console.log('Received:', msg.type);
    if (msg.type === 'roomUpdate') {
      console.log('  Room players count:', msg.players.length);
      if (msg.room) console.log('  Room ID:', msg.room.id);
    }
  } catch(e) {}
});

ws.on('close', function(code, reason) {
  console.log('Closed:', code, reason ? reason.toString() : '');
});

ws.on('error', function(err) {
  console.error('Error:', err.message);
});

setTimeout(function() { ws.close(); }, 5000);
