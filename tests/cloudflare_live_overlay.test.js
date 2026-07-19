const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../site/cloudflare-live.js"), "utf8");

function contextFor(marker, fetchImpl) {
  const window = {};
  const context = vm.createContext({
    window,
    document: { querySelector: () => marker },
    fetch: fetchImpl,
    AbortController,
    Headers,
    Request,
    Response,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    console,
  });
  vm.runInContext(source, context);
  return window.NHLCloudflareLive;
}

(async () => {
  let disabledCalls = 0;
  const disabled = contextFor(null, async () => { disabledCalls += 1; });
  const original = { meta: { updatedAt: "2026-07-18T12:00:00Z" }, daily: { games: [] } };
  assert.equal(disabled.enabled, false);
  assert.equal(await disabled.hydrate(original), original);
  assert.equal(disabledCalls, 0, "GitHub Pages does not probe a missing /api route");

  const responses = {
    "/api/nhl/score/now": { currentDate: "2026-10-18", games: [{
      id: 2026020001,
      gameDate: "2026-10-18",
      startTimeUTC: "2026-10-18T18:00:00Z",
      gameState: "LIVE",
      awayTeam: { abbrev: "NYR", score: 3 },
      homeTeam: { abbrev: "BOS", score: 2 },
    }] },
    "/api/nhl/schedule/now": {
      gameWeek: [{ date: "2026-10-18", games: [{
        id: 2026020001,
        gameDate: "2026-10-18",
        startTimeUTC: "2026-10-18T18:00:00Z",
        gameState: "LIVE",
        gameType: 2,
        awayTeam: { abbrev: "NYR", score: 2 },
        homeTeam: { abbrev: "BOS", score: 1 },
        tvBroadcasts: [{ network: "SN" }],
      }] }],
    },
  };
  const enabled = contextFor({ content: "/api" }, async url => new Response(JSON.stringify({
    ok: true,
    data: responses[new URL(url, "https://example.test").pathname],
    meta: { state: "live", stale: false, cache: "hit", fetchedAt: "2026-10-18T19:00:00Z" },
  }), { headers: { "content-type": "application/json" } }));
  const hydrated = await enabled.hydrate(original);
  assert.equal(enabled.enabled, true);
  assert.equal(hydrated.daily.games.length, 1);
  assert.equal(hydrated.daily.games[0].away, "NYR");
  assert.equal(hydrated.daily.games[0].awayScore, 3, "the score feed overrides a schedule snapshot");
  assert.equal(hydrated.daily.games[0].homeScore, 2);
  assert.equal(hydrated.meta.cloudflareLive.status, "live");

  console.log("cloudflare live overlay: all checks passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
