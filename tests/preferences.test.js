const assert = require("node:assert/strict");
const preferences = require("../site/preferences.js");

function memory(initial = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    getItem: key => rows.has(key) ? rows.get(key) : null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: key => rows.delete(key),
    rows,
  };
}

const defaults = { order: ["performance", "form", "players", "pinned"], hidden: [], pins: ["rankings"] };
const storage = memory({
  "nhl-home-workspace-v1": JSON.stringify({ order: ["form", "unknown", "form"], hidden: ["players", "unknown"], pins: ["rankings", "old"] }),
  "nhl-player-lenses-v1": JSON.stringify({ "10": "impact", "11": "removed" }),
  "nhl-saved-analysis-views-v1": JSON.stringify([{ id: "one", page: "league", chart: "power" }, { id: "broken", page: "league" }]),
  "nhl-watchlist": JSON.stringify({ teams: ["BUF", "BUF"], players: [10, "10", 11] }),
});
const store = preferences.create(storage);
assert.deepEqual(store.homePrefs(defaults, defaults.order, ["rankings"]), {
  order: ["form", "performance", "players", "pinned"], hidden: ["players"], pins: ["rankings"],
});
assert.deepEqual(store.playerLenses(["form", "impact"]), { "10": "impact" });
assert.deepEqual(store.savedViews(), [{ id: "one", page: "league", chart: "power" }]);
assert.deepEqual(store.watchlist(), { teams: ["BUF"], players: ["10", "11"] });

store.migrate({ defaults, moduleIds: defaults.order, pinIds: ["rankings"], validLenses: ["form", "impact"] });
assert.deepEqual(JSON.parse(storage.rows.get("nhl-home-workspace-v1")).order, ["form", "performance", "players", "pinned"]);
assert.deepEqual(JSON.parse(storage.rows.get("nhl-player-lenses-v1")), { "10": "impact" });
assert.equal(store.savePlayerLens("12", "form", ["form", "impact"]), true);
assert.equal(store.savePlayerLens("12", "bad", ["form", "impact"]), false);
assert.deepEqual(store.selectedTeams(new Set(["BUF", "BOS"]), ["BOS"]), ["BOS"]);

console.log("preference contracts: all checks passed");
