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
assert.equal(stats.number("  "), null, "the public numeric helper keeps blank strings unavailable");
assert.equal(stats.number(false), null, "the public numeric helper does not coerce booleans into statistics");
assert.equal(stats.number("2.5"), 2.5, "the public numeric helper accepts finite numeric strings");
assert.equal(stats.comparisonRate({ toi: 300, goals: 5 }, "goals"), 1, "the canonical comparison rate is calculated per 60 minutes");
assert.equal(stats.comparisonRate({ toi: 300, goals: "" }, "goals"), null, "a missing rate numerator remains unavailable rather than zero");

const comparisonPlayers = [
  { id: "1", name: "One Team", teams: ["BUF"] },
  { id: "2", name: "Traded Player", teams: ["VAN", "MIN"] },
  { id: "3", name: "Scalar Team", team: "MIN" },
];
assert.deepEqual(stats.filterPlayersByTeam(comparisonPlayers, "BUF").map(player => player.id), ["1"], "team filtering limits comparison options to the chosen club");
assert.deepEqual(stats.filterPlayersByTeam(comparisonPlayers, "MIN").map(player => player.id), ["2", "3"], "team filtering preserves traded and scalar-affiliation records");
assert.deepEqual(stats.filterPlayersByTeam(comparisonPlayers, "CAR"), [], "teams without eligible players return an honest empty list");

