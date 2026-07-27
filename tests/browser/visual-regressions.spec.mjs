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

async function expectDirectChildToFillContent(parent, selector = ":scope > .notice") {
  const layout = await parent.evaluate((element, childSelector) => {
    const child = element.querySelector(childSelector);
    if (!child) return null;
    const host = element.getBoundingClientRect();
    const item = child.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const contentLeft = host.left + Number.parseFloat(styles.borderLeftWidth) + Number.parseFloat(styles.paddingLeft);
    const contentRight = host.right - Number.parseFloat(styles.borderRightWidth) - Number.parseFloat(styles.paddingRight);
    const contentWidth = contentRight - contentLeft;
    return {
      leftGap: Math.abs(item.left - contentLeft),
      rightGap: Math.abs(contentRight - item.right),
      widthRatio: contentWidth ? item.width / contentWidth : 0,
    };
  }, selector);
  expect(layout).not.toBeNull();
  expect(layout.leftGap).toBeLessThanOrEqual(2);
  expect(layout.rightGap).toBeLessThanOrEqual(2);
  expect(layout.widthRatio).toBeGreaterThan(0.98);
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

  test("hydrated Home replaces the lightweight standings snapshot with one chart", async ({ page }) => {
    await page.goto("/");
    const performance = page.locator("#dashboard-points");
    await expect(performance.locator(":scope > .rank-row")).toHaveCount(4);

    await page.getByRole("button", { name: "Tonight", exact: true }).click();
    await expect(page.locator("#tonight")).toHaveClass(/active/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.locator("#dashboard")).toHaveClass(/active/, { timeout: 15_000 });
    await performance.scrollIntoViewIfNeeded();

    await expect(performance).toHaveClass(/\bjs-plotly-plot\b/, { timeout: 15_000 });
    await expect(performance).not.toHaveClass(/\bhome-snapshot-list\b/);
    await expect(performance.locator(":scope > .rank-row")).toHaveCount(0);
    await expect(performance.locator(":scope > .plot-container")).toHaveCount(1);
    await expect(performance).not.toHaveAttribute("role", "list");
  });

  test("Schedule active section keeps WCAG text contrast in dark mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nhl-theme", "dark"));
    await page.goto("/#schedule");
    await expect(page.locator("#schedule")).toHaveClass(/active/, { timeout: 15_000 });
    const active = page.locator('#schedule-chapter-nav button[aria-pressed="true"]');
    await expect(active).toBeVisible();

    const ratios = await active.evaluate(element => {
      const channel = value => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const rgb = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = value => {
        const [red, green, blue] = rgb(value).map(channel);
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const background = getComputedStyle(element).backgroundColor;
      return [element, element.querySelector("strong"), element.querySelector("small")].map(node => {
        const light = Math.max(luminance(getComputedStyle(node).color), luminance(background));
        const dark = Math.min(luminance(getComputedStyle(node).color), luminance(background));
        return (light + 0.05) / (dark + 0.05);
      });
    });
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });

  test("Lineups preserves the full long team name at 1024 pixels", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.goto("/?availabilityTeam=BUF#availability");
    await expect(page.locator("#availability")).toHaveClass(/active/, { timeout: 15_000 });
    const opponent = page.locator("#availability-next .availability-matchup h3", { hasText: "Pittsburgh Penguins" });
    await expect(opponent).toHaveText("Pittsburgh Penguins");
    const presentation = await opponent.evaluate(element => {
      const styles = getComputedStyle(element);
      return {
        horizontalOverflow: element.scrollWidth - element.clientWidth,
        verticalOverflow: element.scrollHeight - element.clientHeight,
        textOverflow: styles.textOverflow,
        whiteSpace: styles.whiteSpace,
      };
    });
    expect(presentation.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(presentation.verticalOverflow).toBeLessThanOrEqual(1);
    expect(presentation.textOverflow).not.toBe("ellipsis");
    expect(presentation.whiteSpace).not.toBe("nowrap");
  });

  test("offseason Trends notice spans the story row", async ({ page }) => {
    await page.goto("/#trends");
    await expect(page.locator("#trends")).toHaveClass(/active/, { timeout: 15_000 });
    const stories = page.locator("#trend-stories");
    await expect(stories.locator(":scope > .notice")).toBeVisible();
    await expectDirectChildToFillContent(stories);
  });

  test("Team Compare and Game Centre fallback notices span their content", async ({ page }) => {
    await page.goto("/#compare");
    await expect(page.locator("#compare")).toHaveClass(/active/, { timeout: 15_000 });
    const comparison = page.locator("#team-comparison-edge");
    await expect(comparison.locator(":scope > .notice")).toBeVisible();
    await expectDirectChildToFillContent(comparison);

    await page.goto("/?game=9999999999#games");
    await expect(page.locator("#games")).toHaveClass(/active/, { timeout: 15_000 });
    const game = page.locator("#game-detail");
    await expect(game.locator(":scope > .notice")).toBeVisible({ timeout: 15_000 });
    await expectDirectChildToFillContent(game);
  });

  test("Season evidence stays visible and contained at the reported tablet width", async ({ page }) => {
    await page.setViewportSize({ width: 757, height: 1000 });
    await page.goto("/");
    await expect(page.locator("#dashboard")).toHaveClass(/active/, { timeout: 15_000 });
    const cards = page.locator("#season-state-stage .season-state-teams article");
    await expect(cards).toHaveCount(4, { timeout: 15_000 });
    await expect.poll(() => cards.evaluateAll(elements => elements.every(element => Number(getComputedStyle(element).opacity) > 0.95))).toBe(true);

    const layout = await page.evaluate(() => {
      const season = document.querySelector(".season-file").getBoundingClientRect();
      const body = document.querySelector(".season-file-body").getBoundingClientRect();
      const nav = document.querySelector(".season-state-nav");
      const stage = document.querySelector(".season-state-stage").getBoundingClientRect();
      const buttons = [...nav.querySelectorAll("button")].map(button => ({
        top: button.getBoundingClientRect().top,
        contained: button.scrollWidth <= button.clientWidth + 1,
      }));
      return {
        bodyHeight: body.height,
        navContained: nav.scrollWidth <= nav.clientWidth + 1,
        oneRow: Math.max(...buttons.map(button => button.top)) - Math.min(...buttons.map(button => button.top)) < 2,
        labelsContained: buttons.every(button => button.contained),
        stageContained: stage.left >= season.left - 1 && stage.right <= season.right + 1,
        documentContained: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    });
    expect(layout.bodyHeight).toBeLessThan(620);
    expect(layout.navContained).toBe(true);
    expect(layout.oneRow).toBe(true);
    expect(layout.labelsContained).toBe(true);
    expect(layout.stageContained).toBe(true);
    expect(layout.documentContained).toBe(true);
  });

  test("League tabs divide the full local rail into three equal destinations", async ({ page }) => {
    await page.goto("/?leagueView=league-overview#league");
    await expect(page.locator("#league")).toHaveClass(/active/, { timeout: 15_000 });
    const tabs = page.locator("#league .league-subnav button");
    await expect(tabs).toHaveCount(3);
    const layout = await page.locator("#league .league-subnav").evaluate(element => {
      const rail = element.getBoundingClientRect();
      const buttons = [...element.querySelectorAll("button")].map(button => button.getBoundingClientRect());
      return {
        leadingGap: buttons[0].left - rail.left,
        trailingGap: rail.right - buttons.at(-1).right,
        widthSpread: Math.max(...buttons.map(button => button.width)) - Math.min(...buttons.map(button => button.width)),
        contained: element.scrollWidth <= element.clientWidth + 1,
      };
    });
    expect(Math.abs(layout.leadingGap)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.trailingGap)).toBeLessThanOrEqual(2);
    expect(layout.widthSpread).toBeLessThanOrEqual(2);
    expect(layout.contained).toBe(true);
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

  test("Workspace preferences use balanced cards without an ink gutter", async ({ page }) => {
    await page.goto("/?workspaceChapter=workspace-preferences#watchlist");
    await expect(page.locator("#watchlist")).toHaveClass(/active/, { timeout: 15_000 });
    await expect(page.locator("#workspace-preferences")).toBeVisible();
    const visual = await page.locator("#workspace-preferences .workspace-preference-grid").evaluate(element => {
      const panels = [...element.children].map(panel => panel.getBoundingClientRect());
      const header = document.querySelector("#watchlist .workspace-command").getBoundingClientRect();
      return {
        gap: panels[1].left - panels[0].right,
        heightDifference: Math.abs(panels[0].height - panels[1].height),
        background: getComputedStyle(element).backgroundColor,
        headerHeight: header.height,
      };
    });
    expect(visual.gap).toBeGreaterThanOrEqual(10);
    expect(visual.gap).toBeLessThanOrEqual(18);
    expect(visual.heightDifference).toBeLessThanOrEqual(3);
    expect(visual.background).toBe("rgba(0, 0, 0, 0)");
    expect(visual.headerHeight).toBeLessThanOrEqual(112);
  });

  test("Data Status keeps closed evidence compact and separates the lower grid", async ({ page }) => {
    await page.goto("/#status");
    await expect(page.locator("#status")).toHaveClass(/active/, { timeout: 15_000 });
    await expect(page.locator("#status .source-status-panel")).not.toHaveAttribute("open", "");
    await expect(page.locator("#status-coverage-panel")).not.toHaveAttribute("open", "");
    await expect(page.locator("#status-rollover-panel")).not.toHaveAttribute("open", "");
    const visual = await page.evaluate(() => {
      const source = document.querySelector("#status .source-status-panel").getBoundingClientRect();
      const coverage = document.querySelector("#status-coverage-panel").getBoundingClientRect();
      const rollover = document.querySelector("#status-rollover-panel").getBoundingClientRect();
      const refresh = document.querySelector("#nst-refresh-centre").getBoundingClientRect();
      const evidence = document.querySelector("#status .status-evidence-grid").getBoundingClientRect();
      const sectionGap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--section-gap"));
      return {
        sourceHeight: source.height,
        coverageHeight: coverage.height,
        rolloverHeight: rollover.height,
        evidenceGap: evidence.top - refresh.bottom,
        sectionGap,
        scrollMargin: Number.parseFloat(getComputedStyle(document.querySelector("#status-coverage-panel")).scrollMarginTop),
      };
    });
    expect(visual.sourceHeight).toBeLessThanOrEqual(76);
    expect(visual.coverageHeight).toBeLessThanOrEqual(76);
    expect(visual.rolloverHeight).toBeLessThanOrEqual(76);
    expect(Math.abs(visual.rolloverHeight - visual.coverageHeight)).toBeLessThanOrEqual(1);
    expect(visual.evidenceGap).toBeGreaterThanOrEqual(16);
    expect(visual.evidenceGap).toBeLessThanOrEqual(visual.sectionGap + 2);
    expect(visual.scrollMargin).toBeGreaterThan(50);
  });

  test("Workspace chapter rail clears the global context rail on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/?workspaceChapter=workspace-teams#watchlist");
    await expect(page.locator("#workspace-teams")).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => window.scrollTo(0, 520));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const rails = await page.evaluate(() => {
      const context = document.querySelector(".context-nav").getBoundingClientRect();
      const workspace = document.querySelector("#workspace-chapter-nav").getBoundingClientRect();
      return {
        contextBottom: context.bottom,
        workspaceTop: workspace.top,
        documentContained: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    });
    expect(rails.workspaceTop).toBeGreaterThanOrEqual(rails.contextBottom - 1);
    expect(rails.documentContained).toBe(true);
  });
});
