const WebSocket = require('ws');
const SERVER_URL = 'ws://localhost:8888';

var roomId = '';
var playerStates = [];

console.log('=== 4-Player Room Sync Diagnostic Test ===\n');

async function runSequentialTest() {
  console.log('Step 1: Player 1 creates the room');
  await testPlayer(0, 'create');
  
  if (!roomId) {
    console.error('ERROR: No room ID created!');
    process.exit(1);
  }
  console.log('Room ID:', roomId);
  
  console.log('\nStep 2: Player 2 joins the room');
  await testPlayer(1, 'join', roomId);
  
  console.log('\nStep 3: Player 3 joins the room');
  await testPlayer(2, 'join', roomId);
  
  console.log('\nStep 4: Player 4 joins the room');
  await testPlayer(3, 'join', roomId);
  
  console.log('\nAll players connected. Now sending "ready" messages...');
  
  for (var i = 0; i < 4; i++) {
    await sendReady(playerStates[i].ws);
    await new Promise(function(r) { setTimeout(r, 300); });
  }
  
  console.log('\nWaiting for gameStart messages...');
  
  var waitTime = 0;
  while (!playerStates.every(function(s){ return s.gameStarted; })) {
    await new Promise(function(r) { setTimeout(r, 500); });
    waitTime += 500;
    if (waitTime > 5000) {
      console.log('Timeout waiting for gameStart');
      break;
    }
  }
  
  printResults();
}

function testPlayer(index, action, joinRoomId) {
  return new Promise(function(resolve) {
    var ws = new WebSocket(SERVER_URL, { permessageDeflate: false });
    var playerName = 'Player' + (index + 1);
    
    var state = {
      index: index,
      name: playerName,
      ws: ws,
      roomId: null,
      roomUpdateCount: 0,
      readySent: false,
      gameStarted: false,
      errors: []
    };
    playerStates.push(state);
    
    ws.on('open', function() {
      console.log('[' + playerName + '] CONNECTED');
      
      if (action === 'create') {
        setTimeout(function() {
          ws.send(JSON.stringify({
            type: 'createRoom',
            name: playerName,
            nickname: '',
            avatar: ''
          }));
          console.log('[' + playerName + '] Created room');
        }, 100);
      } else if (action === 'join') {
        setTimeout(function() {
          if (joinRoomId) {
            ws.send(JSON.stringify({
              type: 'joinRoom',
              roomId: joinRoomId,
              name: playerName,
              nickname: '',
              avatar: ''
            }));
            console.log('[' + playerName + '] Joined room ' + joinRoomId);
          }
        }, 500);
      }
    });
    
    ws.on('message', function(data) {
      try {
        var msg = JSON.parse(data);
        
        if (msg.type === 'roomUpdate') {
          state.roomUpdateCount++;
          var pc = msg.players ? msg.players.length : 0;
          var rr = msg.players ? msg.players.filter(function(p){return p.ready;}).length : 0;
          console.log('[' + playerName + '] roomUpdate: players=' + pc + ', ready=' + rr);
          
          if (!state.roomId && msg.room) {
            state.roomId = msg.room.id;
            if (index === 0) roomId = msg.room.id;
          }
          
          if (pc !== 4 && index > 0) {
            console.log('  WARNING: Player ' + (index+1) + ' sees ' + pc + ' players (expected 4)');
          }
        } else if (msg.type === 'playerReady') {
          console.log('[' + playerName + '] playerReady: allReady=' + (msg.allReady || 'N/A'));
        } else if (msg.type === 'gameStart') {
          state.gameStarted = true;
          console.log('[' + playerName + '] GAME START!');
        } else if (msg.type === 'error') {
          state.errors.push('Error:' + msg.message);
          console.error('[' + playerName + '] ERROR:', msg.message);
        }
      } catch(e) {
        state.errors.push('ParseError:' + e.message);
      }
    });
    
    ws.on('close', function(code, reason) {
      console.log('[' + playerName + '] CLOSED: code=' + (code || 'N/A'));
      resolve();
    });
    
    ws.on('error', function(err) {
      state.errors.push('NetError:' + err.message);
    });
  });
}

function sendReady(ws) {
  return new Promise(function(resolve) {
    ws.send(JSON.stringify({ type: 'ready' }));
    setTimeout(resolve, 500);
  });
}

function printResults() {
  console.log('\n==========================================');
  console.log('TEST RESULTS');
  console.log('==========================================\n');
  
  var allSynced = true;
  playerStates.forEach(function(s) {
    var status = s.gameStarted ? 'GAME STARTED' : 'NO GAME START';
    if (!s.gameStarted) allSynced = false;
    console.log(s.name + ': RU=' + s.roomUpdateCount + ', GS=' + s.gameStarted + ', Errors=' + s.errors.length + ' -> ' + status);
    
    if (s.errors.length > 0) {
      console.log('   Errors: ' + s.errors.join(', '));
    }
  });
  
  console.log('\nOverall: ' + (allSynced ? 'ALL PLAYERS RECEIVED GAME START' : 'SOME PLAYERS MISSED GAME START'));
  console.log('==========================================\n');
  
  process.exit(allSynced ? 0 : 1);
}

runSequentialTest().catch(function(err) {
  console.error('Test failed:', err);
  process.exit(1);
});
