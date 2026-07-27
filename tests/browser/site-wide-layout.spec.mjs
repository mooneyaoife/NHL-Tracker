import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { width: 320, height: 760 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 820 },
  { width: 1440, height: 900 },
];

const NESTED_VIEWPORTS = [
  { width: 320, height: 760 },
  { width: 390, height: 844 },
];

const PLAYER_COMPARISON_URL = "/?layoutTheme=light&view=players&comparisonSeason=20252026&a=8480830&b=8482093&aTeam=CAR&bTeam=CAR&aScope=all&bScope=all#compare";

const ROUTES = [
  "dashboard",
  "tonight",
  "schedule",
  "games",
  "availability",
  "teams",
  "players",
  "compare",
  "league",
  "power",
  "trends",
  "playoffs",
  "news",
  "watchlist",
  "guide",
  "status",
  "policies",
];

const TAB_GROUPS = [
  "#nav",
  ".context-nav-level",
  ".page.active > .subnav",
  ".page.active > .section-subnav",
  ".page.active .game-centre-subnav",
  ".page.active .compare-subnav",
  ".page.active .league-subnav",
  ".page.active .news-subnav",
  ".page.active .analysis-hub-tabs",
  ".page.active .workspace-story-rail",
  ".page.active .schedule-story-rail",
  ".page.active .player-comparison-section-nav",
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const selectedTheme = new URL(location.href).searchParams.get("layoutTheme");
    if (["light", "dark"].includes(selectedTheme)) localStorage.setItem("nhl-theme", selectedTheme);
  });
});