const seasonEvidence = {
  meta: { season: "20252026" },
  players: {
    MIN: [{
      id: "8470001",
      name: "Traded Skater",
      teams: ["VAN", "MIN"],
      position: "C",
      totals: { gp: 40, goals: 8, assists: 12, points: 20, shots: 70 },
      games: [
        { date: "2025-10-01", team: "VAN", opponent: "EDM", points: 1 },
        { date: "2026-02-01", team: "MIN", opponent: "DAL", points: 2 },
      ],
      headshot: "https://example.test/traded.png",
    }],
  },
  naturalStatTrick: {
    players: [{ id: "", name: "Traded Skater", teams: ["MIN", "VAN"], position: "C", gp: 40, toi: 450, points: 20 }],
    goalies: [{ id: "", name: "Samuel Montembeault", teams: ["MTL"], gp: 35, toi: 1200, savePct: .91, gsaa: 4 }],
  },
  moneypuck: {
    skaters: [{
      id: "8470001",
      name: "Provider Spelling",
      team: "MIN",
      position: "C",
      games: 40,
      minutes: 700,
      xGoals: 11.5,
      goalsAboveExpected: -3.5,
    }],
    goalies: [{
      id: "",
      name: "Sam Montembeault",
      team: "MTL",
      games: 35,
      minutes: 2100,
      gsax: 6.5,
    }],
  },
  officialPlayers: {
    skaters: [
      { id: "8470001", name: "Traded Skater", teams: ["VAN", "MIN"], position: "C", totals: { gp: 40 } },
      { id: "8470002", name: "Official Only", teams: ["BUF"], position: "D", totals: { gp: 1 } },
    ],
    goalies: [{ id: "8470003", name: "Sam Montembeault", teams: ["MTL"], position: "G", totals: { gp: 35 } }],
  },
};
const seasonRecords = stats.seasonComparisonRecords(seasonEvidence);
assert.equal(seasonRecords.length, 3, "season comparison keeps sourced and official-only participants without duplication");
assert.equal(seasonRecords.find(player => player.name === "Traded Skater").id, "8470001", "name-matched skaters inherit the stable NHL identity");
assert.deepEqual(seasonRecords.find(player => player.name === "Traded Skater").teams, ["MIN", "VAN"], "traded affiliations are combined deterministically");
const mergedSkater = seasonRecords.find(player => player.name === "Traded Skater");
assert.equal(mergedSkater.naturalStatTrick.points, 20, "flattened Natural Stat Trick values also remain available in a named source record");
assert.equal(mergedSkater.moneyPuck.xGoals, 11.5, "MoneyPuck evidence joins the season record by stable identity");
assert.equal(mergedSkater.moneyPuck.games, 40, "MoneyPuck's numeric games sample remains within the MoneyPuck record");
assert.ok(Array.isArray(mergedSkater.games), "MoneyPuck's numeric games field never overwrites the official game-log array");
assert.deepEqual(mergedSkater.gameLog, mergedSkater.games, "the canonical gameLog field exposes the detailed official game history");
assert.equal(mergedSkater.gameLog.length, 2, "the complete detailed game log is retained");
assert.equal(mergedSkater.totals.points, 20, "official season totals are retained beside provider evidence");
assert.equal(mergedSkater.headshot, "https://example.test/traded.png", "the detailed player headshot is retained");
assert.deepEqual(mergedSkater.sourceFlags, {
  naturalStatTrick: true,
  moneyPuck: true,
  official: true,
  gameLog: true,
}, "record-level source flags describe the joined evidence");
assert.equal(mergedSkater.statisticalScope, "allTeams", "the comparison model declares an All teams statistical scope");
assert.equal(mergedSkater.allTeams, true, "the All teams scope is machine-readable");
assert.equal(mergedSkater.isTraded, true, "multi-team season participants remain explicitly identified");
assert.equal(seasonRecords.find(player => player.position === "G").id, "8470003", "known goalie name variants resolve to the stable NHL identity");
assert.equal(seasonRecords.find(player => player.position === "G").moneyPuck.gsax, 6.5, "goalie name variants also join MoneyPuck evidence");
assert.equal(seasonRecords.find(player => player.name === "Official Only").sourceAvailable, false, "official participants without source fields remain selectable and explicit");
assert.deepEqual(stats.comparisonEligibility(seasonRecords.find(player => player.name === "Traded Skater")), { eligible: true, minimum: 200, unit: "five-on-five minutes", reason: "Eligible" }, "skater chart eligibility uses the stated five-on-five threshold");
assert.deepEqual(stats.comparisonEligibility({ comparisonType: "goalie", gp: 10, toi: 500, sourceAvailable: true }), { eligible: true, minimum: 500, unit: "five-on-five minutes", reason: "Eligible" }, "goalie chart eligibility aligns with the 500-minute site-wide minimum");
assert.equal(stats.comparisonEligibility({ comparisonType: "goalie", gp: 10, toi: 499, sourceAvailable: true }).eligible, false, "goalies below 500 five-on-five minutes remain small-sample participants");
assert.equal(stats.comparisonPeerGroup({ position: "D", comparisonType: "skater" }), "Defencemen", "defencemen use their own peer group");
assert.equal(stats.comparisonPercentile([{ value: 1 }, { value: 2 }, { value: 3 }], row => row.value, { value: 2 }), 67, "percentiles preserve Player Impact's inclusive empirical rank");
assert.equal(stats.comparisonPercentile([{ value: 1 }, { value: 2 }, { value: 3 }], row => row.value, { value: 1 }, false), 100, "lower-is-better metrics invert the percentile");
assert.equal(stats.comparisonPercentile([{ value: null }, { value: "" }, { value: 1 }, { value: 2 }], row => row.value, { value: 1 }), 50, "missing percentile observations are excluded instead of becoming zeroes");
assert.equal(stats.comparisonPercentile([{ value: 1 }, { value: 2 }], row => row.value, { value: null }), null, "a missing target metric has no percentile");

