import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";

const gameStateFixtures = JSON.parse(readFileSync(new URL("../fixtures/game_states.json", import.meta.url), "utf8"));
const browserGameStates = gameStateFixtures.filter(row =>
  ["delayed", "suspended", "cancelled", "final-ot", "final-so"].includes(row.code));

async function routeTracker(page, transform) {
  await page.route(/\/data\/(tracker|tracker-core)\.json$/, async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: transform(data) });
  });
}

function gameFor(fixture, index = 0) {
  return {
    id: 2026020900 + index,
    type: 2,
    date: fixture.game.date || "2026-10-18",
    slateDate: fixture.game.date || "2026-10-18",
    startTimeUTC: fixture.game.startTimeUTC || "2026-10-18T18:00:00Z",
    away: "BUF",
    home: "BOS",
    awayScore: fixture.code.startsWith("final") ? 3 : null,
    homeScore: fixture.code.startsWith("final") ? 2 : null,
    ...fixture.game,
  };
}

test("routes announce changes and search restores keyboard focus", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#updated")).not.toContainText("Loading");
  await page.getByRole("button", { name: "Tonight", exact: true }).click();
  await expect(page.locator("#tonight")).toHaveClass(/active/, { timeout: 15_000 });
  await expect(page.locator("#route-announcer")).toContainText(/Tonight/);
  await page.locator("#global-search-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#global-search-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#global-search-button")).toBeFocused();
});

test("postponed games remain exceptional after their original start time", async ({ page }) => {
  await routeTracker(page, data => {
    data.daily = { currentDate: "2026-01-01", games: [{ id: 2026020999, date: "2026-01-01",
      startTimeUTC: "2026-01-01T00:30:00Z", state: "POSTPONED", type: 2,
      away: "BUF", home: "BOS", awayScore: null, homeScore: null }] };
    return data;
  });
  await page.goto("/#tonight");
  await expect(page.locator("#tonight-games")).toContainText("Postponed");
  await page.getByRole("button", { name: /Open Game Centre/ }).first().click();
  await expect(page.locator("#game-select option:checked")).toContainText("Postponed");
  await expect(page.locator("#game-select option:checked")).not.toContainText("Completed");
});

for (const [index, fixture] of browserGameStates.entries()) {
  test(`${fixture.name} is rendered from the shared fixture`, async ({ page }) => {
    await routeTracker(page, data => ({ ...data, daily: {
      currentDate: gameFor(fixture, index).slateDate,
      slateDate: gameFor(fixture, index).slateDate,
      games: [gameFor(fixture, index)],
    } }));
    await page.goto("/#tonight");
    await expect(page.locator("#tonight-games")).toContainText(fixture.label);
  });
}

for (const fixture of [
  { name: "offseason", date: "2026-07-24", copy: "The NHL is in its offseason" },
  { name: "empty slate", date: "2026-11-24", copy: "There are no games in the current NHL window" },
]) {
  test(`${fixture.name} has an explicit empty state`, async ({ page }) => {
    await routeTracker(page, data => ({ ...data, daily: { currentDate: fixture.date, slateDate: fixture.date, games: [] } }));
    await page.goto("/#tonight");
    await expect(page.locator("#tonight-notice")).toContainText(fixture.copy);
  });
}

test("London calendar dates cover midnight and DST fixture boundaries", async ({ page }) => {
  await page.goto("/#tonight");
  const dateRows = gameStateFixtures.filter(row => row.londonDate).map(row => ({
    name: row.name,
    value: row.game.startTimeUTC,
    expected: row.londonDate,
  }));
  const results = await page.evaluate(rows => rows.map(row => ({
    name: row.name,
    actual: window.NHLTrackerGameState.dateInTimeZone(row.value),
  })), dateRows);
  expect(results).toEqual(dateRows.map(row => ({ name: row.name, actual: row.expected })));
});

