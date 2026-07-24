import {test,expect} from "@playwright/test";

const resources=page=>page.evaluate(()=>performance.getEntriesByType("resource").map(entry=>({name:new URL(entry.name).pathname,bytes:entry.decodedBodySize||entry.transferSize||0,duration:entry.duration,initiatorType:entry.initiatorType})));

test("Home mobile LCP remains within 2.5 seconds",async({page})=>{
  await page.addInitScript(()=>{window.__lcp=0;new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__lcp=Math.max(window.__lcp,entry.startTime)}).observe({type:"largest-contentful-paint",buffered:true})});
  await page.goto("/");
  await expect(page.locator("#home-tonight-title")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>window.__lcp)).toBeLessThanOrEqual(2500);
});

test("Tonight uses the lightweight runtime and core data only",async({page})=>{
  await page.goto("/#tonight");
  await expect(page.locator("#tonight")).toHaveClass(/active/);
  const rows=await resources(page),names=rows.map(row=>row.name);
  expect(names).toContain("/data/tracker-core.json");
  expect(names).not.toContain("/data/tracker.json");
  expect(names).not.toContain("/app.js");
  await page.evaluate(()=>window.dispatchEvent(new WheelEvent("wheel",{deltaY:240})));
  await page.waitForTimeout(100);
  expect((await resources(page)).map(row=>row.name)).not.toContain("/app.js");
  const javascript=rows.filter(row=>row.name.endsWith(".js")).reduce((sum,row)=>sum+row.bytes,0);
  expect(javascript).toBeLessThanOrEqual(438000);
});

test("Game Centre transfers at least 40 percent less route data",async({page})=>{
  await page.goto("/#games");
  await expect(page.locator("#games")).toHaveClass(/active/);
  const rows=await resources(page),data=rows.filter(row=>/\/data\/tracker-(core|schedule|analytics|manifest)\.json$/.test(row.name)).reduce((sum,row)=>sum+row.bytes,0);
  expect(rows.map(row=>row.name)).not.toContain("/data/tracker.json");
  expect(rows.map(row=>row.name)).not.toContain("/data/tracker-players.json");
  expect(data).toBeLessThanOrEqual(1554682);
});

test("Season transfers at least 40 percent less route data",async({page})=>{
  await page.goto("/#schedule");
  await expect(page.locator("#schedule")).toHaveClass(/active/);
  const rows=await resources(page),data=rows.filter(row=>/\/data\/tracker-(core|schedule|manifest)\.json$/.test(row.name)).reduce((sum,row)=>sum+row.bytes,0);
  expect(rows.map(row=>row.name)).not.toContain("/data/tracker.json");
  expect(data).toBeLessThanOrEqual(1554682);
});

test("player profile loads player capabilities without unused chart code",async({page})=>{
  await page.goto("/#players");
  await expect(page.locator("#players")).toHaveClass(/active/);
  let rows=await resources(page);
  expect(rows.map(row=>row.name)).not.toContain("/data/tracker.json");
  expect(rows.map(row=>row.name)).not.toContain("/data/tracker-schedule.json");
  expect(rows.map(row=>row.name)).not.toContain("/vendor/plotly-2.35.2.min.js");
});

test("the first analytical chart records bounded script work",async({page})=>{
  await page.goto("/#league");
  await expect(page.locator("#league")).toHaveClass(/active/);
  await page.locator("#league-chart").click({position:{x:10,y:10}});
  await expect.poll(async()=> (await resources(page)).some(row=>row.name==="/vendor/plotly-2.35.2.min.js"),{timeout:15000}).toBe(true);
  await expect(page.locator("#league-chart")).toHaveAttribute("role",/img|status/,{timeout:15000});
  const rows=await resources(page),parseProxy=rows.filter(row=>row.name.endsWith(".js")).reduce((sum,row)=>sum+row.duration,0);
  expect(parseProxy).toBeLessThan(5000);
});
