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

test("shell search opens on the first click", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Find anything", exact: true }).click();
  await expect(page.locator("#global-search-overlay")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#global-search-input")).toBeFocused();
});

test("shell theme changes on the first click and keeps browser chrome in sync", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("nhl-theme"));
  await page.reload();
  await page.getByRole("button", { name: "Switch colour theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", { timeout: 15_000 });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#111815");
});

test("public direct links hand off to the canonical tracker route", async ({ page }) => {
  await page.goto("/season/?month=2026-10");
  await expect(page).toHaveURL(/\/\?month=2026-10#schedule$/);
  await expect(page.locator("#schedule")).toHaveClass(/active/, { timeout: 15_000 });
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
  { name: "empty slate", date: "2026-11-24", copy: "There are no games in today's UK window" },
]) {
  test(`${fixture.name} has an explicit empty state`, async ({ page }) => {
    await page.addInitScript(now => {
      const NativeDate = Date;
      class FixedDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return new NativeDate(now).getTime(); }
      }
      globalThis.Date = FixedDate;
    }, `${fixture.date}T12:00:00Z`);
    await routeTracker(page, data => ({ ...data, daily: { currentDate: fixture.date, slateDate: fixture.date, games: [] } }));
    await page.goto("/#tonight");
    await expect(page.locator("#tonight-notice")).toContainText(fixture.copy);
  });
}

test("a future slate is labelled as context rather than tonight", async ({ page }) => {
  await routeTracker(page, data => ({ ...data, daily: {
    currentDate: "2099-09-29",
    slateDate: "2099-09-29",
    games: [{ id: 2099020001, date: "2099-09-29", slateDate: "2099-09-29",
      startTimeUTC: "2099-09-29T23:00:00Z", state: "FUT", type: 2,
      away: "BUF", home: "BOS", awayScore: null, homeScore: null }],
  } }));
  await page.goto("/#tonight");
  await expect(page.locator("#tonight")).toHaveAttribute("data-slate-state", /next/);
  await expect(page.locator("#tonight-notice")).toContainText("Showing the next published slate");
  await expect(page.locator("#tonight-date")).toContainText("UK time");
});

test("a retained artifact is identified instead of presented as fresh static data", async ({ page }) => {
  await routeTracker(page, data => ({ ...data, meta: { ...data.meta, freshness: {
    status: "partial-stale", failedTeams: ["BUF"],
  } } }));
  await page.goto("/#tonight");
  await expect(page.locator("#updated")).toContainText("Stored fallback");
  await page.locator("#updated").click();
  await expect(page.locator("#freshness-detail-copy")).toContainText("BUF");
});