async function loadCompleteApplication(page, theme, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(`/?layout-audit=${theme}-${viewport.width}&layoutTheme=${theme}#teams`);
  await expect(page.locator("#teams")).toHaveClass(/active/, { timeout: 30_000 });
  await expect(page.locator("#updated")).not.toContainText("Loading", { timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function applyAuditPresentation(page, theme, viewport) {
  await page.setViewportSize(viewport);
  await page.evaluate(nextTheme => {
    localStorage.setItem("nhl-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.waitForTimeout(40);
}

async function openRoute(page, route) {
  await page.evaluate(nextRoute => showPage(nextRoute), route);
  await expect(page.locator(`#${route}`)).toHaveClass(/active/, { timeout: 30_000 });
  await page.waitForTimeout(80);
}

async function auditVisibleGeometry(page, route, viewport, theme) {
  return page.evaluate(({ route, viewport, theme, tabGroups }) => {
    const active = document.querySelector(".page.active");
    const visible = element => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity) > 0 && box.width > 0 && box.height > 0;
    };
    const deliberateScroller = element => {
      const ancestor = element.closest(".table-wrap,.context-nav-level,.subnav,.chapter-nav,.schedule-story-rail,.workspace-story-rail,.player-comparison-section-nav,[data-layout-scroll]");
      if (!ancestor) return false;
      const style = getComputedStyle(ancestor);
      return ["auto", "scroll"].includes(style.overflowX);
    };
    const compact = element => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].slice(0, 2).map(name => `.${name}`).join("")}`;
    const textIssues = [];
    const tinyText = [];
    const roots = [document.querySelector("body>header"), document.querySelector("body>#nav"), document.querySelector(".context-nav:not([hidden])"), active].filter(Boolean);
    const candidates = roots.flatMap(root => [...root.querySelectorAll("h1,h2,h3,h4,p,li,dt,dd,label,button,summary,a,span,strong,small,em,th,td")]);
    for (const element of candidates) {
      if (!visible(element) || element.closest(".chart,svg,[hidden],.page:not(.active)")) continue;
      const directText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(" ").trim();
      if (!directText) continue;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const size = Number.parseFloat(style.fontSize);
      const intentionallyHidden = size === 0 || element.matches(".visually-hidden,.sr-only,[aria-hidden='true']") || Boolean(element.closest(".visually-hidden,.sr-only,[aria-hidden='true']"));
      if (!intentionallyHidden && size < 10) tinyText.push({ selector: compact(element), text: directText.slice(0, 70), size });
      if (deliberateScroller(element) || style.textOverflow === "ellipsis") continue;
      const clippingOverflow = ["hidden", "clip"].includes(style.overflowX);
      const clipped = element.children.length === 0 && !element.matches(".metric-help,.chart-help-button") && clippingOverflow && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2;
      const outsideViewport = box.left < -2 || box.right > innerWidth + 2;
      if (clipped || outsideViewport) textIssues.push({ selector: compact(element), text: directText.slice(0, 90), clipped, outsideViewport, width: Math.round(box.width), scrollWidth: element.scrollWidth });
    }

    const tabs = [];
    for (const selector of tabGroups) {
      for (const group of document.querySelectorAll(selector)) {
        if (!visible(group)) continue;
        const controls = [...group.querySelectorAll(":scope > button,:scope > .nav-destination > button")].filter(visible);
        if (!controls.length) continue;
        const groupStyle = getComputedStyle(group);
        const box = group.getBoundingClientRect();
        const widths = controls.map(control => Math.round(control.getBoundingClientRect().width));
        const heights = controls.map(control => Math.round(control.getBoundingClientRect().height));
        const overflow = group.scrollWidth > group.clientWidth + 1;
        const scrollable = ["auto", "scroll"].includes(groupStyle.overflowX);
        const first = controls[0].getBoundingClientRect();
        const last = controls.at(-1).getBoundingClientRect();
        const isLocalRail = selector !== "#nav" && selector !== ".context-nav-level";
        const edgeGap = viewport.width > 640 && isLocalRail && !overflow
          ? Math.max(0, Math.round(first.left - box.left), Math.round(box.right - last.right))
          : 0;
        const widthSpread = Math.round(Math.max(...widths) - Math.min(...widths));
        tabs.push({ selector, count: controls.length, widths, heights, overflow, scrollable, edgeGap, widthSpread });
      }
    }

    const title = active?.querySelector(":scope > .sheet-header h1,:scope > .sheet-header h2,:scope > .title-bar h1,:scope > .title-bar h2,h1,h2");
    const titleBox = title?.getBoundingClientRect();
    const activeBox = active?.getBoundingClientRect();
    return {
      route,
      theme,
      width: viewport.width,
      documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      title: titleBox && activeBox ? {
        selector: compact(title),
        leftInset: Math.round(titleBox.left - activeBox.left),
        top: Math.round(titleBox.top),
        size: Number.parseFloat(getComputedStyle(title).fontSize),
        family: getComputedStyle(title).fontFamily,
      } : null,
      textIssues: textIssues.slice(0, 12),
      tinyText: tinyText.slice(0, 12),
      tabs,
    };
  }, { route, viewport, theme, tabGroups: TAB_GROUPS });
}

async function railGeometry(page, selector) {
  return page.locator(selector).evaluate(group => {
    const groupBox = group.getBoundingClientRect();
    const controls = [...group.querySelectorAll(":scope > button")].filter(control => {
      const style = getComputedStyle(control);
      const box = control.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    });
    const boxes = controls.map(control => {
      const box = control.getBoundingClientRect();
      return { text: control.textContent.trim(), left: box.left, right: box.right, width: box.width, clientWidth: control.clientWidth, scrollWidth: control.scrollWidth };
    });
    const active = controls.find(control => control.matches(".active,[aria-current='page'],[aria-pressed='true']"));
    const activeBox = active?.getBoundingClientRect();
    return {
      overlaps: boxes.slice(1).map((box, index) => boxes[index].right - box.left),
      clippedLabels: boxes.filter(box => box.scrollWidth > box.clientWidth + 1).map(box => box.text),
      activeText: active?.textContent.trim() || "",
      activeVisible: Boolean(activeBox && activeBox.left >= groupBox.left - 1 && activeBox.right <= groupBox.right + 1),
      clientWidth: group.clientWidth,
      scrollWidth: group.scrollWidth,
      scrollLeft: group.scrollLeft,
    };
  });
}

test("all routes preserve readable geometry across supported widths and themes", async ({ page }) => {
  test.setTimeout(180_000);
  const findings = [];
  const passes = VIEWPORTS.flatMap(viewport => ["light", "dark"].map(theme => ({ viewport, theme })));
  await loadCompleteApplication(page, "light", VIEWPORTS[0]);
  for (const { viewport, theme } of passes) {
    await applyAuditPresentation(page, theme, viewport);
    for (const route of ROUTES) {
      await openRoute(page, route);
      findings.push(await auditVisibleGeometry(page, route, viewport, theme));
    }
  }

  const failures = [];
  for (const finding of findings) {
    const context = `${finding.route} ${finding.theme} ${finding.width}px`;
    if (finding.documentOverflow > 1) failures.push(`${context}: document overflow ${finding.documentOverflow}px`);
    for (const issue of finding.textIssues) failures.push(`${context}: text ${issue.selector} ${JSON.stringify(issue.text)} escaped or clipped`);
    for (const issue of finding.tinyText) failures.push(`${context}: ${issue.selector} ${JSON.stringify(issue.text)} rendered at ${issue.size}px`);
    for (const group of finding.tabs) {
      if (Math.min(...group.heights) < 44) failures.push(`${context}: ${group.selector} touch target ${Math.min(...group.heights)}px`);
      if (group.overflow && !group.scrollable) failures.push(`${context}: ${group.selector} overflows without scrolling`);
      if (group.edgeGap > 2) failures.push(`${context}: ${group.selector} leaves a ${group.edgeGap}px edge gap`);
      if (finding.width > 640 && group.selector !== "#nav" && group.selector !== ".context-nav-level" && !group.overflow && group.widthSpread > 3) failures.push(`${context}: ${group.selector} tab widths differ by ${group.widthSpread}px`);
    }
    if (finding.title && finding.title.size < 34) failures.push(`${context}: page title is only ${finding.title.size}px`);
  }
  const uniqueFailures = [...new Set(failures)];
  expect(uniqueFailures, uniqueFailures.slice(0, 100).join("\n")).toEqual([]);
});

test("nested mobile workspaces and tab rails preserve containment and distinct hit targets", async ({ page }) => {
  test.setTimeout(180_000);
  for (const viewport of NESTED_VIEWPORTS) {
    await loadCompleteApplication(page, "light", viewport);

    await openRoute(page, "watchlist");
    await page.evaluate(() => openWorkspaceChapter("workspace-preferences", { scroll: false }));
    await expect(page.locator("#workspace-preferences")).toBeVisible();
    const workspace = await page.locator("#workspace-preferences .workspace-preference-grid").evaluate(grid => {
      const gridBox = grid.getBoundingClientRect();
      const panels = [...grid.children].map(panel => {
        const box = panel.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      });
      const action = grid.querySelector("#workspace-edit-home").getBoundingClientRect();
      const actionPanel = grid.querySelector("#workspace-edit-home").closest(".panel").getBoundingClientRect();
      return {
        panels,
        grid: { left: gridBox.left, right: gridBox.right },
        action: { left: action.left, right: action.right },
        actionPanel: { left: actionPanel.left, right: actionPanel.right },
        documentContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      };
    });
    expect(workspace.panels, `${viewport.width}px Workspace Preferences should contain two cards`).toHaveLength(2);
    expect(workspace.panels[1].top, `${viewport.width}px Workspace Preferences should be a single column`).toBeGreaterThanOrEqual(workspace.panels[0].bottom - 1);
    for (const panel of workspace.panels) {
      expect(panel.left, `${viewport.width}px Workspace card left edge`).toBeGreaterThanOrEqual(workspace.grid.left - 1);
      expect(panel.right, `${viewport.width}px Workspace card right edge`).toBeLessThanOrEqual(workspace.grid.right + 1);
    }
    expect(workspace.action.left, `${viewport.width}px Workspace action left edge`).toBeGreaterThanOrEqual(workspace.actionPanel.left - 1);
    expect(workspace.action.right, `${viewport.width}px Workspace action right edge`).toBeLessThanOrEqual(workspace.actionPanel.right + 1);
    expect(workspace.documentContained).toBe(true);

    await openRoute(page, "players");
    await page.evaluate(() => activateSectionTab("player-goalies"));
    await expect(page.locator('[data-section-tab="player-goalies"]')).toHaveClass(/active/);
    const playerTabs = await railGeometry(page, "#players .section-subnav");
    expect(Math.max(0, ...playerTabs.overlaps), `${viewport.width}px Players tabs overlap`).toBeLessThanOrEqual(1);
    expect(playerTabs.clippedLabels, `${viewport.width}px Players tab labels clip`).toEqual([]);
    expect(playerTabs.activeText).toBe("Goalies");
    expect(playerTabs.activeVisible, `${viewport.width}px active Goalies tab is not fully visible`).toBe(true);

    await openRoute(page, "games");
    await page.evaluate(() => activateGameView("library"));
    await expect(page.locator('#games .game-centre-subnav [data-game-view="library"]')).toHaveClass(/active/);
    const gameTabs = await railGeometry(page, "#games .game-centre-subnav");
    expect(Math.max(0, ...gameTabs.overlaps), `${viewport.width}px Game Centre tabs overlap`).toBeLessThanOrEqual(1);
    expect(gameTabs.clippedLabels, `${viewport.width}px Game Centre tab labels clip`).toEqual([]);
    expect(gameTabs.activeText).toBe("Archive");
    expect(gameTabs.activeVisible, `${viewport.width}px active Archive tab is not fully visible`).toBe(true);

    for (const route of ["availability", "playoffs", "status", "policies"]) {
      await openRoute(page, route);
      await expect.poll(async () => (await railGeometry(page, ".context-nav-level")).activeVisible, {
        message: `${viewport.width}px ${route} context tab should be fully visible`,
      }).toBe(true);
    }
  }
});

test("Player Compare keeps component copy separated and a usable percentile plot at phone widths", async ({ page }) => {
  test.setTimeout(120_000);
  for (const viewport of NESTED_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(PLAYER_COMPARISON_URL);
    await expect(page.locator("#compare")).toHaveClass(/active/, { timeout: 30_000 });
    await expect(page.locator("#compare-players")).toHaveClass(/active/, { timeout: 30_000 });
    await expect(page.locator("#compare-players")).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
    await expect(page.locator("#player-comparison-components .comparison-component-row").first()).toBeVisible({ timeout: 30_000 });

    const labels = await page.locator("#player-comparison-components .comparison-component-label").evaluateAll(elements => elements.map(element => {
      const textNode = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const detail = element.querySelector("small");
      if (!textNode || !detail) return { separated: false, label: element.textContent.trim() };
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const textRects = [...range.getClientRects()];
      const textBottom = Math.max(...textRects.map(box => box.bottom));
      const detailBox = detail.getBoundingClientRect();
      return {
        label: textNode.textContent.trim(),
        separated: detailBox.top >= textBottom - 1,
        detailDisplay: getComputedStyle(detail).display,
      };
    }));
    expect(labels.length, `${viewport.width}px comparison components should render`).toBeGreaterThan(0);
    expect(labels.filter(label => !label.separated), `${viewport.width}px comparison labels run into their detail copy`).toEqual([]);

    const chart = page.locator("#player-comparison-chart");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toHaveClass(/js-plotly-plot/, { timeout: 30_000 });
    const chartGeometry = await chart.evaluate(element => {
      const ancestors = [];
      for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        ancestors.push({
          selector: `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${[...node.classList].slice(0, 3).map(name => `.${name}`).join("")}`,
          width: Math.round(box.width),
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          display: style.display,
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          gridTemplateColumns: style.gridTemplateColumns,
          paddingInline: `${style.paddingLeft}/${style.paddingRight}`,
        });
        if (node.matches("main,body")) break;
      }
      return {
        hostWidth: element.getBoundingClientRect().width,
        plotWidth: element._fullLayout?._size?.w || 0,
        leftMargin: element._fullLayout?._size?.l || 0,
        rightMargin: element._fullLayout?._size?.r || 0,
        ancestors,
      };
    });
    expect(chartGeometry.plotWidth, `${viewport.width}px percentile plot is too narrow inside ${Math.round(chartGeometry.hostWidth)}px host (margins ${chartGeometry.leftMargin}/${chartGeometry.rightMargin}); ancestors ${JSON.stringify(chartGeometry.ancestors)}`).toBeGreaterThanOrEqual(100);
  }
});
