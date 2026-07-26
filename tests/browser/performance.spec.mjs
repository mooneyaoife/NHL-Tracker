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

test("Watch Next answers the league question and opens the exact Game Centre",async({page})=>{
  await page.addInitScript(()=>localStorage.removeItem("nhl-tracked-teams"));
  await page.goto("/");
  const hero=page.locator(".watch-next-hero");
  await expect(hero).toBeVisible();
  await expect(hero.locator(".section-kicker")).toHaveText("League watch");
  expect(await hero.locator(".watch-next-signal").count()).toBeGreaterThan(0);
  expect(await hero.locator(".watch-next-signal").count()).toBeLessThanOrEqual(3);
  await expect(hero).toContainText("2025–26 opponent evidence");
  await expect(hero.locator(".watch-next-method summary")).toHaveAccessibleName("How to read this brief");
  const gameId=await hero.locator("[data-watch-game]").getAttribute("data-watch-game");
  await hero.locator("[data-watch-game]").click();
  await expect(page).toHaveURL(new RegExp(`[?&]game=${gameId}.*#games$`));
  await expect(page.locator("#games")).toHaveClass(/active/);
  await expect(page.locator("#game-select")).toHaveValue(gameId);
});

test("the generated Watch Next fallback keeps exact-game links usable without its enhancement module",async({page})=>{
  await page.route(/\/home-snapshot\.js(?:\?.*)?$/,route=>route.abort("failed"));
  await page.goto("/");
  const action=page.locator(".watch-next-open");await expect(action).toBeVisible();
  const gameId=await action.getAttribute("data-watch-game");await action.click();
  await expect(page).toHaveURL(new RegExp(`[?&]game=${gameId}.*#games$`));
  await expect(page.locator("#games")).toHaveClass(/active/);
});

test("Watch Next puts locally followed teams first without loading the full app",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("nhl-tracked-teams",JSON.stringify(["SJS","MIN"])));
  await page.goto("/");
  await expect(page.locator(".watch-next-hero .section-kicker")).toHaveText("Your teams");
  await expect(page.locator("#today-date")).toContainText("2 followed teams");
  await expect(page.locator(".watch-next-hero")).toContainText(/Wild|Sharks/);
  expect((await resources(page)).map(row=>row.name)).not.toContain("/app.js");
});

test("Since last check is device-local, markable, and quiet when unchanged",async({page})=>{
  await page.goto("/");
  await page.evaluate(()=>{localStorage.removeItem("nhl-tracked-teams");for(const key of Object.keys(localStorage))if(key.startsWith("nhl-visit-"))localStorage.removeItem(key)});
  await page.reload();
  await expect(page.locator("#since-last-visit")).toBeVisible();
  await expect(page.locator("#visit-panel-note")).toContainText(/saved only on this device|future visits show only what moved/);
  await page.locator("#visit-mark-seen").click();
  await expect(page.locator("#since-last-visit")).toBeHidden();
  await page.reload();
  await expect(page.locator("#since-last-visit")).toBeHidden();
});

test("Since last check prioritises schedule, result, time, and roster changes",async({page})=>{
  const teams=["BUF","SJS","MIN","CAR"],season="20262027";
  await page.addInitScript(({teams,season})=>localStorage.setItem(`nhl-visit-${season}`,JSON.stringify({
    schema:3,season,capturedAt:"2026-07-25T12:00:00Z",teams,finished:{},
    upcoming:{rescheduled:{id:"rescheduled",away:"BUF",home:"CAR",startTimeUTC:"2026-10-01T23:00:00Z",focusTeams:["BUF","CAR"]}},
    roster:{},schedule:{activeSeason:season,complete:false,changes:{}},
  })),{teams,season});
  await page.route(/\/data\/home\.json(?:\?.*)?$/,async route=>{
    const response=await route.fetch(),body=await response.json();
    body.trackedTeams=teams;body.season=season;body.freshness={status:"fresh"};
    body.continuity={schema:3,season,capturedAt:"2026-07-26T12:00:00Z",updatedAt:"2026-07-26T12:00:00Z",
      finished:{final:{id:"final",away:"BUF",home:"CAR",awayScore:4,homeScore:2,startTimeUTC:"2026-07-26T01:00:00Z",focusTeams:["BUF","CAR"]}},
      upcoming:{rescheduled:{id:"rescheduled",away:"BUF",home:"CAR",startTimeUTC:"2026-10-02T00:00:00Z",focusTeams:["BUF","CAR"]}},
      roster:{move:{key:"move",team:"BUF",direction:"Added",name:"Alex Test",detectedAt:"2026-07-26T11:00:00Z"}},
      schedule:{activeSeason:season,complete:true,completedAt:"2026-07-26T10:00:00Z",changes:{}}};
    await route.fulfill({response,json:body});
  });
  await page.goto("/");
  const panel=page.locator("#since-last-visit");await expect(panel).toBeVisible();
  await expect(panel).toContainText("schedule is now complete");
  await expect(panel).toContainText("BUF 4–2 CAR");
  await expect(panel).toContainText("changed time");
  await expect(panel).toContainText("Alex Test · Added");
});

