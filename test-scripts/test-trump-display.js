// 验证 game.js 里 _calcRoundPoints / _updateScorePanel / _updateTrumpDisplay 的数据计算
// 用 mock session 模拟各种状态

function run() {
  // 模拟 game.js 里的 suitNames + 一些纯函数
  var suitNames = {spade:"黑桃",heart:"红桃",club:"梅花",diamond:"方块",none:"无",null:"无"};

  function calcRoundPoints(s, myTeam) {
    var mine = 0, opp = 0;
    if (s.tricks && s.tricks.length) {
      for (var i=0;i<s.tricks.length;i++){
        var t = s.tricks[i];
        if (typeof t.points !== "number") continue;
        if ((t.winner % 2) === myTeam) mine += t.points;
        else opp += t.points;
      }
    }
    return { myScore: mine, oppScore: opp };
  }

  function getScorePanel(s, myIdx) {
    var myTeam = myIdx % 2;
    var oppTeam = 1 - myTeam;
    var myLevel = (s.teamLevels && s.teamLevels[myTeam] !== undefined) ? (s.teamLevels[myTeam] + 2) : 2;
    var oppLevel = (s.teamLevels && s.teamLevels[oppTeam] !== undefined) ? (s.teamLevels[oppTeam] + 2) : 2;
    var pts = calcRoundPoints(s, myTeam);
    var trumpSuit = s.finalSuit || s.trumpSuit;
    var trumpText = trumpSuit ? (suitNames[trumpSuit] || trumpSuit) : "未叫主";
    return { myLevel: myLevel, oppLevel: oppLevel, myScore: pts.myScore, oppScore: pts.oppScore, trumpText: trumpText };
  }

  function getTrumpDisplay(s) {
    var visible = s.state === "bidding" || s.state === "reverse" || s.state === "playing" || s.state === "scoring" || s.state === "round_end";
    var currentSuit = s.finalSuit || s.trumpSuit || null;
    if (s.state === "bidding" && s.bidHistory && s.bidHistory.length > 0 && !currentSuit) {
      for (var i = s.bidHistory.length - 1; i >= 0; i--) {
        var b = s.bidHistory[i];
        if (b.bid !== "pass" && b.suit) { currentSuit = b.suit; break; }
      }
    }
    var chips = [
      { key: "big_joker",   label: "大", lit: false, dim: true },
      { key: "small_joker", label: "小", lit: false, dim: true },
      { key: "spade",       label: "♠", lit: false, dim: true },
      { key: "heart",       label: "♥", lit: false, dim: true },
      { key: "club",        label: "♣", lit: false, dim: true },
      { key: "diamond",     label: "♦", lit: false, dim: true }
    ];
    if (currentSuit) {
      for (var i=0;i<chips.length;i++){
        if (chips[i].key === currentSuit) { chips[i].lit = true; chips[i].dim = false; }
      }
    }
    var caption = "";
    if (s.state === "bidding") {
      if (currentSuit) {
        var latestBidScore = 0;
        for (var j = (s.bidHistory||[]).length - 1; j >= 0; j--) {
          if (s.bidHistory[j].bid !== "pass") { latestBidScore = parseInt(s.bidHistory[j].bid) || 0; break; }
        }
        var bidScoreStr = (latestBidScore > 0) ? (latestBidScore + "分") : "亮主";
        caption = "已叫" + (suitNames[currentSuit] || currentSuit) + " " + bidScoreStr;
      } else {
        caption = "等待叫主";
      }
    } else if (s.state === "reverse") {
      caption = "是否反主？";
    } else if (currentSuit) {
      var fs = (s.bidScore > 0) ? (s.bidScore + "分亮主") : "亮主坐庄";
      caption = "本局打" + (suitNames[currentSuit] || currentSuit) + " " + fs;
    } else {
      caption = "亮主坐庄";
    }
    return { visible: visible, chips: chips, caption: caption, currentSuit: currentSuit };
  }

  var passed = 0, failed = 0;
  function check(name, actual, expected) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { console.log("  ✓ " + name); passed++; }
    else { console.log("  ✗ " + name + "  expected=" + JSON.stringify(expected) + "  actual=" + JSON.stringify(actual)); failed++; }
  }

  // ====== 测试1：叫分阶段初始（无人叫）======
  console.log("[1] 叫分阶段初始 (无人叫)");
  var s1 = { state: "bidding", bidHistory: [], finalSuit: null, trumpSuit: null, bidScore: 0, teamLevels: [0,0], tricks: [] };
  var d1 = getTrumpDisplay(s1);
  check("visible=true", d1.visible, true);
  check("caption='等待叫主'", d1.caption, "等待叫主");
  check("所有 chip dim", d1.chips.every(function(c){return c.lit===false && c.dim===true;}), true);

  // ====== 测试2：叫分阶段有玩家叫了1分黑桃 ======
  console.log("[2] 叫分阶段 玩家1叫了1分黑桃");
  var s2 = { state: "bidding", bidHistory: [{player:0,bid:"1",suit:"spade"},{player:1,bid:"pass"}], finalSuit: null, trumpSuit: null, bidScore: 0, teamLevels: [0,0], tricks: [] };
  var d2 = getTrumpDisplay(s2);
  check("spade chip lit", d2.chips[2].lit, true);
  check("heart chip dim", d2.chips[3].dim, true);
  check("caption='已叫黑桃 1分'", d2.caption, "已叫黑桃 1分");

  // ====== 测试3：叫分阶段玩家叫了0分（亮主）======
  console.log("[3] 叫分阶段 玩家2叫了0分红桃");
  var s3 = { state: "bidding", bidHistory: [{player:0,bid:"pass"},{player:1,bid:"0",suit:"heart"}], finalSuit: null, trumpSuit: null, bidScore: 0, teamLevels: [0,0], tricks: [] };
  var d3 = getTrumpDisplay(s3);
  check("heart chip lit", d3.chips[3].lit, true);
  check("caption='已叫红桃 亮主'", d3.caption, "已叫红桃 亮主");

  // ====== 测试4：叫分结束，进入出牌阶段 ======
  console.log("[4] 出牌阶段 (finalSuit=spade, bidScore=1)");
  var s4 = { state: "playing", bidHistory: [{player:0,bid:"1",suit:"spade"}], finalSuit: "spade", trumpSuit: "spade", bidScore: 1, teamLevels: [0,0], tricks: [{winner:0,points:5},{winner:2,points:10},{winner:1,points:0}] };
  var d4 = getTrumpDisplay(s4);
  check("spade chip lit", d4.chips[2].lit, true);
  check("caption='本局打黑桃 1分亮主'", d4.caption, "本局打黑桃 1分亮主");
  // 记分：玩家1赢5分(我方+5)、玩家3赢10分(我方+10)、玩家2赢0(对方+0)
  // myIdx=0 → 我方team0
  var sp0 = getScorePanel(s4, 0);
  check("我方 level=2", sp0.myLevel, 2);
  check("我方 myScore=15 (5+10)", sp0.myScore, 15);
  check("我方 oppScore=0", sp0.oppScore, 0);
  check("我方 trumpText='黑桃'", sp0.trumpText, "黑桃");
  // myIdx=1 → 我方team1
  var sp1 = getScorePanel(s4, 1);
  check("对方视角 myScore=0", sp1.myScore, 0);
  check("对方视角 oppScore=15", sp1.oppScore, 15);

  // ====== 测试5：游戏进行中 teamLevels 已升级 ======
  console.log("[5] 升级后 teamLevels=[1,0]");
  var s5 = { state: "playing", finalSuit: "heart", trumpSuit: "heart", bidScore: 2, teamLevels: [1,0], tricks: [] };
  var sp5a = getScorePanel(s5, 0);
  check("我方team0 level=3 (1+2)", sp5a.myLevel, 3);
  check("对方team1 level=2 (0+2)", sp5a.oppLevel, 2);
  check("trumpText='红桃'", sp5a.trumpText, "红桃");

  // ====== 测试6：反主阶段 ======
  console.log("[6] 反主阶段");
  var s6 = { state: "reverse", finalSuit: "club", trumpSuit: "club", bidScore: 1, teamLevels: [0,0], tricks: [] };
  var d6 = getTrumpDisplay(s6);
  check("club chip lit", d6.chips[4].lit, true);
  check("caption='是否反主？'", d6.caption, "是否反主？");

  console.log("\n=== 结果: " + passed + " 通过, " + failed + " 失败 ===");
  process.exit(failed > 0 ? 1 : 0);
}
run();
