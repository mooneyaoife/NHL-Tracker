import {test,expect} from "@playwright/test";

test("installed Home, Tonight and Schedule survive offline",async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,serviceWorkers:"allow"});
  const page=await context.newPage();
  await page.goto("/");
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;if(!registration.active)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}))});
  const cached=await page.evaluate(async()=>{
    const names=await caches.keys(),active=names.find(name=>name.includes("7.35.0")),keys=active?await (await caches.open(active)).keys():[];
    return keys.map(request=>new URL(request.url).pathname);
  });
  expect(cached).toContain("/data/home.json");
  expect(cached).toContain("/data/tracker-core.json");
  expect(cached).toContain("/data/tracker-schedule.json");
  expect(cached).toContain("/core-routes.css");
  expect(cached).not.toContain("/design-system.css");
  expect(cached).not.toContain("/app.js");
  expect((await page.evaluate(()=>caches.keys())).filter(name=>name.startsWith("nhl-tracker-"))).toEqual(["nhl-tracker-7.35.0"]);
  await page.goto("about:blank");
  await page.goto("/#tonight");
  await expect(page.locator("#tonight")).toHaveClass(/active/);
  await context.setOffline(true);
  await page.reload({waitUntil:"domcontentloaded"});
  await expect(page.locator("#tonight")).toHaveClass(/active/);
  await expect(page.locator("#tonight-summary")).not.toBeEmpty();
  await page.goto("about:blank");
  await page.goto("/#schedule",{waitUntil:"domcontentloaded"});
  await expect(page.locator("#schedule")).toHaveClass(/active/);
  await expect(page.locator("#calendar-list")).not.toBeEmpty();
  await context.setOffline(false);
  await context.close();
});

test("an uncached deep route fails visibly while dependable routes remain available",async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,serviceWorkers:"block"});
  const page=await context.newPage();
  await page.addInitScript(()=>Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>false}));
  await page.route(/\/app\.js(?:\?|$)/,route=>route.abort("internetdisconnected"));
  await page.goto("/#teams",{waitUntil:"domcontentloaded"});
  await expect(page.locator("#route-status")).toBeVisible();
  await expect(page.locator("#route-status")).toContainText("needs a connection the first time");
  await expect(page.locator("#today-games")).not.toBeEmpty();
  await page.unroute(/\/app\.js(?:\?|$)/);
  await page.locator('[data-default-page="teams"]').click();
  await expect(page.locator("#teams")).toHaveClass(/active/);
  await context.close();
});

test("lightweight routes label deferred analytical content",async({page})=>{
  await page.goto("/#schedule");
  await expect(page.locator("#schedule-intelligence-status")).toContainText("load interactive analytical charts");
  await page.goto("about:blank");
  await page.goto("/#games");
  await expect(page.locator("#game-detail")).toContainText("Detailed charts and live play-by-play load on demand");
});
