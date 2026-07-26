"use strict";
(()=>{
  const VERSION="7.35.0";
  const QUICK_PAGES=new Set(["tonight","games","schedule"]);
  const QUICK_SCRIPTS=["data-contracts.js","data-loader.js","route-loader.js","cloudflare-live.js","route-app.js"];
  const FULL_SCRIPTS=["statistics.js","data-contracts.js","data-loader.js","router.js","route-loader.js","preferences.js","live-updates.js","observability.js","cloudflare-live.js","url-safety.js","app.js"];
  const FULL_STYLES=[{"name":"styles.css","version":"6.0.0"},{"name":"theme-569.css","version":"6.0.0"},{"name":"design-system.css","version":VERSION}];
  let quickLoading=null,fullLoading=null,fullStylesLoading=null;
  const scriptRequests=new Map(),prefetchedScripts=new Set();
  const seasonLabel=value=>{const season=String(value||"");return season.length===8?`${season.slice(0,4)}–${season.slice(6)}`:"Current season"};
  const dateLabel=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}):"Latest artifact"};
  const gameState=window.NHLTrackerGameState;
  const gameLabel=game=>gameState.normalizeGameState(game||{}).label;
  const reportLoadFailure=(label,error)=>{
    const offline=!navigator.onLine,message=offline
      ?`${label} needs a connection the first time it is opened. Home, Tonight and Schedule remain available offline.`
      :`${label} could not finish loading. Check your connection and try again.`;
    document.getElementById("updated").textContent=offline?"Offline · stored routes available":`${label} unavailable`;
    const status=document.getElementById("route-status");
    if(status){status.textContent=message;status.hidden=false}
    const announcer=document.getElementById("route-announcer");
    if(announcer)announcer.textContent=message;
    console.error(error);
  };
  const loadScript=name=>{
    if(scriptRequests.has(name))return scriptRequests.get(name);
    const request=new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=`${name}?v=${VERSION}`;script.async=false;script.onload=resolve;script.onerror=()=>reject(new Error(`${name} could not load`));document.body.appendChild(script)}).catch(error=>{scriptRequests.delete(name);throw error});
    scriptRequests.set(name,request);return request;
  };
  const loadScripts=names=>Promise.all(names.map(loadScript)).then(()=>{});
  const loadCompleteStyles=()=>{
    if(fullStylesLoading)return fullStylesLoading;
    const links=FULL_STYLES.map(asset=>{const link=document.createElement("link");link.rel="preload";link.as="style";link.href=`${asset.name}?v=${asset.version}`;return link});
    fullStylesLoading=Promise.all(links.map((link,index)=>new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=()=>reject(new Error(`${FULL_STYLES[index].name} could not load`));document.head.appendChild(link)}))).then(()=>{for(const link of links){link.rel="stylesheet";link.removeAttribute("as");link.media="all"}}).catch(error=>{for(const link of links)link.remove();fullStylesLoading=null;throw error});
    return fullStylesLoading;
  };
  const canPrefetch=()=>{const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;return navigator.onLine!==false&&!connection?.saveData&&!/^(slow-)?2g$/.test(connection?.effectiveType||"")};
  const prefetchCompleteApp=()=>{
    if(!canPrefetch())return false;
    for(const name of FULL_SCRIPTS){
      if(scriptRequests.has(name)||prefetchedScripts.has(name))continue;
      const link=document.createElement("link");link.rel="preload";link.as="script";link.href=`${name}?v=${VERSION}`;document.head.appendChild(link);prefetchedScripts.add(name);
    }
    return true;
  };
  const loadCompleteApp=target=>{
    if(target&&document.getElementById(target))history.replaceState(null,"",`${location.pathname}${location.search}#${target}`);
    if(fullLoading)return fullLoading;
    document.getElementById("updated").textContent="Opening full tracker…";
    fullLoading=loadCompleteStyles().then(()=>loadScripts(FULL_SCRIPTS)).catch(error=>{fullLoading=null;reportLoadFailure("Full tracker",error);throw error});return fullLoading;
  };
  const loadFullApp=target=>{if(target&&QUICK_PAGES.has(target)&&!fullLoading){if(target&&document.getElementById(target))history.replaceState(null,"",`${location.pathname}${location.search}#${target}`);if(!quickLoading){document.getElementById("updated").textContent="Opening tracker…";quickLoading=loadScripts(QUICK_SCRIPTS).catch(error=>{quickLoading=null;reportLoadFailure("Tracker",error);throw error})}return quickLoading.then(()=>window.NHLTrackerQuickRoutes?.ready).then(()=>window.NHLTrackerQuickRoutes?.open(target))}return loadCompleteApp(target)};
  const requestLoad=target=>{void loadFullApp(target).catch(()=>{})};
  const bindLoadIntent=(button,target)=>{
    const handle=()=>{void loadFullApp(typeof target==="function"?target():target).then(()=>button.removeEventListener("click",handle)).catch(()=>{})};
    button.addEventListener("click",handle);
  };
  window.NHLTrackerLoadFullApp=loadFullApp;
  window.NHLTrackerLoadCompleteApp=loadCompleteApp;
  window.NHLTrackerLoadCompleteStyles=loadCompleteStyles;
  window.NHLTrackerPrefetchCompleteApp=prefetchCompleteApp;

  const renderHome=summary=>{
    const season=seasonLabel(summary.season),updated=dateLabel(summary.dataGeneratedAt),games=summary.daily?.games||[],teams=summary.teams||{},slate=gameState.describeSlateWindow({games,slateDate:summary.daily?.currentDate||summary.daily?.slateDate});
    document.getElementById("home-dossier-season").textContent=season;
    document.getElementById("home-dossier-updated").textContent=`Updated ${updated.split(",")[0]}`;
    document.getElementById("dashboard-season-label").textContent=season;
    window.NHLTrackerFreshnessStatus?.render({status:"static",snapshotAt:summary.dataGeneratedAt});
    document.getElementById("today-date").textContent=slate.dateText;
    const host=document.getElementById("today-games");
    host.replaceChildren();
    if(slate.notice){const context=document.createElement("p");context.className="notice home-slate-notice";context.textContent=slate.notice;host.appendChild(context)}
    if(!games.length){const notice=document.createElement("p");notice.className="notice";notice.textContent="No games are published in the current NHL window.";host.appendChild(notice);return}
    games.slice(0,6).forEach(game=>{
      const button=document.createElement("button");button.type="button";button.className="game-link";
      const clubs=document.createElement("strong");clubs.textContent=`${teams[game.away]||game.away} at ${teams[game.home]||game.home}`;
      const detail=document.createElement("span");detail.textContent=gameLabel(game);
      button.append(clubs,detail);bindLoadIntent(button,"games");host.appendChild(button);
    });
  };

  const openSeason=(season,current)=>{
    const url=new URL(location.href);
    if(season===current)url.searchParams.delete("season");
    else url.searchParams.set("season",season);
    location.href=url.toString();
  };
  const renderSeasonPicker=manifest=>{
    const select=document.getElementById("season-select"),entries=Array.isArray(manifest?.seasons)?manifest.seasons:[];
    if(!select||!entries.length)return;
    const requested=new URLSearchParams(location.search).get("season"),selected=entries.some(row=>row.season===requested)?requested:manifest.current||entries[0].season;
    select.replaceChildren(...entries.map(row=>{
      const option=document.createElement("option");
      option.value=row.season;
      option.textContent=`${row.label||seasonLabel(row.season)}${row.season===manifest.current?" · Current":" · Archive"}`;
      return option;
    }));
    select.value=selected;
    select.onchange=event=>openSeason(event.target.value,manifest.current);
  };

  const settleHome=()=>document.getElementById("dashboard")?.classList.remove("home-pending");
  fetch("data/home.json",{cache:"no-store"}).then(response=>response.ok?response.json():Promise.reject(new Error("Home snapshot unavailable"))).then(renderHome).then(settleHome).catch(()=>{
    document.getElementById("updated").textContent="Static snapshot unavailable";
    document.getElementById("today-games").textContent="Open the full tracker to retry NHL data.";
    settleHome();
  });
  fetch("data/seasons/index.json",{cache:"no-store"}).then(response=>response.ok?response.json():Promise.reject(new Error("Season list unavailable"))).then(renderSeasonPicker).catch(()=>{
    const select=document.getElementById("season-select");
    if(select)select.firstElementChild.textContent="Current season";
  });
  if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});

  document.querySelectorAll("#nav [data-default-page]").forEach(button=>bindLoadIntent(button,()=>button.dataset.defaultPage));
  document.querySelectorAll("[data-page],[data-home-page]").forEach(button=>bindLoadIntent(button,()=>button.dataset.page||button.dataset.homePage));
  for(const id of ["theme-button","global-search-button"]){const button=document.getElementById(id);if(!button)continue;const handle=()=>{
    window.NHLTrackerPendingAction=id;
    void loadCompleteApp().then(()=>button.removeEventListener("click",handle)).catch(()=>{});
  };button.addEventListener("click",handle)}
  if(location.hash&&location.hash!=="#dashboard"||location.search)requestLoad(location.hash.slice(1)||null);
})();
