import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const EVIDENCE_SEASON = "20252026";
const CURRENT_SEASON = "20262027";
const COMPATIBLE_SEASON = "20242025";
const PLAYERS = Object.freeze({
  svechnikov: { id: "8480830", name: "Andrei Svechnikov", team: "CAR" },
  jarvis: { id: "8482093", name: "Seth Jarvis", team: "CAR" },
  nikishin: { id: "8482100", name: "Alexander Nikishin", team: "CAR" },
  slavin: { id: "8476958", name: "Jaccob Slavin", team: "CAR" },
  tuch: { id: "8477949", name: "Alex Tuch", team: "BUF" },
  bussi: { id: "8483548", name: "Brandon Bussi", team: "CAR" },
  lyon: { id: "8479312", name: "Alex Lyon", team: "BUF" },
  quillan: { id: "8484901", name: "Jacob Quillan", team: "TOR" },
  matthews: { id: "8479318", name: "Auston Matthews", team: "TOR" },
  rosen: { id: "8482765", name: "Isak Rosen", team: "BUF" },
  nadeau: { id: "8484203", name: "Bradly Nadeau", team: "CAR" },
});

const EVIDENCE_SECTIONS = [
  "#player-comparison-summary",
  "#player-comparison-impact-evidence",
  "#player-comparison-process-evidence",
  "#player-comparison-form-evidence",
  "#player-comparison-context-evidence",
];

const COMPARISON_OUTPUTS = [
  "#player-comparison-chart",
  "#player-comparison-table",
  "#player-comparison-process-chart",
  "#player-comparison-scoring-chart",
  "#player-comparison-process-table",
  "#player-comparison-form-chart",
  "#player-comparison-form-a",
  "#player-comparison-form-b",
  "#player-comparison-neighbours",
  "#player-comparison-method",
  "#player-comparison-components",
  "#player-comparison-impact-note",
  "#player-comparison-process-note",
  "#player-comparison-form-note",
];

function comparisonUrl(first, second, season = EVIDENCE_SEASON) {
  const params = new URLSearchParams({
    view: "players",
    comparisonSeason: season,
    a: first.id,
    b: second.id,
    aTeam: first.team,
    bTeam: second.team,
    aScope: "all",
    bScope: "all",
  });
  return `/?${params.toString()}#compare`;
}

async function expectComparisonReady(page, first, second, season = EVIDENCE_SEASON) {
  await expect(page.locator("#compare")).toHaveClass(/active/, { timeout: 30_000 });
  await expect(page.locator("#compare-players")).toHaveClass(/active/, { timeout: 30_000 });
  await expect(page.locator("#player-comparison-season")).toHaveValue(season);
  await expect(page.locator("#player-compare-a")).toHaveValue(first.id, { timeout: 30_000 });
  await expect(page.locator("#player-compare-b")).toHaveValue(second.id, { timeout: 30_000 });
  await expect(page.locator("#compare-players")).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });

  const summary = page.locator("#player-comparison-summary");
  await expect(summary).toContainText(first.name, { timeout: 30_000 });
  await expect(summary).toContainText(second.name);
  for (const selector of EVIDENCE_SECTIONS) await expect(page.locator(selector)).toBeAttached();
  for (const selector of COMPARISON_OUTPUTS) await expect(page.locator(selector)).toBeAttached();
}

async function openComparison(page, first, second) {
  await page.goto(comparisonUrl(first, second));
  await expectComparisonReady(page, first, second);
}

async function choosePlayer(page, side, player) {
  const team = page.locator(`#player-compare-team-${side}`);
  const select = page.locator(`#player-compare-${side}`);
  await team.selectOption(player.team);
  await expect(select.locator(`option[value="${player.id}"]`)).toHaveCount(1, { timeout: 30_000 });
  await select.selectOption(player.id);
  await expect(select).toHaveValue(player.id);
  await expect(page.locator("#player-comparison-summary")).toContainText(player.name);
}

async function revealComparisonEvidence(page) {
  await page.locator("#compare-players details").evaluateAll(details => {
    details.forEach(detail => { detail.open = true; });
  });
}

