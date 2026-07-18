const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stats = require("../site/statistics.js");

const root = path.resolve(__dirname, "..");
const archive = JSON.parse(fs.readFileSync(path.join(root, "site/data/seasons/20252026.json"), "utf8"));
const current = JSON.parse(fs.readFileSync(path.join(root, "site/data/tracker.json"), "utf8"));

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

const officialPlayers = [...archive.officialPlayers.skaters, ...archive.officialPlayers.goalies];
const storedPlayers = new Map();
for (const rows of Object.values(archive.players)) {
  for (const player of rows) storedPlayers.set(String(player.id), player);
}

assert.equal(Object.keys(archive.players).length, 32, "official player histories are stored for all NHL teams");
assert.equal(officialPlayers.length, 1038, "the official 2025-26 player baseline is complete");
assert.equal(storedPlayers.size, officialPlayers.length, "every official skater and goalie has one season identity");
assert.equal(archive.playerCoverage.scope, "All NHL teams", "player coverage is explicitly league-wide");
assert.equal(archive.playerCoverage.officialGameLogs, officialPlayers.length, "every official player has a reconciled game log");
assert.equal(archive.playerCoverage.reconciledOfficialPlayers, officialPlayers.length, "every official games-played total reconciles with its stored log");
assert.equal(archive.playerCoverage.officialReconciliationFailures, 0, "the archive reports no unexplained player reconciliation failures");

for (const official of officialPlayers) {
  const stored = storedPlayers.get(String(official.id));
  assert.ok(stored, `${official.name} is available in the generated player store`);
  assert.equal(stored.totals.gp, official.totals.gp, `${official.name} official games played survive parsing and storage`);
  assert.equal(stored.games.length, official.totals.gp, `${official.name} game log reconciles with official games played`);
}

for (const goalie of archive.officialPlayers.goalies) {
  const stored = storedPlayers.get(String(goalie.id));
  assert.ok(stored.games.every(game => {
    const [minutes = 0, seconds = 0] = String(game.toi || "0:00").split(":").map(Number);
    return minutes * 60 + seconds > 0;
  }), `${goalie.name} has no zero-minute backup appearances`);
}

const representative = (name, position, gp) => {
  const player = [...storedPlayers.values()].find(row => row.name === name && row.position === position);
  assert.ok(player, `${name} is present`);
  assert.equal(player.totals.gp, gp, `${name} games played match the official baseline`);
  assert.equal(player.games.length, gp, `${name} has a complete game log`);
  return player;
};

representative("Connor McDavid", "C", 82); // star forward
representative("Cale Makar", "D", 75); // star defenceman
representative("Macklin Celebrini", "C", 82); // young player
representative("Anthony Richard", "C", 1); // depth player
representative("Ukko-Pekka Luukkonen", "G", 35); // established goalie
representative("Pyotr Kochetkov", "G", 9); // limited-sample goalie
const traded = representative("Quinn Hughes", "D", 74);
assert.deepEqual(traded.teams, ["VAN", "MIN"], "a traded player keeps both affiliations on one full-season record");
assert.deepEqual([...new Set(traded.games.map(game => game.team))], ["VAN", "MIN"], "a traded player's game log preserves the team for each appearance");

const duplicateNames = archive.naturalStatTrick.players.filter(row => row.name === "Elias Pettersson");
assert.equal(duplicateNames.length, 2, "both same-name Vancouver players remain available");
assert.deepEqual(new Set(duplicateNames.map(row => String(row.id))), new Set(["8480012", "8483678"]), "same-name players resolve to distinct NHL identities");
assert.deepEqual(new Set(duplicateNames.map(row => row.position)), new Set(["C", "D"]), "same-name identity matching preserves position");

assert.equal(current.playerCoverage.currentRosterPlayers, 795, "the current roster index includes every imported NHL roster player");
assert.equal(current.playerCoverage.officialSeasonPlayers, 0, "the offseason does not invent current-season appearances");
assert.equal(current.playerCoverage.officialReconciliationFailures, 0, "an empty new season is a valid state rather than a reconciliation failure");
assert.equal(current.playerCoverage.scope, "All NHL teams", "the current player pipeline remains league-wide before games begin");
const currentRosterIds = new Set(Object.values(current.rosters).flat().map(player => String(player.id)));
assert.ok(currentRosterIds.has("8484803"), "a rookie without previous NHL evidence remains selectable");
assert.ok(currentRosterIds.has("8477493"), "an inactive star without valid previous-season evidence remains selectable");
assert.ok(!storedPlayers.has("8484803") && !storedPlayers.has("8477493"), "unavailable league evidence is represented as absence rather than fabricated statistics");

console.log("generated data integrity: all checks passed");