test("Since last check starts a new local baseline after a season change",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("nhl-visit-20252026",JSON.stringify({schema:3,season:"20252026",capturedAt:"2026-06-01T12:00:00Z",teams:["BUF"],finished:{old:{id:"old"}}})));
  await page.goto("/");
  await expect(page.locator("#since-last-visit")).toBeVisible();
  await expect(page.locator("#visit-panel-title")).toHaveText("Latest update");
  await expect(page.locator("#visit-panel-note")).toContainText("future visits show only what moved");
});

test("stale Home evidence never advances the return-visit baseline",async({page})=>{
  await page.addInitScript(()=>{for(const key of Object.keys(localStorage))if(key.startsWith("nhl-visit-"))localStorage.removeItem(key)});
  await page.route(/\/data\/home\.json(?:\?.*)?$/,async route=>{const response=await route.fetch(),body=await response.json();body.freshness={...(body.freshness||{}),status:"stale"};await route.fulfill({response,json:body})});
  await page.goto("/");
  await expect(page.locator(".watch-next-hero>footer")).toContainText("stale snapshot");
  await expect(page.locator("#since-last-visit")).toBeVisible();
  await expect(page.locator("#visit-panel-note")).toContainText("will not advance");
  await expect(page.locator("#visit-mark-seen")).toBeDisabled();
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("nhl-visit-")).length)).toBe(0);
});

test("Watch Next keeps honest sparse and archived states",async({page})=>{
  await page.route(/\/data\/home\.json(?:\?.*)?$/,async route=>{const response=await route.fetch(),body=await response.json();body.watchNext={...body.watchNext,teamBriefs:{},leagueBriefs:[]};body.snapshotHtml["today-games"]="";await route.fulfill({response,json:body})});
  await page.goto("/");
  await expect(page.locator(".watch-next-empty")).toContainText("No upcoming games in this season");
  await expect(page.locator(".watch-next-empty button")).toHaveAccessibleName("Open Schedule →");
});

test("Watch Next reflows at a 200 percent equivalent and its disclosure is keyboard operable",async({page})=>{
  await page.setViewportSize({width:720,height:450});
  await page.goto("/");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
  const summary=page.locator(".watch-next-method summary");await summary.focus();await page.keyboard.press("Enter");
  await expect(page.locator(".watch-next-method")).toHaveAttribute("open","");
  const action=page.locator(".watch-next-open");await action.focus();
  expect(await action.evaluate(node=>getComputedStyle(node).outlineStyle)).not.toBe("none");
});

test("Since last check stays useful when local storage is unavailable",async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException("Storage denied","SecurityError")}});
  await page.goto("/");
  await expect(page.locator("#since-last-visit")).toBeVisible();
  await expect(page.locator("#visit-panel-note")).toContainText("cannot save return-visit state");
  await expect(page.locator("#visit-mark-seen")).toBeDisabled();
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
  await expect(page.locator("#league-chart")).toHaveAttribute("role",/img|status|group/,{timeout:15000});
  const rows=await resources(page),parseProxy=rows.filter(row=>row.name.endsWith(".js")).reduce((sum,row)=>sum+row.duration,0);
  expect(parseProxy).toBeLessThan(5000);
});
