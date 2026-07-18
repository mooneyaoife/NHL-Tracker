const assert = require("node:assert/strict");
const stats = require("../site/statistics.js");

const close = (actual, expected, message) => assert.ok(
  Math.abs(actual - expected) < 1e-9,
  `${message}: expected ${expected}, received ${actual}`,
);

close(stats.pointsPercentage([
  { gp: 2, points: 4 },
  { gp: 10, points: 8 },
]), 50, "points percentage is weighted by games played");

close(stats.perGame([
  { gp: 2, gf: 8 },
  { gp: 8, gf: 16 },
], "gf"), 2.4, "per-game values use aggregate games as the denominator");

close(stats.perGame([
  { games: 1, xgf: 5 },
  { games: 9, xgf: 22 },
], "xgf", "games"), 2.7, "per-game values support provider-specific game fields");

close(stats.sharePercentage([
  { xgf: 6, xga: 4 },
  { xgf: 3, xga: 7 },
], "xgf", "xga"), 45, "share values use aggregate events");

close(stats.ratePer60([
  { minutes: 5, xgf: 1 },
  { minutes: 15, xgf: 1 },
], "xgf"), 6, "per-60 values are weighted by total minutes");

close(stats.opportunityPercentage([
  { goals: 1, opportunities: 2 },
  { goals: 1, opportunities: 8 },
], "goals", "opportunities"), 20, "percentages use aggregate opportunities");

close(stats.weightedAverage([
  { value: 90, shots: 10 },
  { value: 80, shots: 30 },
], "value", "shots"), 82.5, "weighted averages respect sample size");

assert.equal(stats.pointsPercentage([{ gp: 0, points: 0 }]), null, "empty samples do not become misleading zeroes");
assert.equal(stats.ratePer60([{ minutes: 0, xgf: 0 }], "xgf"), null, "zero-minute samples remain unavailable");

const comparisonPlayers = [
  { id: "1", name: "One Team", teams: ["BUF"] },
  { id: "2", name: "Traded Player", teams: ["VAN", "MIN"] },
  { id: "3", name: "Scalar Team", team: "MIN" },
];
assert.deepEqual(stats.filterPlayersByTeam(comparisonPlayers, "BUF").map(player => player.id), ["1"], "team filtering limits comparison options to the chosen club");
assert.deepEqual(stats.filterPlayersByTeam(comparisonPlayers, "MIN").map(player => player.id), ["2", "3"], "team filtering preserves traded and scalar-affiliation records");
assert.deepEqual(stats.filterPlayersByTeam(comparisonPlayers, "CAR"), [], "teams without eligible players return an honest empty list");

console.log("frontend statistics: all checks passed");
