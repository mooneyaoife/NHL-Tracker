import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";

test("routes announce changes and search restores keyboard focus", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#updated")).not.toContainText("Loading");
  await page.getByRole("button", { name: "Tonight", exact: true }).click();
  await expect(page.locator("#tonight")).toHaveClass(/active/);
  await expect(page.locator("#route-announcer")).toContainText(/Tonight/);
  await page.locator("#global-search-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#global-search-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#global-search-button")).toBeFocused();
});

test("postponed games remain exceptional after their original start time", async ({ page }) => {
  await page.route("**/data/tracker.json", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.daily = { currentDate: "2026-01-01", games: [{ id: 2026020999, date: "2026-01-01",
      startTimeUTC: "2026-01-01T00:30:00Z", state: "POSTPONED", type: 2,
      away: "BUF", home: "BOS", awayScore: null, homeScore: null }] };
    await route.fulfill({ response, json: data });
  });
  await page.goto("/#tonight");
  await expect(page.locator("#tonight-games")).toContainText("Postponed");
  await page.getByRole("button", { name: /Open Game Centre/ }).first().click();
  await expect(page.locator("#game-select option:checked")).toContainText("Postponed");
  await expect(page.locator("#game-select option:checked")).not.toContainText("Completed");
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

test("mobile, tablet and desktop layouts avoid horizontal overflow", async ({ page }) => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
});

test("Home has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(violation => ["serious", "critical"].includes(violation.impact))).toEqual([]);
});
