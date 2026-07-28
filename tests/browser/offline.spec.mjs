import {test,expect} from "@playwright/test";

const HISTORICAL_PLAYER_COMPARISON="/?view=players&comparisonSeason=20252026&a=8480830&b=8482093&aTeam=CAR&bTeam=CAR&aScope=all&bScope=all#compare";

test("installed Home, Tonight and Schedule survive offline",async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,serviceWorkers:"allow"});
  const page=await context.newPage();
  await page.goto("/");
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;if(!registration.active)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}))});
  const cached=await page.evaluate(async()=>{
    const names=await caches.keys(),active=names.find(name=>name.includes("7.41.0")),keys=active?await (await caches.open(active)).keys():[];
    return keys.map(request=>new URL(request.url).pathname);
  });
  expect(cached).toContain("/data/home.json");
  expect(cached).toContain("/data/tracker-core.json");
  expect(cached).toContain("/data/tracker-calendar.json");
  expect(cached).not.toContain("/data/tracker-schedule.json");
  expect(cached).toContain("/core-routes.min.css");
  expect(cached).not.toContain("/full-routes.min.css");
  expect(cached).not.toContain("/app.min.js");
  expect((await page.evaluate(()=>caches.keys())).filter(name=>name.startsWith("nhl-tracker-"))).toEqual(["nhl-tracker-7.41.0"]);
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

test("a previously loaded historical Player Compare direct URL survives offline",async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,serviceWorkers:"allow"});
  const page=await context.newPage();
  await page.goto("/");
  await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}));
  });

  await page.goto(HISTORICAL_PLAYER_COMPARISON);
  await expect(page.locator("#compare")).toHaveClass(/active/,{timeout:30000});
  await expect(page.locator("#compare-players")).toHaveClass(/active/);
  await expect(page.locator("#player-comparison-summary")).toContainText("Andrei Svechnikov",{timeout:30000});
  await expect(page.locator("#player-comparison-summary")).toContainText("Seth Jarvis");
  await expect(page.locator("#player-comparison-table table")).toBeAttached();

  const runtimeCache=await page.evaluate(async()=>{
    const names=(await caches.keys()).filter(name=>name.startsWith("nhl-tracker-"));
    const cache=await caches.open(names.at(-1));
    return (await cache.keys()).map(request=>`${new URL(request.url).pathname}${new URL(request.url).search}`);
  });
  expect(runtimeCache.some(path=>path.startsWith("/data/seasons/20252026.json"))).toBe(true);
  expect(runtimeCache.some(path=>path.startsWith("/player-comparison.min.js"))).toBe(true);

  await page.goto("about:blank");
  await context.setOffline(true);
  await page.goto(HISTORICAL_PLAYER_COMPARISON,{waitUntil:"domcontentloaded"});
  await expect(page.locator("#compare")).toHaveClass(/active/,{timeout:30000});
  await expect(page.locator("#compare-players")).toHaveClass(/active/);
  await expect(page.locator("#player-comparison-season")).toHaveValue("20252026");
  await expect(page.locator("#player-comparison-summary")).toContainText("Andrei Svechnikov",{timeout:30000});
  await expect(page.locator("#player-comparison-summary")).toContainText("Seth Jarvis");
  await expect(page.locator("#player-comparison-table table")).toBeAttached();
  await expect(page.locator("#player-comparison-summary")).not.toContainText(/could not load|check the connection|unavailable/i);
  await expect(page.locator("#player-comparison-impact-note")).not.toContainText(/evidence request failed/i);
  expect(await page.evaluate(()=>({offline:!navigator.onLine,controlled:Boolean(navigator.serviceWorker.controller)}))).toEqual({offline:true,controlled:true});
  await context.setOffline(false);
  await context.close();
});

test("an uncached deep route fails visibly while dependable routes remain available",async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,serviceWorkers:"block"});
  const page=await context.newPage();
  await page.addInitScript(()=>Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>false}));
  await page.route(/\/app\.min\.js(?:\?|$)/,route=>route.abort("internetdisconnected"));
  await page.goto("/#teams",{waitUntil:"domcontentloaded"});
  await expect(page.locator("#route-status")).toBeVisible();
  await expect(page.locator("#route-status")).toContainText("needs a connection the first time");
  await expect(page.locator("#today-games")).not.toBeEmpty();
  await page.unroute(/\/app\.min\.js(?:\?|$)/);
  await page.locator('[data-default-page="teams"]').click();
  await expect(page.locator("#teams")).toHaveClass(/active/,{timeout:15000});
  await context.close();
});

test("lightweight routes label deferred analytical content",async({page})=>{
  await page.goto("/#schedule");
  await expect(page.locator("#schedule-intelligence-status")).toContainText("load interactive analytical charts");
  await page.goto("about:blank");
  await page.goto("/#games");
  await expect(page.locator("#game-detail")).toContainText("Detailed charts and live play-by-play load on demand");
});
