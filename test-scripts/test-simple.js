const WebSocket = require('ws');
var ws = new WebSocket('ws://localhost:8888', { permessageDeflate: false });
ws.on('open', function() { console.log('Connected!'); 
  ws.send(JSON.stringify({type:'createRoom', name:'Test', nickname:'', avatar:''}));
});
ws.on('message', function(data) { 
  var m = JSON.parse(data); 
  console.log(m.type + ': players=' + (m.players ? m.players.length : 'N/A'));
  if (m.room) console.log('room ID:', m.room.id);
});
ws.on('close', function() { console.log('Closed'); });
ws.on('error', function(e) { console.error('Error:', e.message); });
