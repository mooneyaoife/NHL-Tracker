import {test,expect} from "@playwright/test";

const resources=page=>page.evaluate(()=>performance.getEntriesByType("resource").map(entry=>({name:new URL(entry.name).pathname,bytes:entry.decodedBodySize||entry.transferSize||0,duration:entry.duration,initiatorType:entry.initiatorType})));

test("Home keeps a useful shell visible while its snapshot loads",async({page})=>{
  await page.route(/\/data\/home\.json(?:\?.*)?$/,async route=>{
    await new Promise(resolve=>setTimeout(resolve,1500));
    await route.continue();
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await expect(page.locator("#dashboard")).toHaveClass(/active/);
  await expect(page.locator(".home-masthead")).toBeVisible();
  await expect(page.locator("#dashboard-page-heading")).toBeVisible();
  await expect(page.locator("#season-state-stage h3")).toHaveText("Record");
  await expect(page.locator("#today-games")).not.toBeEmpty({timeout:5000});
});

test("Home mobile LCP remains within 2.5 seconds",async({page})=>{
  await page.addInitScript(()=>{window.__lcp=0;new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__lcp=Math.max(window.__lcp,entry.startTime)}).observe({type:"largest-contentful-paint",buffered:true})});
  await page.goto("/");
  await expect(page.locator("#home-tonight-title")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>window.__lcp)).toBeLessThanOrEqual(2500);
});

test("Home keeps cumulative layout shift within the good threshold",async({page})=>{
  await page.addInitScript(()=>{
    window.__cls=0;
    new PerformanceObserver(list=>{
      for(const entry of list.getEntries())if(!entry.hadRecentInput)window.__cls+=entry.value;
    }).observe({type:"layout-shift",buffered:true});
  });
  await page.goto("/");
  await expect(page.locator("#home-tonight-title")).toBeVisible();
  await page.waitForTimeout(750);
  expect(await page.evaluate(()=>window.__cls)).toBeLessThanOrEqual(0.1);
});

test("Home shell does not synchronously download the full application",async({page})=>{
  await page.goto("/");
  await expect(page.locator("#dashboard")).toHaveClass(/active/);
  await page.evaluate(()=>{
    window.dispatchEvent(new WheelEvent("wheel",{deltaY:480}));
    window.dispatchEvent(new Event("touchmove"));
    window.dispatchEvent(new KeyboardEvent("keydown",{key:"PageDown"}));
  });
  await page.waitForTimeout(150);
  const names=(await resources(page)).map(row=>row.name);
  expect(names).not.toContain("/app.js");
  expect(names).not.toContain("/game-centre.js");
  for(const stylesheet of ["/styles.css","/theme-569.css","/design-system.css"])expect(names).not.toContain(stylesheet);
});

test("Home snapshot fills its useful dashboard without a route round trip",async({page})=>{
  await page.goto("/");
  await expect(page.locator("#today-games")).not.toBeEmpty();
  await expect(page.locator("#season-state-stage")).not.toBeEmpty();
  await expect(page.locator("#recent-form")).not.toBeEmpty();
  await expect(page.locator("#dashboard-points .rank-row")).toHaveCount(4);
  await expect(page.locator("#dashboard")).toHaveClass(/active/);
  expect((await resources(page)).map(row=>row.name)).not.toContain("/app.js");
});

test("Tonight uses the lightweight runtime and core data only",async({page})=>{
  const errors=[];page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});
  await page.goto("/#tonight");
  await expect(page.locator("#tonight")).toHaveClass(/active/);
  const rows=await resources(page),names=rows.map(row=>row.name);
  expect(names).toContain("/data/tracker-core.json");
  expect(names).not.toContain("/data/tracker.json");
  expect(names).not.toContain("/app.js");
  expect(names).not.toContain("/game-centre.js");
  await page.evaluate(()=>window.dispatchEvent(new WheelEvent("wheel",{deltaY:240})));
  await page.waitForTimeout(100);
  expect((await resources(page)).map(row=>row.name)).not.toContain("/app.js");
  const javascript=rows.filter(row=>row.name.endsWith(".js")).reduce((sum,row)=>sum+row.bytes,0);
  expect(javascript).toBeLessThanOrEqual(438000);
  expect(errors.filter(message=>message.includes("Data loader must be initialised"))).toEqual([]);
});