test("a failed manual refresh preserves the stored Game Centre view", async ({ page }) => {
  await page.route(/\/data\/tracker\.json\?live=/, route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/?game=2026020001#games");
  await expect(page.locator("#game-detail")).not.toBeEmpty({ timeout: 15_000 });
  await page.getByRole("button", { name: "Open detailed analysis", exact: true }).click();
  await expect(page.getByRole("button", { name: "Browse library", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.locator("#game-refresh").click();
  await expect(page.locator("#game-refresh-status")).toContainText("stored game view remains available");
  await expect(page.locator("#game-detail")).not.toBeEmpty();
});

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

test("header controls stay distinct and the season choice is singular", async ({ page }) => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#season-select option")).toHaveCount(2);
    await expect(page.locator("#season-archive-toggle")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Schedule", exact: true })).toHaveCount(1);
    const layout = await page.evaluate(() => {
      const rect = selector => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null;
      };
      const selectors = ["body>header .brand", ".season-switcher", ".freshness-control", "#global-search-button", "#theme-button"];
      return { header: rect("body>header"), nav: rect("body>#nav"), controls: selectors.map(rect) };
    });
    const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    for (let a = 0; a < layout.controls.length; a += 1) {
      for (let b = a + 1; b < layout.controls.length; b += 1) {
        expect(overlaps(layout.controls[a], layout.controls[b]), `${viewport.width}px controls ${a} and ${b}`).toBe(false);
      }
    }
    if (viewport.width > 760) expect(layout.nav.top).toBeGreaterThanOrEqual(layout.header.bottom - 1);
  }
});

test("principal routes share one type and control hierarchy", async ({ page }) => {
  const routes = [
    ["dashboard", "#dashboard .home-masthead-copy h1", "#dashboard .context-link"],
    ["schedule", "#schedule .schedule-command h2", "#schedule .schedule-story-rail button"],
    ["watchlist", "#watchlist .workspace-command h2", "#watchlist .workspace-story-rail button"],
    ["teams", "#teams #team-title", "#teams .section-subnav button"],
    ["players", "#players #player-title", "#players .section-subnav button"],
  ];
  for (const viewport of [{ width: 375, height: 812 }, { width: 1024, height: 820 }]) {
    await page.setViewportSize(viewport);
    for (const [route, titleSelector, actionSelector] of routes) {
      await page.goto(`/?visual-contract=${viewport.width}-${route}#${route}`);
      await expect(page.locator(`#${route}`)).toHaveClass(/active/);
      await expect(page.locator(titleSelector)).toBeVisible();
      await expect(page.locator(actionSelector).first()).toBeVisible();
      const visual = await page.evaluate(({ titleSelector, actionSelector }) => {
        const title = getComputedStyle(document.querySelector(titleSelector));
        const actionElement = document.querySelector(actionSelector);
        const action = getComputedStyle(actionElement);
        return {
          titleFamily: title.fontFamily,
          titleSize: Number.parseFloat(title.fontSize),
          actionFamily: action.fontFamily,
          actionHeight: actionElement.getBoundingClientRect().height,
        };
      }, { titleSelector, actionSelector });
      expect(visual.actionFamily, `${route} action family at ${viewport.width}px`).toBe(visual.titleFamily);
      expect(visual.titleSize, `${route} title size at ${viewport.width}px`).toBeGreaterThanOrEqual(34);
      expect(visual.actionHeight, `${route} action height at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("core journey avoids repeated slate, season and archive controls", async ({ page }) => {
  await page.goto("/#tonight");
  await expect(page.locator("#tonight")).toHaveClass(/active/);
  await expect(page.locator("#tonight-slate-rail")).toHaveCount(0);
  await expect(page.locator("#tonight-summary .metric")).toHaveCount(3);
  const openButtons = page.getByRole("button", { name: "Open Game Centre", exact: true });
  const openCount = await openButtons.count();
  expect(openCount).toBeGreaterThan(0);
  await openButtons.first().click();
  await expect(page.locator("#games")).toHaveClass(/active/);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const windowOptionCount = await page.locator("#game-select option").count();
  expect(windowOptionCount).toBeGreaterThan(0);
  expect(windowOptionCount).toBeLessThanOrEqual(25);
  await expect(page.locator(".game-centre-controls")).toContainText("Use Archive");

  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.locator("#schedule")).toHaveClass(/active/);
  await expect(page.locator("#schedule .schedule-command h2")).toHaveText("Schedule");
  await expect(page.locator("#schedule-intelligence-chapter")).toBeHidden();
  await expect(page.locator("#schedule-release-chapter")).toBeHidden();
  await expect(page.locator("#calendar-list")).not.toHaveClass(/quick-calendar-list/);
  expect(await page.locator("#calendar-list .calendar-day").count()).toBeGreaterThanOrEqual(28);
  expect(await page.locator("#calendar-list .calendar-day.has-games").count()).toBeGreaterThan(0);
  await expect(page.locator("#calendar-list .calendar-item")).toHaveCount(0);
  expect(await page.locator("#calendar-list .calendar-game").evaluateAll(games => games.every(game => Boolean(game.closest(".calendar-day"))))).toBe(true);
  if ((page.viewportSize()?.width || 0) > 640) await expect(page.locator("#schedule .calendar-weekdays")).toBeVisible();
  else await expect(page.locator("#schedule .calendar-weekdays")).toBeHidden();
  const shapeButton = page.locator('[data-schedule-target="schedule-intelligence-chapter"]');
  await expect(shapeButton).toHaveCount(1);
  await shapeButton.click();
  await expect(page.locator("#schedule-intelligence-chapter")).toBeVisible({ timeout: 15_000 });
});

test("workspace sections use concise labels without filing numbers", async ({ page }) => {
  await page.goto("/#watchlist");
  await expect(page.locator("#watchlist")).toHaveClass(/active/);
  await expect(page.locator("#workspace-chapter-nav button")).toHaveCount(5);
  await expect(page.locator("#workspace-chapter-nav")).not.toContainText(/\b0[1-5]\b/);
  await expect(page.locator("#workspace-command-state")).toHaveCount(0);
  await expect(page.locator("#workspace-command-counts")).toContainText(/saved views · \d+ players · \d+ teams/);
  await expect(page.locator('[data-workspace-target="workspace-saved"]')).toHaveAttribute("aria-pressed", "true");
});

test("dense secondary evidence starts collapsed and common actions meet the touch target", async ({ page }) => {
  test.slow();
  for (const viewport of [{ width: 375, height: 812 }, { width: 1024, height: 820 }]) {
    await page.setViewportSize(viewport);

    await page.goto(`/?round6=${viewport.width}-players#players`);
    const playerEvidence = page.locator('#players details[data-section-pane="player-profile"]');
    await expect(playerEvidence).toHaveCount(2);
    expect(await playerEvidence.evaluateAll(details => details.every(detail => !detail.open))).toBe(true);

    await page.goto(`/?round6=${viewport.width}-league#league`);
    await expect(page.locator("#league .analytics-section")).not.toHaveAttribute("open", "");
    await expect(page.getByText("Standings by division", { exact: true }).locator("..")).not.toHaveAttribute("open", "");

    for (const [route, selector] of [
      ["tonight", "#tonight .tonight-open"],
      ["compare", "#compare .comparison-share"],
      ["news", "#news .offseason-actions button"],
      ["guide", "#guide .guide-deep-dive summary"],
      ["status", "#status #open-nst-refresh"],
      ["status", "#status #nst-refresh-files"],
    ]) {
      await page.goto(`/?round6=${viewport.width}-${route}-${selector.length}#${route}`);
      if (route === "news") {
        await page.locator('[data-update-tab="rosters"]').click();
        await expect(page.locator("#rosters")).toHaveClass(/active/);
        await page.getByText("Roster Pulse", { exact: true }).click();
      }
      if (route === "guide") {
        await page.locator("#guide .guide-category-button").first().click();
        await expect(page.locator("#guide .guide-results")).toBeVisible();
      }
      if (route === "status" && selector.includes("refresh-files")) {
        await page.locator("#open-nst-refresh").click();
        await expect(page.locator("#nst-refresh-centre")).toHaveAttribute("open", "");
      }
      const action = page.locator(selector).first();
      await expect(action).toBeVisible();
      expect(await action.evaluate(element => Math.round(element.getBoundingClientRect().height)), `${route} ${selector} at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("remaining fan and utility routes stay inside mobile and intermediate viewports", async ({ page }) => {
  test.slow();
  await page.route(/\/data\/seasons\/\d{8}\.json(?:\?.*)?$/, route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"not required for viewport coverage"}' }));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?round3=responsive-routes#teams");
  await expect(page.locator("#teams")).toHaveClass(/active/, { timeout: 15000 });
  for (const viewport of [{ width: 375, height: 812 }, { width: 1024, height: 820 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["teams", "players", "league", "compare", "news", "watchlist", "guide", "status", "policies"]) {
      await page.evaluate(nextRoute => showPage(nextRoute), route);
      await expect(page.locator(`#${route}`)).toHaveClass(/active/, { timeout: 15000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${route} at ${viewport.width}px`).toBe(true);
    }
  }
});

test("Explore routes keep one primary task and reveal deeper evidence on demand", async ({ page }) => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 1024, height: 820 }]) {
    await page.setViewportSize(viewport);

    await page.goto(`/?round8=${viewport.width}-teams#teams`);
    const teamTabs = page.locator('#teams [data-section-tab]');
    await expect(teamTabs).toHaveCount(5);
    expect(await teamTabs.evaluateAll(buttons => buttons.every((button, index) => !buttons[index + 1] || button.getBoundingClientRect().right <= buttons[index + 1].getBoundingClientRect().left + 1))).toBe(true);
    if (viewport.width === 375) {
      const rail = await page.locator("#teams>.section-subnav").evaluate(nav => {
        const last = nav.lastElementChild;
        return {
          overflowX: getComputedStyle(nav).overflowX,
          contentFits: !last || last.offsetLeft + last.offsetWidth <= nav.scrollWidth + 1,
        };
      });
      expect(rail.overflowX).toBe("auto");
      expect(rail.contentFits).toBe(true);
    }
    await page.locator('[data-section-tab="team-advanced"]').click();
    await expect(page.locator('[data-section-tab="team-advanced"]')).toHaveAttribute("aria-pressed", "true");
    const teamStyle = page.locator("#team-nst-chart").locator("xpath=ancestor::details[1]");
    await expect(teamStyle).not.toHaveAttribute("open", "");
    await teamStyle.locator("summary").click();
    await expect(teamStyle).toHaveAttribute("open", "");

    await page.goto(`/?round8=${viewport.width}-league#league`);
    await expect(page.locator("#analysis-journey")).toHaveCount(0);
    await expect(page.locator("#league [data-league-tab]")).toHaveCount(3);

    await page.goto(`/?round8=${viewport.width}-power#power`);
    await expect(page.locator("#power-state-note")).toBeVisible();
    await expect(page.locator("#power-visuals")).toBeHidden();
    const powerRanking = page.locator("#power-ranking-details");
    await expect(powerRanking).not.toHaveAttribute("open", "");
    if (viewport.width === 375) {
      const cards = page.locator("#power-tracked .metric");
      await expect(cards).toHaveCount(4);
      const tops = await cards.evaluateAll(items => items.slice(0, 2).map(item => Math.round(item.getBoundingClientRect().top)));
      expect(tops[0]).toBe(tops[1]);
    }
    await powerRanking.locator("summary").click();
    await expect(powerRanking).toHaveAttribute("open", "");
    await expect(page.locator("#power-table table")).toBeVisible();

    await page.goto(`/?round8=${viewport.width}-compare#compare`);
    await expect(page.locator("#team-comparison-edge")).toBeVisible();
    const comparisonEvidence = page.locator("#compare-teams .comparison-evidence");
    await expect(comparisonEvidence).not.toHaveAttribute("open", "");
    await comparisonEvidence.locator("summary").click();
    await expect(comparisonEvidence).toHaveAttribute("open", "");
    await expect(page.locator("#team-comparison-chart")).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `Explore routes at ${viewport.width}px`).toBe(true);
  }
});

