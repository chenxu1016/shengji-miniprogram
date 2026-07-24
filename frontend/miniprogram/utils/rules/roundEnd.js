const { Suit, CardValue, getPoints } = require("./card");

const LEVEL_PROMOTION = new Map([[0, 1], [1, 2], [2, 3], [3, 4]]);
const LEVEL_DEMOTION = new Map([[0, 2], [1, 2], [2, 2], [3, 2]]);
const LEVEL_ORDER = [CardValue.TWO, CardValue.THREE, CardValue.FOUR, CardValue.FIVE, CardValue.SIX, CardValue.SEVEN, CardValue.EIGHT, CardValue.NINE, CardValue.TEN, CardValue.JACK, CardValue.QUEEN, CardValue.KING, CardValue.ACE];

function calculateRoundResult(bidScore, leaderPoints, tricks, currentLevel) {
  const followerPoints = 200 - leaderPoints;
  let winnerTeam, leaderLevelUp;
  if (leaderPoints >= getRequiredPoints(bidScore)) {
    winnerTeam = "leader";
    leaderLevelUp = LEVEL_PROMOTION.get(bidScore) || 1;
  } else {
    winnerTeam = "follower";
    leaderLevelUp = -(LEVEL_DEMOTION.get(bidScore) || 2);
  }
  return { leaderScore: leaderPoints, followerScore: followerPoints, winnerTeam: winnerTeam, leaderLevelUp: leaderLevelUp, tricks: tricks };
}

function getRequiredPoints(bidScore) {
  const map = { 0: 0, 1: 40, 2: 60, 3: 80 };
  return map[bidScore] || 0;
}

function getNextLevel(currentLevel) {
  const idx = LEVEL_ORDER.indexOf(currentLevel);
  if (idx < 0 || idx >= LEVEL_ORDER.length - 1) return CardValue.ACE;
  return LEVEL_ORDER[idx + 1];
}

function isGameEnded(teamLevels) {
  for (const level of teamLevels.values()) {
    if (LEVEL_ORDER[level] === CardValue.ACE) return true;
  }
  return false;
}

module.exports = { calculateRoundResult, isGameEnded, getNextLevel };
