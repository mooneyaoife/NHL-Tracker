import { test, expect } from "@playwright/test";

async function makeAnalyticsUnavailable(page) {
  await page.route(/\/data\/tracker-analytics\.json(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.specialTeams = [];
    body.moneypuck = {
      ...(body.moneypuck || {}),
      teams: [],
      teamGames: [],
      specialTeams: [],
      specialTeamGames: [],
      lines: [],
      simulations: [],
    };
    await route.fulfill({ response, json: body });
  });
}

async function expectCompactEmptyChart(locator) {
  await expect(locator).toHaveClass(/\bis-empty\b/);
  const height = await locator.evaluate(element => element.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(80);
  expect(height).toBeLessThanOrEqual(240);
}

test.describe("screenshot-backed desktop visual regressions", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop screenshot contract");
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  test("returning Home keeps the canonical Watch Next experience", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#today-games > :is(.watch-next-hero, .watch-next-empty)")).toBeVisible();

    await page.getByRole("button", { name: "Tonight", exact: true }).click();
    await expect(page.locator("#tonight")).toHaveClass(/active/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.locator("#dashboard")).toHaveClass(/active/, { timeout: 15_000 });
    await expect(page.locator("#team-select option")).not.toHaveCount(0, { timeout: 15_000 });

    await expect(page.locator("#today-games > :is(.watch-next-hero, .watch-next-empty)")).toBeVisible();
    await expect(page.locator("#today-games .home-matchup")).toHaveCount(0);
  });

  test("unavailable Special Teams uses a compact, full-width state", async ({ page }) => {
    await makeAnalyticsUnavailable(page);
    await page.goto("/?team=CAR&section=team-special#teams");
    await expect(page.locator("#teams")).toHaveClass(/active/, { timeout: 15_000 });

    const hero = page.locator("#special-teams-hero");
    await expect(hero).toHaveClass(/\bis-empty\b/);
    await expect(hero.locator(":scope > div")).toHaveCount(1);
    const heroLayout = await hero.evaluate(element => {
      const host = element.getBoundingClientRect();
      const copy = element.firstElementChild.getBoundingClientRect();
      return {
        height: host.height,
        copyWidthRatio: copy.width / host.width,
        columnCount: getComputedStyle(element).gridTemplateColumns.split(" ").length,
      };
    });
    expect(heroLayout.height).toBeLessThanOrEqual(260);
    expect(heroLayout.copyWidthRatio).toBeGreaterThan(0.45);
    expect(heroLayout.columnCount).toBe(1);

    const metricCoverage = await page.locator("#special-teams-metrics").evaluate(element => {
      const host = element.getBoundingClientRect();
      const cards = [...element.children].map(child => child.getBoundingClientRect());
      return {
        count: cards.length,
        widthRatio: cards.length ? (cards.at(-1).right - cards[0].left) / host.width : 0,
      };
    });
    expect(metricCoverage.count).toBe(2);
    expect(metricCoverage.widthRatio).toBeGreaterThan(0.9);
  });

  test("unavailable playoff and team evidence stays compact and contained", async ({ page }) => {
    await makeAnalyticsUnavailable(page);
    await page.goto("/?playoffTeam=BUF#playoffs");
    await expect(page.locator("#playoffs")).toHaveClass(/active/, { timeout: 15_000 });
    await expectCompactEmptyChart(page.locator("#playoff-path-chart"));

    const forecastCoverage = await page.locator("#forecast-table").evaluate(element => {
      const host = element.getBoundingClientRect();
      const notice = element.querySelector(".notice")?.getBoundingClientRect();
      return notice ? notice.width / host.width : 0;
    });
    expect(forecastCoverage).toBeGreaterThan(0.95);

    const pointsOutlook = page.locator("#playoffs details").filter({ hasText: "Points outlook" }).first();
    await expect(pointsOutlook).not.toHaveAttribute("open", "");
    await expect(pointsOutlook.locator(":scope > :not(summary)")).toBeHidden();
    await expect(pointsOutlook.locator("summary .metric-help")).toHaveCount(0);

    const remainingSchedule = page.locator("#playoffs details").filter({ hasText: "Routes and remaining schedule" }).first();
    await remainingSchedule.locator("summary").click();
    const scheduleRows = page.locator("#playoff-schedule tbody tr");
    await expect(scheduleRows.first()).toBeVisible();
    const schedulePresentation = await scheduleRows.evaluateAll(rows => rows.map(row => ({
      date: row.cells[0]?.textContent.trim() || "",
      team: row.cells[1]?.textContent.trim() || "",
      opponent: row.cells[2]?.textContent.trim() || "",
    })));
    expect(schedulePresentation.every(row => !/^\d{4}-\d{2}-\d{2}$/.test(row.date))).toBe(true);
    expect(schedulePresentation.every(row => row.team.includes(" ") && row.opponent.includes(" "))).toBe(true);
    expect(new Set(schedulePresentation.map(row => `${row.date}|${row.team}|${row.opponent}`)).size).toBe(schedulePresentation.length);

    await page.goto("/?team=CAR&section=team-advanced#teams");
    await expect(page.locator("#teams")).toHaveClass(/active/, { timeout: 15_000 });
    await expectCompactEmptyChart(page.locator("#team-shot-profile"));
    await expectCompactEmptyChart(page.locator("#team-lines-chart"));
  });

  test("Workspace uses the canonical heading and an edge-to-edge local rail", async ({ page }) => {
    await page.goto("/?workspaceChapter=workspace-saved#watchlist");
    await expect(page.locator("#watchlist")).toHaveClass(/active/, { timeout: 15_000 });

    const visual = await page.evaluate(() => {
      const rail = getComputedStyle(document.querySelector("#workspace-chapter-nav"));
      const heading = getComputedStyle(document.querySelector("#watchlist .workspace-command h2"));
      const canonical = getComputedStyle(document.querySelector("#players #player-title"));
      return {
        railPaddingLeft: Number.parseFloat(rail.paddingLeft),
        railPaddingRight: Number.parseFloat(rail.paddingRight),
        headingFamily: heading.fontFamily,
        canonicalFamily: canonical.fontFamily,
        headingWeight: Number.parseInt(heading.fontWeight, 10),
      };
    });

    expect(visual.railPaddingLeft).toBeLessThanOrEqual(0.5);
    expect(visual.railPaddingRight).toBeLessThanOrEqual(0.5);
    expect(visual.headingFamily).toBe(visual.canonicalFamily);
    expect(visual.headingWeight).toBeGreaterThanOrEqual(600);
  });
});