test("utility routes reveal detailed evidence only when requested", async ({ page }) => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 1024, height: 820 }]) {
    await page.setViewportSize(viewport);

    await page.goto(`/?round7=${viewport.width}-guide#guide`);
    await expect(page.locator("#guide .guide-category-button")).toHaveCount(8);
    await expect(page.locator("#guide .guide-results")).toBeHidden();
    await page.locator("#guide .guide-category-button").first().click();
    await expect(page.locator("#guide .guide-results")).toBeVisible();
    expect(await page.locator("#guide .guide-deep-dive").count()).toBeGreaterThan(0);

    await page.goto(`/?round7=${viewport.width}-status#status`);
    await expect(page.locator("#status .source-status-panel")).not.toHaveAttribute("open", "");
    await expect(page.locator("#status-coverage-panel")).not.toHaveAttribute("open", "");
    await expect(page.locator("#nst-refresh-centre")).not.toHaveAttribute("open", "");
    await expect(page.locator("#nst-refresh-badge")).toHaveText("No action needed");
    await page.locator("#open-nst-refresh").click();
    await expect(page.locator("#nst-refresh-centre")).toHaveAttribute("open", "");

    await page.goto(`/?newsView=cap-centre&round7=${viewport.width}#news`);
    await expect(page.locator("#cap-centre")).toHaveClass(/active/);
    await expect(page.locator('#news [data-filter-page="news"]')).toBeHidden();
    expect(await page.locator("#news .news-subnav button").evaluateAll(buttons => buttons.every((button, index) => !buttons[index + 1] || button.getBoundingClientRect().right <= buttons[index + 1].getBoundingClientRect().left + 1))).toBe(true);
    expect(await page.locator("#cap-timeline .cap-event").count()).toBeLessThanOrEqual(10);
    const capToggle=page.locator("#cap-timeline-toggle");
    await expect(capToggle).toHaveAttribute("aria-expanded", "false");
    await capToggle.click();
    await expect(capToggle).toHaveAttribute("aria-expanded", "true");
    expect(await page.locator("#cap-timeline .cap-event").count()).toBeGreaterThan(10);

    await page.goto(`/?newsView=rumours&round7=${viewport.width}#news`);
    await expect(page.locator("#insider-posts")).not.toHaveAttribute("open", "");
    await expect(page.locator('script#x-widgets[src*="platform.twitter.com"]')).toHaveCount(0);
    await page.locator("#insider-posts summary").click();
    await expect(page.locator("#insider-posts")).toHaveAttribute("open", "");
    await expect(page.locator('script#x-widgets[src*="platform.twitter.com"]')).toHaveCount(1);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `utility routes at ${viewport.width}px`).toBe(true);
  }
});

test("principal and redesigned journeys have no serious automated accessibility violations", async ({ page }) => {
  test.setTimeout(180_000);
  for (const route of ["dashboard", "tonight", "schedule", "games", "teams", "players", "league", "compare", "power", "watchlist", "news", "guide", "status", "policies"]) {
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