async function expectPlot(page, selector) {
  const chart = page.locator(selector);
  await chart.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await expect(chart).toHaveClass(/js-plotly-plot/, { timeout: 30_000 });
}

async function expectContainedViewport(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const escaped = EVIDENCE_SECTIONS.join(",");
  const boxes = await page.locator(escaped).evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width };
  }));
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(-1);
    expect(box.right).toBeLessThanOrEqual(391);
    expect(box.width).toBeGreaterThan(0);
  }
}

async function routeCompatibleEvidenceSeason(page) {
  await page.route(/\/data\/seasons\/index\.json(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.seasons.push({
      season: COMPATIBLE_SEASON,
      label: "2024–25",
      current: false,
      updatedAt: data.seasons.find(row => row.season === EVIDENCE_SEASON)?.updatedAt,
    });
    await route.fulfill({ response, json: data });
  });
  await page.route(new RegExp(`/data/seasons/${COMPATIBLE_SEASON}\\.json(?:\\?.*)?$`), async route => {
    const archiveUrl = new URL(`/data/seasons/${EVIDENCE_SEASON}.json`, route.request().url()).toString();
    const response = await route.fetch({ url: archiveUrl });
    const data = await response.json();
    data.meta = { ...data.meta, season: COMPATIBLE_SEASON };
    await route.fulfill({ response, json: data });
  });
}

