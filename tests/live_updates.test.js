const assert = require("node:assert/strict");
globalThis.NHLTrackerGameState = require("../site/game-state.js");
const live = require("../site/live-updates.js");

const payload = states => ({ daily: { games: states.map((state, index) => ({
  id: index + 1, away: "BUF", home: "BOS", state,
  startTimeUTC: "2026-10-06T23:00:00Z", awayScore: 0, homeScore: 0,
})) } });

assert.equal(live.hasActiveGame(payload(["LIVE"])), true);
assert.equal(live.hasActiveGame(payload(["POSTPONED", "DELAYED", "SUSPENDED", "CANCELLED"])), false,
  "exceptional games never keep refresh polling active");
assert.equal(live.pollingEligible({ payloadSeason: "20262027", currentSeason: "20262027",
  visibilityState: "visible", route: "tonight", payload: payload(["LIVE"]) }), true);
assert.equal(live.pollingEligible({ payloadSeason: "20262027", currentSeason: "20262027",
  visibilityState: "hidden", route: "tonight", payload: payload(["LIVE"]) }), false);

const changes = live.meaningfulChanges(payload(["PRE"]), { daily: { games: [{
  id: 1, away: "BUF", home: "BOS", state: "FINAL", gameOutcome: { lastPeriodType: "SO" },
  awayScore: 3, homeScore: 2,
}] } });
assert.equal(changes[0].stateLabel, "Final/SO");
assert.match(changes[0].message, /Final\/SO/);

console.log("live update contracts: all checks passed");
