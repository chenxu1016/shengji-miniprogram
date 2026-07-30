// 测试：发牌后亮主(0分)与反主规则
// 1) 持有"大王+红方级牌"的玩家可在叫分阶段随时亮主(不限于自己回合)，且不打乱叫分轮转
// 2) 庄家亮主后进入反主阶段，下家持有"小王+黑梅级牌"可点该花色反主
const WebSocket = require('ws');

const URL = process.argv[2] || 'ws://localhost:8899';
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

function mkClient(tag) {
  const ws = new WebSocket(URL);
  const c = { ws, tag, msgs: [], _h: {} };
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    c.msgs.push(m);
    if (c._h[m.type]) c._h[m.type](m);
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.on = (t, fn) => { c._h[t] = fn; };
  c.waitFor = (t, ms = 4000) => new Promise((res, rej) => {
    const found = c.msgs.find(m => m.type === t);
    if (found) return res(found);
    const to = setTimeout(() => rej(new Error(c.tag + ' 等待 ' + t + ' 超时')), ms);
    c.on(t, m => { clearTimeout(to); res(m); });
  });
  // 仅当消息满足 predicate 才解析；用于过滤多玩家广播下的"迟到陈旧消息"
  c.waitForPred = (t, pred, ms = 4000) => new Promise((res, rej) => {
    const found = c.msgs.find(m => m.type === t && pred(m));
    if (found) return res(found);
    const to = setTimeout(() => rej(new Error(c.tag + ' 等待 ' + t + '(带条件) 超时')), ms);
    c.on(t, m => { if (pred(m)) { clearTimeout(to); res(m); } });
  });
  c.waitClear = () => { c.msgs = []; };
  return new Promise(res => { ws.on('open', () => res(c)); });
}

