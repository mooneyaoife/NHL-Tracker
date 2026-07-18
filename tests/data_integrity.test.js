const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stats = require("../site/statistics.js");

const root = path.resolve(__dirname, "..");
const archive = JSON.parse(fs.readFileSync(path.join(root, "site/data/seasons/20252026.json"), "utf8"));

assert.equal(archive.standings.length, 32, "the archived league contains all NHL teams");
assert.equal(
  archive.standings.reduce((total, row) => total + Number(row.gf || 0), 0),
  archive.standings.reduce((total, row) => total + Number(row.ga || 0), 0),
  "league goals for reconcile exactly with league goals against",
);
assert.equal(
  archive.standings.reduce((total, row) => total + Number(row.gp || 0), 0),
  32 * 82,
  "the complete archived regular season contains 82 team-games per club",
);

for (const [team, summary] of Object.entries(archive.teams)) {
  assert.equal(summary.gp, summary.games.length, `${team} summary games reconcile with its game log`);
  assert.equal(summary.points, summary.games.reduce((total, game) => total + Number(game.points || 0), 0), `${team} points reconcile with its game log`);
  assert.equal(summary.gf, summary.games.reduce((total, game) => total + Number(game.gf || 0), 0), `${team} goals reconcile with its game log`);
  assert.equal(summary.ga, summary.games.reduce((total, game) => total + Number(game.ga || 0), 0), `${team} goals against reconcile with its game log`);
}

const leaguePointsPercentage = stats.pointsPercentage(archive.standings);
assert.ok(leaguePointsPercentage > 50 && leaguePointsPercentage < 65, "aggregate NHL points percentage is plausible");

const moneyPuckTeams = archive.moneypuck.teams.filter(row => Number(row.games) > 0);
for (const field of ["gf", "xgf", "ga", "xga"]) {
  const rate = stats.perGame(moneyPuckTeams, field, "games");
  assert.ok(Number.isFinite(rate) && rate > 0, `${field} produces a finite MoneyPuck league rate per game`);
}

assert.equal(archive.naturalStatTrick.teams.length, 32, "Natural Stat Trick team evidence covers the full league");

console.log("generated data integrity: all checks passed");
