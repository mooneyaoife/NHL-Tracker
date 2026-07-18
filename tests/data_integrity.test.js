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
for (const standing of archive.standings) {
  const eligible = stats.filterPlayersByTeam(archive.naturalStatTrick.players, standing.team).filter(player => Number(player.toi || 0) >= 200);
  assert.ok(eligible.length >= 1, `${standing.team} has eligible player-comparison choices`);
  assert.ok(eligible.length <= 40, `${standing.team} player comparison remains a manageable team-sized list`);
}

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
  assert.ok(stored.games.every(game => typeof game.starter === "boolean"), `${goalie.name} stores the official starter flag for every appearance`);
}

for (const team of Object.keys(archive.teams)) {
  const lastGame = archive.teams[team].games.at(-1);
  assert.ok(lastGame, `${team} has completed-game evidence for Lineups`);
  const lastGameGoalies = (archive.players[team] || []).filter(player => player.position === "G").flatMap(player =>
    (player.games || []).filter(game => game.team === team && game.date === lastGame.date && Number(game.shotsAgainst || 0) > 0),
  );
  assert.ok(lastGameGoalies.length > 0, `${team} has goalie evidence for its most recent completed game`);
  assert.ok(lastGameGoalies.some(game => game.starter === true), `${team} identifies the starter in its most recent completed game`);
  assert.ok(archive.moneypuck.lines.some(row => row.team === team), `${team} has stored line-combination evidence`);
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

assert.ok(current.playerCoverage.currentRosterPlayers >= 700, "the current roster index contains a plausible league-wide NHL population");
assert.equal(current.playerCoverage.currentRosterPlayers, new Set(Object.values(current.rosters).flat().map(player => String(player.id))).size, "current roster coverage counts unique player identities");
assert.equal(Object.keys(current.rosters).length, 32, "current rosters cover all NHL teams");
assert.equal(current.playerCoverage.officialReconciliationFailures, 0, "the current season reports no unexplained reconciliation failures");
assert.equal(current.playerCoverage.reconciledOfficialPlayers, current.playerCoverage.officialSeasonPlayers, "every current official player history reconciles, including the valid empty-season state");
assert.equal(current.playerCoverage.scope, "All NHL teams", "the current player pipeline remains league-wide before games begin");
const currentRosterIds = new Set(Object.values(current.rosters).flat().map(player => String(player.id)));
assert.ok([...currentRosterIds].every(Boolean), "every current roster player has a usable identity");
const currentOfficialIds = new Set([...current.officialPlayers.skaters, ...current.officialPlayers.goalies].map(player => String(player.id)));
const currentStoredIds = new Set(Object.values(current.players).flat().map(player => String(player.id)));
assert.ok([...currentOfficialIds].every(playerId => currentStoredIds.has(playerId)), "every current official season player remains selectable");

console.log("generated data integrity: all checks passed");