test("Game Centre transfers at least 40 percent less route data",async({page})=>{
  await page.goto("/#games");
  await expect(page.locator("#games")).toHaveClass(/active/);
  const rows=await resources(page),data=rows.filter(row=>/\/data\/tracker-(core|manifest)\.json$/.test(row.name)).reduce((sum,row)=>sum+row.bytes,0);
  expect(rows.map(row=>row.name)).not.toContain("/data/tracker.json");
  expect(rows.map(row=>row.name)).not.toContain("/data/tracker-players.json");
  expect(rows.map(row=>row.name)).not.toContain("/data/tracker-schedule.json");
  expect(rows.map(row=>row.name)).not.toContain("/data/tracker-analytics.json");
  expect(rows.map(row=>row.name)).toContain("/game-centre.js");
  expect(data).toBeLessThanOrEqual(75000);
});

test("detailed Game Centre reuses quick-route dependencies",async({page})=>{
  await page.goto("/#games");
  await expect(page.locator("[data-open-complete-game]")).toBeVisible();
  await page.locator("[data-open-complete-game]").click();
  await expect(page.locator("#games")).toHaveClass(/active/);
  const scripts=await page.locator("script[src]").evaluateAll(nodes=>nodes.map(node=>new URL(node.src).pathname));
  for(const name of ["data-contracts.js","data-loader.js","route-loader.js","cloudflare-live.js"]){
    expect(scripts.filter(path=>path.endsWith(`/${name}`)),`${name} is executed once`).toHaveLength(1);
  }
});

test("detailed Game Centre loads deep data only for the pane that needs it",async({page})=>{
  test.slow();
  await page.route(/\/data\/seasons\/\d{8}\.json(?:\?.*)?$/,route=>route.fulfill({status:503,contentType:"application/json",body:'{"error":"archive not required for capability coverage"}'}));
  await page.goto("/#games");
  await expect(page.locator("[data-open-complete-game]")).toBeVisible();
  await page.locator("[data-open-complete-game]").click();
  await expect(page.locator('#game-browse-nav [data-game-view="library"]')).toBeVisible({timeout:45000});
  let names=(await resources(page)).map(row=>row.name);
  expect(names).toContain("/data/tracker-analytics.json");
  expect(names).not.toContain("/data/tracker-schedule.json");
  expect(names).not.toContain("/data/tracker-players.json");
  await page.locator('#game-browse-nav [data-game-view="library"]').click();
  await expect.poll(async()=> (await resources(page)).some(row=>row.name==="/data/tracker-schedule.json"),{timeout:45000}).toBe(true);
  names=(await resources(page)).map(row=>row.name);
  expect(names).not.toContain("/data/tracker-players.json");
  await page.locator('[data-game-view="intelligence"]').click();
  await expect.poll(async()=> (await resources(page)).some(row=>row.name==="/data/tracker-players.json"),{timeout:45000}).toBe(true);
});

test("detailed Game Centre defers historical matchup evidence",async({page})=>{
  test.slow();
  await page.route("**/data/seasons/index.json",route=>route.fulfill({json:{current:"20262027",seasons:[{season:"20262027",label:"2026–27",current:true},{season:"20252026",label:"2025–26",current:false}]}}));
  let historicalRequests=0;
  await page.route(/\/data\/seasons\/\d{8}\.json(?:\?.*)?$/,route=>{historicalRequests+=1;return route.fulfill({status:503,contentType:"application/json",body:'{"error":"simulated archive outage"}'})});
  await page.goto("/#games");
  await expect(page.locator("[data-open-complete-game]")).toBeVisible();
  await page.locator("[data-open-complete-game]").click();
  await expect(page.locator('#game-browse-nav [data-game-view="library"]')).toBeVisible({timeout:45000});
  expect(historicalRequests).toBe(0);
  const archivedSeasonOption=()=>page.locator("#matchup-evidence-season option").evaluateAll(options=>options.find(option=>!option.textContent.includes("Current"))?.value||"");
  await expect.poll(archivedSeasonOption,{timeout:15000}).not.toBe("");
  const archivedSeason=await archivedSeasonOption();
  await page.locator("#matchup-evidence-season").evaluate((select,value)=>{select.value=value},archivedSeason);
  await page.locator('[data-game-view="intelligence"]').click();
  await expect.poll(()=>historicalRequests,{timeout:15000}).toBe(1);
  await expect(page.locator("#matchup-intelligence-detail")).toContainText("unavailable",{timeout:15000});
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
  for(const stylesheet of ["/styles.css","/theme-569.css","/design-system.css"])expect(rows.map(row=>row.name)).toContain(stylesheet);
  const activeStyles=await page.locator('link[rel="stylesheet"]').evaluateAll(links=>links.filter(link=>["styles.css","theme-569.css","design-system.css"].some(name=>link.href.includes(name))).map(link=>({rel:link.rel,media:link.media})));
  expect(activeStyles).toEqual([{rel:"stylesheet",media:"all"},{rel:"stylesheet",media:"all"},{rel:"stylesheet",media:"all"}]);
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
