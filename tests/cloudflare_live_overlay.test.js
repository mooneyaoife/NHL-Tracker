const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const gameState = require("../site/game-state.js");

const source = fs.readFileSync(path.resolve(__dirname, "../site/cloudflare-live.js"), "utf8");
const original = { meta: { updatedAt: "2026-07-18T12:00:00Z" }, daily: { currentDate: "2026-10-17", games: [{ id: 9 }] } };
const score = { currentDate: "2026-10-18", games: [{ id: 2026020001, gameDate: "2026-10-18",
  startTimeUTC: "2026-10-18T18:00:00Z", gameState: "LIVE",
  awayTeam: { abbrev: "NYR", score: 3 }, homeTeam: { abbrev: "BOS", score: 2 } }] };
const schedule = { gameWeek: [{ date: "2026-10-18", games: [{ id: 2026020001,
  startTimeUTC: "2026-10-18T18:00:00Z", gameState: "LIVE", gameType: 2,
  awayTeam: { abbrev: "NYR", score: 2 }, homeTeam: { abbrev: "BOS", score: 1 },
  tvBroadcasts: [{ network: "SN" }] }] }] };

function contextFor(marker, fetchImpl) {
  const window = { NHLTrackerGameState: gameState };
  const context = vm.createContext({ window, document: { querySelector: () => marker }, fetch: fetchImpl,
    AbortController, Headers, Request, Response, setTimeout, clearTimeout, Date, URL, console });
  vm.runInContext(source, context);
  return window.NHLCloudflareLive;
}

const responseFor = (data, meta = {}) => new Response(JSON.stringify({ ok: true, data,
  meta: { state: "live", stale: false, cache: "miss", fetchedAt: "2026-10-18T19:00:00Z", ...meta } }),
  { headers: { "content-type": "application/json" } });
const pathFor = url => new URL(url, "https://example.test").pathname;

(async () => {
  let disabledCalls = 0;
  const disabled = contextFor(null, async () => { disabledCalls += 1; });
  assert.equal(disabled.enabled, false);
  assert.equal(await disabled.hydrate(original), original);
  assert.equal(disabledCalls, 0, "GitHub Pages does not probe a missing /api route");

  const full = contextFor({ content: "/api" }, async url => responseFor(pathFor(url).includes("score") ? score : schedule));
  const hydrated = await full.hydrate(original);
  assert.equal(hydrated.daily.games[0].awayScore, 3, "score results override schedule scores");
  assert.equal(hydrated.daily.games[0].status.code, "live");
  assert.equal(hydrated.meta.cloudflareLive.status, "live");

  const scoreOnly = contextFor({ content: "/api" }, async url => {
    if (pathFor(url).includes("schedule")) throw new Error("schedule unavailable");
    return responseFor(score);
  });
  const scoreResult = await scoreOnly.hydrate(original);
  assert.equal(scoreResult.daily.games.length, 1, "score-only success still produces a slate");
  assert.equal(scoreResult.meta.cloudflareLive.status, "partial-live");
  assert.equal(scoreResult.meta.cloudflareLive.components.schedule, "unavailable");

  const scheduleOnly = contextFor({ content: "/api" }, async url => {
    if (pathFor(url).includes("score")) throw new Error("score unavailable");
    return responseFor(schedule);
  });
  const scheduleResult = await scheduleOnly.hydrate(original);
  assert.equal(scheduleResult.daily.games[0].broadcasts[0], "SN", "schedule-only success retains schedule context");
  assert.equal(scheduleResult.meta.cloudflareLive.status, "partial-live");

  const unavailable = contextFor({ content: "/api" }, async () => { throw new Error("offline"); });
  const fallback = await unavailable.hydrate(original);
  assert.deepEqual(fallback.daily, original.daily, "both failures leave the static slate untouched");
  assert.equal(fallback.meta.cloudflareLive.status, "static-fallback");

  const cached = contextFor({ content: "/api" }, async url => responseFor(
    pathFor(url).includes("score") ? score : schedule, { cache: "hit" }));
  assert.equal((await cached.hydrate(original)).meta.cloudflareLive.status, "cached");

  const stale = contextFor({ content: "/api" }, async url => responseFor(
    pathFor(url).includes("score") ? score : schedule, { cache: "stale", stale: true, state: "stale" }));
  assert.equal((await stale.hydrate(original)).meta.cloudflareLive.status, "stale");

  let failSchedule = false;
  const retained = contextFor({ content: "/api" }, async url => {
    if (failSchedule && pathFor(url).includes("schedule")) throw new Error("temporary failure");
    return responseFor(pathFor(url).includes("score") ? score : schedule);
  });
  await retained.hydrate(original);
  failSchedule = true;
  const retainedResult = await retained.hydrate(original);
  assert.equal(retainedResult.daily.games[0].broadcasts[0], "SN", "last good schedule survives a partial retry");
  assert.equal(retainedResult.meta.cloudflareLive.status, "partial-live");

  console.log("cloudflare live overlay: all checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
