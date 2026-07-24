import {test,expect} from "@playwright/test";

test("installed Home and Tonight survive offline capability migration",async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,serviceWorkers:"allow"});
  const page=await context.newPage();
  await page.goto("/");
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;if(!registration.active)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}))});
  await page.goto("about:blank");
  await page.goto("/#tonight");
  await expect(page.locator("#tonight")).toHaveClass(/active/);
  await context.setOffline(true);
  await page.reload({waitUntil:"domcontentloaded"});
  await expect(page.locator("#tonight")).toHaveClass(/active/);
  await expect(page.locator("#tonight-summary")).not.toBeEmpty();
  await context.setOffline(false);
  await context.close();
});

test("lightweight routes label deferred analytical content",async({page})=>{
  await page.goto("/#schedule");
  await expect(page.locator("#schedule-intelligence-status")).toContainText("load interactive analytical charts");
  await page.goto("about:blank");
  await page.goto("/#games");
  await expect(page.locator("#game-detail")).toContainText("Detailed charts and live play-by-play load on demand");
});
