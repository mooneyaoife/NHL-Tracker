import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "allow" });
test.describe.configure({ mode: "serial" });

test("offline shell keeps Home and Tonight usable without Plotly or archives", async ({ page, context }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)).catch(() => false),
    { timeout: 15_000 }).toBe(true);
  await expect(page.locator("#updated")).not.toContainText("Loading");
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboard")).toHaveClass(/active/);
  await page.getByRole("button", { name: "Tonight", exact: true }).click();
  await expect(page.locator("#tonight")).toHaveClass(/active/);
  const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name));
  expect(resources.some(url => /plotly|seasons\/\d+\.json/.test(url))).toBe(false);
});