(async () => {
  const lobby = await mkClient('lobby');
  lobby.send({ type: 'getRooms' });
  await lobby.waitFor('roomList');

  function findQualifier(sess, suitColor) {
    for (let i = 0; i < 4; i++) {
      const hand = sess.players[i].hand;
      const hasBig = hand.some(c => c.value === 'big_joker');
      const hasSmall = hand.some(c => c.value === 'small_joker');
      const hasRedLvl = hand.some(c => (c.suit === 'heart' || c.suit === 'diamond') && c.value === sess.level);
      const hasBlackLvl = hand.some(c => (c.suit === 'spade' || c.suit === 'club') && c.value === sess.level);
      if (suitColor === 'red' && hasBig && hasRedLvl) return i;
      if (suitColor === 'black' && hasSmall && hasBlackLvl) return i;
    }
    return -1;
  }

  let redIdx = -1, blackIdx = -1, sess0 = null, players = null, roomId = null;
  const MAX_TRIES = 15;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const host = await mkClient('host' + attempt);
    host.send({ type: 'createRoom', name: '阿大', nickname: '阿大', avatar: '', playerId: 'u_decl_h' + attempt });
    const joined = await host.waitFor('joined');
    roomId = joined.roomId;
    const ps = [host];
    for (let i = 1; i < 4; i++) {
      const p = await mkClient('p' + attempt + '_' + i);
      p.send({ type: 'joinRoom', roomId, name: '阿' + (i + 1), nickname: '阿' + (i + 1), avatar: '', playerId: 'u_decl_' + attempt + '_' + i });
      await p.waitFor('joined');
      ps.push(p);
    }
    await wait(200);
    ps.forEach(p => p.send({ type: 'ready' }));
    const gs = await host.waitFor('gameStart', 6000).catch(() => null);
    if (!gs) { ps.forEach(p => p.ws.close()); continue; }
    const s = gs.session;
    redIdx = findQualifier(s, 'red');
    blackIdx = findQualifier(s, 'black');
    if (redIdx >= 0 || blackIdx >= 0) {
      sess0 = s; players = ps; break;
    }
    ps.forEach(p => p.ws.close());
  }

  if (!sess0) { console.log('  ✗ 多次发牌均未出现可亮主资格牌，跳过'); lobby.ws.close(); process.exit(0); }
  const level = sess0.level;

  // 计算某玩家持有的可亮主花色（红方资格→其红花色；黑方资格→其黑花色）
  function qualifierSuit(idx) {
    const hand = sess0.players[idx].hand;
    const hasBig = hand.some(c => c.value === 'big_joker');
    const hasSmall = hand.some(c => c.value === 'small_joker');
    if (hasBig) {
      if (hand.some(c => c.suit === 'heart' && c.value === level)) return 'heart';
      if (hand.some(c => c.suit === 'diamond' && c.value === level)) return 'diamond';
    }
    if (hasSmall) {
      if (hand.some(c => c.suit === 'spade' && c.value === level)) return 'spade';
      if (hand.some(c => c.suit === 'club' && c.value === level)) return 'club';
    }
    return null;
  }

  // 选一个资格玩家来亮主（优先红方，其次黑方）
  const declIdx = redIdx >= 0 ? redIdx : blackIdx;
  const declSuit = qualifierSuit(declIdx);

  console.log('=== 测试1: 资格玩家随时亮主(0分) → 立即定主并进入反主阶段 ===');
  if (declIdx < 0 || !declSuit) {
    console.log('  (跳过) 本局无可用亮主资格牌');
  } else {
    const declP = players[declIdx];
    declP.waitClear();
    const wantSuitName = { heart: '红桃', diamond: '方片', spade: '黑桃', club: '梅花' }[declSuit];
    declP.send({ type: 'bid', bid: '0', suit: declSuit });
    const res = await declP.waitFor('bidResult', 4000).catch(() => null);
    ok('亮主收到 bidResult', !!res);
    ok('亮主成功(主花色已定)', res && res.session && res.session.trumpSuit === declSuit);
    if (res && res.session) {
      ok('亮主后进入反主阶段', res.session.state === 'reverse');
      ok('反主起始=亮主者下家(未跳轮次)', res.session.currentBidderIndex === (declIdx + 1) % 4);
      ok('finalBidder=亮主者', res.session.finalBidderIndex === declIdx);
    }
    console.log('  (信息) ' + (declIdx + 1) + '号玩家亮' + wantSuitName + '，进入反主，轮到' + ((declIdx + 1) % 4 + 1) + '号反主');

    // 测试2：驱动整个反主阶段 —— 每位反主轮次的玩家若可反主则反主，否则跳过，直到进入打牌
    console.log('=== 测试2: 反主阶段逐位反主/跳过 → 进入打牌 ===');

    // 镜像服务端的 getReverseOptions：返回该玩家可反主的选项（{suit} 或 {isNoTrump}）
    // pairUsed=true 时（已有人用对子反过），只能用王对反无主
    function computeReverseOptions(hand, currentTrump, pairUsed) {
      const opts = [];
      if (pairUsed) {
        const hasBig = hand.some(c => c.value === 'big_joker');
        const hasSmall = hand.some(c => c.value === 'small_joker');
        if (hasBig && hasSmall) opts.push({ isNoTrump: true });
        return opts;
      }
      // 对子反主：任意点数出现 >=2 即可反为其他花色（不限于级牌）
      const counts = {};
      for (const c of hand) counts[c.value] = (counts[c.value] || 0) + 1;
      for (const v in counts) {
        if (counts[v] >= 2 && v !== 'big_joker' && v !== 'small_joker') {
          for (const s of ['diamond', 'heart', 'club', 'spade']) if (s !== currentTrump) opts.push({ suit: s });
        }
      }
      // 王反主
      const hasBig = hand.some(c => c.value === 'big_joker');
      const hasSmall = hand.some(c => c.value === 'small_joker');
      if (hasBig) for (const s of ['diamond', 'heart']) if (s !== currentTrump) opts.push({ suit: s });
      if (hasSmall) for (const s of ['club', 'spade']) if (s !== currentTrump) opts.push({ suit: s });
      if (hasBig && hasSmall) opts.push({ isNoTrump: true });
      return opts;
    }

    const origTrump = (res && res.session) ? res.session.trumpSuit : sess0.trumpSuit;
    let pairUsed = false;
    let lastSession = (res && res.session) ? res.session : sess0;
    let anyReversed = false;
    let guard = 0;
    while (lastSession.state === 'reverse' && guard < 12) {
      guard++;
      const cur = lastSession.currentBidderIndex;
      const curHand = sess0.players[cur].hand;
      const opts = computeReverseOptions(curHand, lastSession.trumpSuit, pairUsed);
      const curP = players[cur];
      curP.waitClear();
      if (opts.length) {
        const o = opts[0];
        if (o.isNoTrump) {
          curP.send({ type: 'reverse', option: { isNoTrump: true } });
          console.log('  (信息) ' + (cur + 1) + '号玩家用王对反主为无主');
          pairUsed = true;
        } else {
          curP.send({ type: 'reverse', option: { suit: o.suit } });
          console.log('  (信息) ' + (cur + 1) + '号玩家反主为' + ({ heart: '红桃', diamond: '方片', spade: '黑桃', club: '梅花' }[o.suit]));
          // 若用的是对子反主（手牌有非王对子），标记 pairUsed，约束后续反主者
          const counts = {};
          for (const c of curHand) counts[c.value] = (counts[c.value] || 0) + 1;
          if (Object.keys(counts).some(v => counts[v] >= 2 && v !== 'big_joker' && v !== 'small_joker')) pairUsed = true;
        }
        anyReversed = true;
      } else {
        curP.send({ type: 'skipReverse' });
        console.log('  (信息) ' + (cur + 1) + '号玩家不反主，跳过');
      }
      // 只接受"轮次已推进(≠当前cur)或已进入打牌"的 reverseResult，过滤迟到的陈旧广播
      const rr = await curP.waitForPred('reverseResult',
        m => m.session && (m.session.currentBidderIndex !== cur || m.session.state === 'playing'), 4000
      ).catch(() => null);
      ok((opts.length ? '反主' : '跳过') + '收到 reverseResult (玩家' + (cur + 1) + ')', !!rr);
      if (!rr) break;
      lastSession = rr.session;
    }
    ok('反主结束后进入打牌阶段', lastSession.state === 'playing');
    if (anyReversed) {
      ok('反主后主花色发生变化', lastSession.trumpSuit !== origTrump);
    } else {
      ok('无人反主，主花色保持亮主花色', lastSession.trumpSuit === origTrump);
    }
  }

  console.log('=== 测试3: 无资格亮主应被拒 ===');
  let noQual = -1;
  for (let i = 0; i < 4; i++) {
    if (i === declIdx) continue;
    const hand = sess0.players[i].hand;
    const hasBig = hand.some(c => c.value === 'big_joker');
    const hasSmall = hand.some(c => c.value === 'small_joker');
    const hasRedLvl = hand.some(c => (c.suit === 'heart' || c.suit === 'diamond') && c.value === level);
    const hasBlackLvl = hand.some(c => (c.suit === 'spade' || c.suit === 'club') && c.value === level);
    if (!((hasBig && hasRedLvl) || (hasSmall && hasBlackLvl))) { noQual = i; break; }
  }
  if (noQual >= 0) {
    const p = players[noQual];
    p.waitClear();
    p.send({ type: 'bid', bid: '0', suit: declSuit || 'spade' });
    const err = await p.waitFor('error', 3000).catch(() => null);
    ok('无资格亮主被服务器拒绝', !!err);
  } else {
    console.log('  (跳过) 所有玩家都持有资格牌');
  }

  players.forEach(p => p.ws.close());
  lobby.ws.close();
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