const sameNameEvidence = {
  meta: { season: "20252026" },
  naturalStatTrick: {
    players: [
      { id: "100", name: "Alex Smith", teams: ["ANA"], position: "C", gp: 40, toi: 400, goals: 4 },
      { id: "200", name: "Alex Smith", teams: ["BOS"], position: "C", gp: 50, toi: 500, goals: 9 },
      { id: "300", name: "Alex Smith", teams: ["CBJ"], position: "C", gp: 20, toi: 250, goals: 2 },
    ],
    goalies: [],
  },
  officialPlayers: {
    skaters: [
      { id: "100", name: "Alex Smith", teams: ["ANA"], position: "C", totals: { gp: 40 } },
      { id: "200", name: "Alex Smith", teams: ["BOS"], position: "C", totals: { gp: 50 } },
    ],
    goalies: [],
  },
};
const sameNameRecords = stats.seasonComparisonRecords(sameNameEvidence);
assert.deepEqual(sameNameRecords.map(row => [row.id, row.teams[0], row.goals]), [
  ["100", "ANA", 4],
  ["200", "BOS", 9],
  ["300", "CBJ", 2],
], "stable IDs keep same-name season participants distinct during provider joins");

const impactRow = (id, name, multiplier, overrides = {}) => ({
  id,
  name,
  position: "C",
  comparisonType: "skater",
  sourceAvailable: true,
  toi: 600,
  goals: 4 * multiplier,
  firstAssists: 4 * multiplier,
  ixg: 5 * multiplier,
  ihdcf: 10 * multiplier,
  rushAttempts: 4 * multiplier,
  shots: 40 * multiplier,
  takeaways: 6 * multiplier,
  penaltiesDrawn: 4 * multiplier,
  totalPenalties: 2 * multiplier,
  ...overrides,
});
const impactTarget = impactRow("target", "Shared Name", 2);
const impactRows = [
  impactRow("low", "Low Peer", 1),
  impactTarget,
  impactRow("same-name", "Shared Name", 2),
  impactRow("high", "High Peer", 3),
  { ...impactRow("defence", "Defence Peer", 2), position: "D" },
];
assert.deepEqual(stats.skaterPeerRows(impactRows, impactTarget).map(row => row.id), [
  "low", "target", "same-name", "high",
], "skater peer rows use position group and the 200-minute threshold");
assert.equal(stats.skaterImpactMeasures.length, 6, "the shared Impact model exposes its six transparent measures");
assert.deepEqual(stats.skaterImpactPercentiles(impactTarget, impactRows), [75, 75, 75, 75, 75, 75], "Impact percentiles use the established inclusive same-position peer distribution");
assert.equal(stats.skaterImpactScore(impactTarget, impactRows), 75, "the shared Impact score is the rounded mean of its six established percentiles");
assert.deepEqual(stats.skaterImpactComponents(impactTarget, impactRows), [
  { label: "Primary offence", value: 75, detail: "Goals and first assists per 60" },
  { label: "Chance generation", value: 75, detail: "Expected goals, high-danger and rush chances" },
  { label: "Puck recovery", value: 75, detail: "Takeaways per 60" },
  { label: "Discipline", value: 75, detail: "Penalties drawn minus taken per 60" },
], "the four shared components match the Player Impact presentation");
const missingImpact = impactRow("missing", "Missing Evidence", 2, { ixg: "" });
assert.equal(stats.skaterImpactScore(missingImpact, [...impactRows, missingImpact]), null, "an unavailable Impact measure cannot silently become a zero-valued score");
assert.equal(stats.skaterImpactComponents(missingImpact, [...impactRows, missingImpact])[1].value, null, "component groups remain unavailable when a required measure is missing");
const neighbours = stats.skaterStatisticalNeighbours(impactTarget, [
  ...impactRows,
  impactRow("target", "Duplicate Stable Identity", 4),
]);
assert.equal(neighbours[0].row.id, "same-name", "a same-name player with a different stable ID remains a valid statistical neighbour");
assert.equal(neighbours[0].distance, 0, "an identical six-feature profile has zero z-score distance");
assert.equal(neighbours[0].similarity, 100, "an identical six-feature profile has full profile similarity");
assert.ok(neighbours.every(item => item.row.name !== "Duplicate Stable Identity"), "the selected stable ID is excluded from statistical neighbours even when its display name differs");

console.log("frontend statistics: all checks passed");