test("valid static content renders while private live requests are pending", async ({ page }) => {
  const html = (await fs.readFile(new URL("../../site/index.html", import.meta.url), "utf8"))
    .replace('<meta name="theme-color" content="#f3f1ea">', '<meta name="theme-color" content="#f3f1ea">\n<meta name="nhl-cloudflare-api" content="/api">');
  await page.route("http://127.0.0.1:4173/", route => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  let liveRequestPending = false;
  await page.route("**/api/nhl/**", async route => {
    liveRequestPending = true;
    await new Promise(resolve => setTimeout(resolve, 5000));
    await route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('meta[name="nhl-cloudflare-api"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Tonight", exact: true }).click();
  await expect.poll(() => liveRequestPending, { timeout: 10_000 }).toBe(true);
  await expect(page.locator("#updated")).not.toContainText("Loading");
  await expect(page.locator("#tonight")).toHaveClass(/active/);
});

const freshnessFixtures = [
  { name: "partial-live", label: "Partial live data", score: "live", schedule: "fail" },
  { name: "cached", label: "Cached scores", score: "cached", schedule: "cached" },
  { name: "stale", label: "Stale scores", score: "stale", schedule: "stale" },
  { name: "static-fallback", label: "Static snapshot", score: "fail", schedule: "fail" },
];

for (const fixture of freshnessFixtures) {
  test(`${fixture.name} exposes accessible recovery detail`, async ({ page }) => {
    const html = (await fs.readFile(new URL("../../site/index.html", import.meta.url), "utf8"))
      .replace('<meta name="theme-color" content="#f3f1ea">', '<meta name="theme-color" content="#f3f1ea">\n<meta name="nhl-cloudflare-api" content="/api">');
    await page.route("http://127.0.0.1:4173/", route => route.fulfill({ status: 200, contentType: "text/html", body: html }));
    const payload = kind => ({
      ok: true,
      data: kind === "score"
        ? { currentDate: "2026-10-18", games: [{ id: 2026020001, gameDate: "2026-10-18", startTimeUTC: "2026-10-18T18:00:00Z", gameState: "LIVE", awayTeam: { abbrev: "BUF", score: 2 }, homeTeam: { abbrev: "BOS", score: 1 } }] }
        : { gameWeek: [{ date: "2026-10-18", games: [{ id: 2026020001, startTimeUTC: "2026-10-18T18:00:00Z", gameState: "LIVE", gameType: 2, awayTeam: { abbrev: "BUF" }, homeTeam: { abbrev: "BOS" } }] }] },
      meta: { state: fixture[kind] === "stale" ? "stale" : "live", stale: fixture[kind] === "stale", cache: fixture[kind] === "cached" ? "hit" : fixture[kind] === "stale" ? "stale" : "miss", fetchedAt: "2026-10-18T19:00:00Z" },
    });
    for (const kind of ["score", "schedule"]) {
      await page.route(`**/api/nhl/${kind}/now`, route => fixture[kind] === "fail"
        ? route.fulfill({ status: 503, body: "unavailable" })
        : route.fulfill({ status: 200, contentType: "application/json", json: payload(kind) }));
    }
    await page.goto("/#tonight");
    await expect(page.locator("#updated")).toHaveAttribute("data-freshness", fixture.name);
    await expect(page.locator("#updated")).toContainText(fixture.label);
    await page.locator("#updated").click();
    await expect(page.locator("#freshness-detail-copy")).toContainText(/Reloading|displayed data/);
  });
}

test("mobile, tablet and desktop layouts avoid horizontal overflow", async ({ page }) => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
});

test("principal journeys have no serious automated accessibility violations", async ({ page }) => {
  for (const route of ["dashboard", "tonight", "schedule", "games"]) {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("nhl-last-route-v1"));
    await page.goto("about:blank");
    await page.goto(`/#${route}`);
    await expect(page.locator(`#${route}`)).toHaveClass(/active/);
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(violation => ["serious", "critical"].includes(violation.impact)), route).toEqual([]);
  }
});