test.describe("complete player comparison", () => {
  test.beforeEach(({}, testInfo) => testInfo.setTimeout(90_000));

  test("same-team and cross-team forwards retain every evidence chapter", async ({ page }) => {
    await openComparison(page, PLAYERS.svechnikov, PLAYERS.jarvis);
    await revealComparisonEvidence(page);

    const summary = page.locator("#player-comparison-summary");
    await expect(summary).toContainText(/Forwards|Forward/i);
    await expect(summary).toContainText(/79\s*GP/i);
    await expect(summary).toContainText(/71\s*GP/i);
    await expect(page.locator("#player-comparison-components")).not.toBeEmpty();
    await expect(page.locator("#player-comparison-table table")).toBeAttached();
    await expect(page.locator("#player-comparison-process-table table")).toBeAttached();
    await expectPlot(page, "#player-comparison-chart");
    const impactChart = await page.locator("#player-comparison-chart").evaluate(chart => ({
      names: (chart.data || []).filter(trace => trace.showlegend !== false).map(trace => trace.name),
      series: (chart.data || []).filter(trace => trace.showlegend !== false).map(trace => ({
        name: trace.name,
        colour: trace.marker?.color || trace.line?.color || null,
        symbol: trace.marker?.symbol || null,
      })),
      range: chart._fullLayout?.xaxis?.range || chart.layout?.xaxis?.range || [],
      hover: (chart.data || []).map(trace => trace.hovertemplate || "").join(" "),
    }));
    expect(impactChart.names).toEqual(expect.arrayContaining([PLAYERS.svechnikov.name, PLAYERS.jarvis.name]));
    const primarySeries = impactChart.series.filter(series => [PLAYERS.svechnikov.name, PLAYERS.jarvis.name].includes(series.name));
    expect(primarySeries).toHaveLength(2);
    expect(new Set(primarySeries.map(series => JSON.stringify([series.colour, series.symbol]))).size).toBe(2);
    expect(impactChart.range[0]).toBeLessThanOrEqual(0);
    expect(impactChart.range[1]).toBeGreaterThanOrEqual(100);
    expect(impactChart.hover).toMatch(/Actual:/i);
    await expectPlot(page, "#player-comparison-process-chart");
    await expectPlot(page, "#player-comparison-scoring-chart");
    await expectPlot(page, "#player-comparison-form-chart");
    await expect(page.locator("#player-comparison-form-a table")).toBeAttached();
    await expect(page.locator("#player-comparison-form-b table")).toBeAttached();
    await expect(page.locator("#player-comparison-neighbours")).not.toBeEmpty();
    await expect(page.locator("#player-comparison-method")).toContainText(/2025.26|Natural Stat Trick|NHL/i);
    const svechnikovRow = page.locator("#player-comparison-table tbody tr").filter({ hasText: PLAYERS.svechnikov.name });
    const jarvisRow = page.locator("#player-comparison-table tbody tr").filter({ hasText: PLAYERS.jarvis.name });
    await expect(svechnikovRow.getByRole("cell").nth(2)).toHaveText("R");
    await expect(jarvisRow.getByRole("cell").nth(2)).toHaveText("C");
    await expect(svechnikovRow.getByRole("cell").nth(3)).toHaveText("Forwards");
    await expect(jarvisRow.getByRole("cell").nth(3)).toHaveText("Forwards");
    await expect(page.locator("#player-comparison-impact-note")).toContainText(/same forwards peer group/i);

    await choosePlayer(page, "b", PLAYERS.tuch);
    await expect(summary).toContainText(PLAYERS.svechnikov.name);
    await expect(summary).toContainText(PLAYERS.tuch.name);
    await expect(page.locator("#player-comparison-context-evidence")).toContainText(/CAR|Carolina/);
    await expect(page.locator("#player-comparison-context-evidence")).toContainText(/BUF|Buffalo/);
    await expect.poll(() => new URL(page.url()).searchParams.get("bTeam")).toBe("BUF");
    await expect.poll(() => new URL(page.url()).searchParams.get("b")).toBe(PLAYERS.tuch.id);
  });

  test("forward-defenceman context is explicit and two defencemen use defensive peers", async ({ page }) => {
    await openComparison(page, PLAYERS.svechnikov, PLAYERS.nikishin);
    const context = page.locator("#player-comparison-context-evidence");
    await expect(context).toContainText(/Forward/i);
    await expect(context).toContainText(/Defenceman|Defencemen/i);
    await expect(context).toContainText(/position|peer group|not directly comparable|context/i);
    await expectPlot(page, "#player-comparison-chart");

    await choosePlayer(page, "a", PLAYERS.slavin);
    const summary = page.locator("#player-comparison-summary");
    await expect(summary).toContainText(PLAYERS.slavin.name);
    await expect(summary).toContainText(PLAYERS.nikishin.name);
    await expect(context).toContainText(/Defencemen/i);
    await expect(context).not.toContainText(/Forward versus defenceman|different positions cannot/i);
  });

  test("two goalies receive goalie evidence without skater-only labels", async ({ page }) => {
    await openComparison(page, PLAYERS.bussi, PLAYERS.lyon);
    await revealComparisonEvidence(page);

    const evidence = page.locator([
      "#player-comparison-summary",
      "#player-comparison-impact-evidence",
      "#player-comparison-process-evidence",
      "#player-comparison-form-evidence",
      "#player-comparison-context-evidence",
    ].join(","));
    await expect(page.locator("#player-comparison-impact-evidence")).toContainText(/Save percentage|Goals saved/i);
    await expect(page.locator("#player-comparison-process-evidence")).toContainText(/High-danger|shot danger|Goals-against/i);
    const text = (await evidence.allTextContents()).join(" ");
    expect(text).not.toMatch(/Primary points|Points per 60|Individual expected goals|Rush attempts|Takeaways|Penalty impact/i);
    await expect(page.locator("#player-comparison-table")).toContainText("0.906");
    await expect(page.locator("#player-comparison-table")).toContainText("0.915");
    await expectPlot(page, "#player-comparison-chart");
  });

  test("a skater and goalie retain identity evidence without a false shared scale", async ({ page }) => {
    await openComparison(page, PLAYERS.svechnikov, PLAYERS.bussi);
    await revealComparisonEvidence(page);

    await expect(page.locator("#player-comparison-impact-note")).toContainText(/Comparison withheld|different evidence models/i);
    await expect(page.locator("#player-comparison-process-note")).toContainText(/Incompatible source fields|two skaters or two goalies/i);
    const matrix = page.locator("#player-comparison-table");
    const skaterRow = matrix.locator("tbody tr").filter({ hasText: PLAYERS.svechnikov.name });
    const goalieRow = matrix.locator("tbody tr").filter({ hasText: PLAYERS.bussi.name });
    await expect(skaterRow).toContainText(/Skater.*Forwards/i);
    await expect(goalieRow).toContainText(/Goalie.*Goalies/i);
    await expect(page.locator("#player-comparison-chart .chart-empty")).toBeVisible();
    await expect(page.locator("#player-comparison-chart.js-plotly-plot")).toHaveCount(0);
    await expect(page.locator("#player-comparison-form-a table")).toBeAttached();
    await expect(page.locator("#player-comparison-form-b table")).toBeAttached();
    await expect(page.locator("#player-comparison-method")).toContainText(/cannot be placed on a common scale honestly/i);
  });

  test("an empty current season does not borrow archive evidence and an archive failure can retry", async ({ page }) => {
    let archiveRequests = 0;
    await page.route(/\/data\/seasons\/20252026-evidence\.json(?:\?.*)?$/, async route => {
      archiveRequests += 1;
      if (archiveRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"temporary comparison fixture failure"}',
        });
        return;
      }
      await route.continue();
    });

    await page.goto(comparisonUrl(PLAYERS.svechnikov, PLAYERS.jarvis, CURRENT_SEASON));
    await expect(page.locator("#compare-players")).toHaveClass(/active/, { timeout: 30_000 });
    await expect(page.locator("#player-comparison-season")).toHaveValue(CURRENT_SEASON);
    await expect(page.locator("#player-comparison-summary")).toContainText(/No player statistics are available for 2026.27/i, { timeout: 30_000 });
    await expect(page.locator("#player-comparison-impact-note")).toContainText(/no published player evidence.*no archived season is borrowed automatically/i);
    await expect(page.locator("#player-compare-a")).toBeDisabled();
    await expect(page.locator("#player-compare-b")).toBeDisabled();
    await expect(page.locator("#player-comparison-summary")).not.toContainText(PLAYERS.svechnikov.name);

    await page.goto(comparisonUrl(PLAYERS.svechnikov, PLAYERS.jarvis));
    const summary = page.locator("#player-comparison-summary");
    await expect(summary).toContainText(/Comparison evidence unavailable/i, { timeout: 30_000 });
    await expect(page.locator("#player-comparison-impact-note")).toContainText(/Evidence request failed/i);
    const retry = summary.getByRole("button", { name: "Retry season evidence" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expectComparisonReady(page, PLAYERS.svechnikov, PLAYERS.jarvis);
    expect(archiveRequests).toBeGreaterThanOrEqual(2);
  });

  test("a historical participant absent from the current roster remains season-selectable", async ({ page }) => {
    await openComparison(page, PLAYERS.nadeau, PLAYERS.svechnikov);

    await expect(page.locator(`#player-compare-a option[value="${PLAYERS.nadeau.id}"]`)).toContainText(/Bradly Nadeau.*Small sample/i);
    await expect(page.locator("#player-comparison-summary")).toContainText(/Bradly Nadeau.*12 GP.*134 5v5 min/i);
    await expect(page.locator("#player-comparison-impact-note")).toContainText(/200-minute|sample|withheld/i);
    await expect(page.locator("#player-comparison-method")).toContainText(/Evidence season2025.26/i);
    await expect.poll(() => new URL(page.url()).searchParams.get("comparisonSeason")).toBe(EVIDENCE_SEASON);
    await expect.poll(() => new URL(page.url()).searchParams.get("a")).toBe(PLAYERS.nadeau.id);
  });

  test("a low-sample player keeps exact evidence while percentiles are withheld", async ({ page }) => {
    await openComparison(page, PLAYERS.quillan, PLAYERS.matthews);

    const summary = page.locator("#player-comparison-summary");
    await expect(summary).toContainText(/23\s*GP/i);
    await expect(summary).toContainText(/199(?:\.3)?\s*(?:(?:five-on-five|5v5)\s*)?(?:minutes|min)/i);
    await expect(page.locator("#player-comparison-impact-note")).toContainText(/200.*minute|small sample|not eligible|percentile.*withheld/i);
    await expect(page.locator("#player-comparison-table")).toContainText(PLAYERS.quillan.name);
    const exactRow = page.locator("#player-comparison-table tbody tr").filter({ hasText: PLAYERS.quillan.name });
    await expect(exactRow.getByRole("cell").nth(7)).toHaveText("3");
    await expect(page.locator("#player-comparison-chart .chart-empty")).toBeVisible();
    await expect(page.locator("#player-comparison-chart.js-plotly-plot")).toHaveCount(0);
  });

  test("traded-player selection is labelled as combined All teams evidence", async ({ page }) => {
    await openComparison(page, PLAYERS.rosen, PLAYERS.tuch);

    await expect(page.locator(`#player-compare-a option[value="${PLAYERS.rosen.id}"]`)).toContainText("All teams");
    await expect(page.locator("#player-comparison-summary")).toContainText(/All teams/i);
    await expect(page.locator("#player-comparison-context-evidence")).toContainText(/BUF\s*[\/]\s*WPG|BUF.*WPG/i);
    await expect(page.locator("#player-comparison-table")).toContainText(/All teams/i);
    const tradedRow = page.locator("#player-comparison-table tbody tr").filter({ hasText: PLAYERS.rosen.name });
    await expect(tradedRow.getByRole("cell").nth(4)).toHaveText("37");
    await expect(tradedRow.getByRole("cell").nth(8)).toHaveText("361");
  });

  test("duplicate direct selections are repaired and announced", async ({ page }) => {
    await page.goto(comparisonUrl(PLAYERS.svechnikov, PLAYERS.svechnikov));
    await expect(page.locator("#compare-players")).toHaveClass(/active/, { timeout: 30_000 });
    await expect(page.locator("#player-comparison-summary")).toContainText(PLAYERS.svechnikov.name, { timeout: 30_000 });

    await expect.poll(async () => {
      const values = await Promise.all([
        page.locator("#player-compare-a").inputValue(),
        page.locator("#player-compare-b").inputValue(),
      ]);
      return new Set(values).size;
    }).toBe(2);
    await expect(page.locator("#player-comparison-announcer")).toContainText(/already selected|duplicate|replaced|reset/i);
    const duplicateOption = page.locator(`#player-compare-b option[value="${PLAYERS.svechnikov.id}"]`);
    expect(await duplicateOption.count() === 0 || await duplicateOption.evaluate(option => option.disabled)).toBe(true);
    await expect.poll(() => {
      const url = new URL(page.url());
      return url.searchParams.get("a") !== url.searchParams.get("b");
    }).toBe(true);
  });

  test("missing source fields render as an em dash rather than a genuine zero", async ({ page }) => {
    await page.route(/\/data\/seasons\/20252026-evidence\.json(?:\?.*)?$/, async route => {
      const response = await route.fetch();
      const data = await response.json();
      const player = data.naturalStatTrick.players.find(row => String(row.id) === PLAYERS.svechnikov.id);
      player.ixg = null;
      await route.fulfill({ response, json: data });
    });
    await openComparison(page, PLAYERS.svechnikov, PLAYERS.jarvis);
    await revealComparisonEvidence(page);

    const row = page.locator("#player-comparison-process-table tbody tr")
      .filter({ hasText: PLAYERS.svechnikov.name });
    await expect(row).toBeAttached();
    const cells = row.getByRole("cell");
    await expect(cells.nth(3)).toHaveText("—");
    await expect(cells.nth(3)).not.toHaveText(/^-?0(?:\.0+)?$/);
    await expect(page.locator("#player-comparison-process-note")).toContainText(/missing|unavailable|partial/i);
  });

  test("season changes preserve compatible player identities and team scopes", async ({ page }) => {
    await routeCompatibleEvidenceSeason(page);
    await openComparison(page, PLAYERS.svechnikov, PLAYERS.tuch);

    await page.locator("#player-comparison-season").selectOption(COMPATIBLE_SEASON);
    await expectComparisonReady(page, PLAYERS.svechnikov, PLAYERS.tuch, COMPATIBLE_SEASON);
    await expect(page.locator("#player-compare-team-a")).toHaveValue(PLAYERS.svechnikov.team);
    await expect(page.locator("#player-compare-team-b")).toHaveValue(PLAYERS.tuch.team);
    await expect.poll(() => {
      const url = new URL(page.url());
      return {
        season: url.searchParams.get("comparisonSeason"),
        first: url.searchParams.get("a"),
        second: url.searchParams.get("b"),
        firstTeam: url.searchParams.get("aTeam"),
        secondTeam: url.searchParams.get("bTeam"),
      };
    }).toEqual({
      season: COMPATIBLE_SEASON,
      first: PLAYERS.svechnikov.id,
      second: PLAYERS.tuch.id,
      firstTeam: PLAYERS.svechnikov.team,
      secondTeam: PLAYERS.tuch.team,
    });
  });

  test("saved Player Compare views restore exact context before asynchronous activation", async ({ page }) => {
    await routeCompatibleEvidenceSeason(page);
    await openComparison(page, PLAYERS.svechnikov, PLAYERS.jarvis);

    const savedView = {
      id: "saved-player-compare-regression",
      signature: "saved-player-compare-regression",
      chart: "player-comparison-chart",
      title: "Slavin vs Tuch",
      detail: "2024–25 · Carolina Hurricanes · Buffalo Sabres",
      page: "compare",
      filters: {
        "player-comparison-season": COMPATIBLE_SEASON,
        "player-compare-team-a": PLAYERS.slavin.team,
        "player-compare-team-b": PLAYERS.tuch.team,
        "player-compare-a": PLAYERS.slavin.id,
        "player-compare-b": PLAYERS.tuch.id,
      },
      context: { compareTab: "compare-players" },
      savedAt: "2026-07-26T20:00:00.000Z",
    };
    await page.evaluate(view => {
      localStorage.setItem("nhl-saved-analysis-views-v1", JSON.stringify([view]));
    }, savedView);

    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await expect(page.locator("#watchlist")).toHaveClass(/active/, { timeout: 30_000 });
    const openSaved = page.locator(`[data-open-saved-view="${savedView.id}"]`);
    await expect(openSaved).toBeVisible({ timeout: 30_000 });
    await openSaved.click();

    await expectComparisonReady(page, PLAYERS.slavin, PLAYERS.tuch, COMPATIBLE_SEASON);
    await expect(page.locator("#player-compare-team-a")).toHaveValue(PLAYERS.slavin.team);
    await expect(page.locator("#player-compare-team-b")).toHaveValue(PLAYERS.tuch.team);
  });

  test("nullable Impact and goalie evidence never fabricates zero values or ranks", async ({ page }) => {
    await page.route(/\/data\/seasons\/20252026-evidence\.json(?:\?.*)?$/, async route => {
      const response = await route.fetch();
      const data = await response.json();
      const skater = data.naturalStatTrick.players.find(row => String(row.id) === PLAYERS.svechnikov.id);
      const moneyPuckGoalie = data.moneypuck.goalies.find(row => String(row.id) === PLAYERS.bussi.id);
      const naturalStatTrickGoalie = data.naturalStatTrick.goalies.find(row => String(row.id) === PLAYERS.bussi.id);
      skater.ixg = null;
      moneyPuckGoalie.gsax = null;
      moneyPuckGoalie.savePct = null;
      naturalStatTrickGoalie.gsaa = null;
      naturalStatTrickGoalie.savePct = null;
      naturalStatTrickGoalie.hdSavePct = null;
      await route.fulfill({ response, json: data });
    });

    await page.goto(`/?team=${PLAYERS.svechnikov.team}&player=${PLAYERS.svechnikov.id}&section=player-advanced#players`);
    await expect(page.locator("#player-impact-hero")).toContainText(/Impact evidence incomplete/i, { timeout: 30_000 });
    await expect(page.locator("#player-impact-hero .impact-score")).toHaveText("—");
    await expect(page.locator("#player-impact-hero")).not.toContainText(/#0|0\s+Impact|0th percentile/i);

    await page.locator('[data-section-tab="player-goalies"]').click();
    await expect(page.locator(`#goalie-select option[value="${PLAYERS.bussi.id}"]`)).toHaveCount(1, { timeout: 30_000 });
    await page.locator("#goalie-select").selectOption(PLAYERS.bussi.id);
    const leagueRank = page.locator("#goalie-cards .metric").filter({ hasText: "League rank" });
    const gsax = page.locator("#goalie-cards .metric").filter({ hasText: /^GSAx/ });
    await expect(leagueRank.locator(".value")).toHaveText("—");
    await expect(gsax.locator(".value")).toHaveText("—");

    const nstCards = page.locator("#goalie-nst-cards");
    await expect(nstCards.locator(".metric").filter({ hasText: "Five-on-five save %" }).locator(".value")).toHaveText("—");
    await expect(nstCards.locator(".metric").filter({ hasText: "Goals saved above average" }).locator(".value")).toHaveText("—");
    await expect(nstCards.locator(".metric").filter({ hasText: "High-danger save %" }).locator(".value")).toHaveText("—");
    await expect(nstCards).not.toContainText(/#0\b|0\.000|[+−-]?0\.0\b/);
  });

  test("shared URLs survive refresh and browser back-forward navigation", async ({ page }) => {
    await page.goto("/#dashboard");
    const sharedUrl = comparisonUrl(PLAYERS.svechnikov, PLAYERS.tuch);
    await page.goto(sharedUrl);
    await expectComparisonReady(page, PLAYERS.svechnikov, PLAYERS.tuch);

    await page.reload();
    await expectComparisonReady(page, PLAYERS.svechnikov, PLAYERS.tuch);
    await page.goBack();
    await expect(page.locator("#dashboard")).toHaveClass(/active/, { timeout: 30_000 });
    await page.goForward();
    await expectComparisonReady(page, PLAYERS.svechnikov, PLAYERS.tuch);
    await expect.poll(() => {
      const url = new URL(page.url());
      return {
        route: url.hash,
        season: url.searchParams.get("comparisonSeason"),
        first: url.searchParams.get("a"),
        second: url.searchParams.get("b"),
      };
    }).toEqual({
      route: "#compare",
      season: EVIDENCE_SEASON,
      first: PLAYERS.svechnikov.id,
      second: PLAYERS.tuch.id,
    });
  });

  test("390px comparison is contained, keyboard focused and valid in both themes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("nhl-theme");
      localStorage.removeItem("nhl-last-route-v1");
    });
    await openComparison(page, PLAYERS.svechnikov, PLAYERS.jarvis);
    await expectContainedViewport(page);

    await page.locator("#player-comparison-season").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#player-compare-team-a")).toBeFocused();
    const focus = await page.locator("#player-compare-team-a").evaluate(element => {
      const style = getComputedStyle(element);
      return {
        visible: element.matches(":focus-visible"),
        outline: Number.parseFloat(style.outlineWidth),
        shadow: style.boxShadow,
      };
    });
    expect(focus.visible).toBe(true);
    expect(focus.outline > 0 || focus.shadow !== "none").toBe(true);

    const light = await page.locator("#player-comparison-summary").evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, colour: style.color };
    });
    await page.getByRole("button", { name: "Switch colour theme", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const dark = await page.locator("#player-comparison-summary").evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, colour: style.color };
    });
    expect(dark).not.toEqual(light);
    await expect(page.locator("#player-comparison-summary")).toContainText(PLAYERS.svechnikov.name);
    await expect(page.locator("#player-comparison-summary")).toContainText(PLAYERS.jarvis.name);
    await expectContainedViewport(page);
  });

  test("tablet chapters support keyboard navigation and expanded comparison accessibility", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openComparison(page, PLAYERS.svechnikov, PLAYERS.jarvis);

    const processJump = page.locator('[data-comparison-jump="player-comparison-process-evidence"]');
    await processJump.focus();
    await page.keyboard.press("Enter");
    await expect(processJump).toHaveAttribute("aria-current", "true");
    await expect(page.locator("#player-comparison-process-evidence")).toHaveAttribute("open", "");
    await expect(page.locator("#player-comparison-process-evidence summary")).toBeFocused();

    await revealComparisonEvidence(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    const results = await new AxeBuilder({ page }).include("#compare-players").analyze();
    expect(results.violations.filter(violation => ["serious", "critical"].includes(violation.impact))).toEqual([]);
  });
});
