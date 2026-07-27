"use strict";
(()=>{
  const VERSION="7.40.0";
  const QUICK_PAGES=new Set(["tonight","games","schedule"]);
  const QUICK_SCRIPTS=["data-contracts.min.js","data-loader.min.js","route-loader.min.js","cloudflare-live.min.js","route-app.min.js"];
  const FULL_SCRIPTS=["statistics.min.js","data-contracts.min.js","data-loader.min.js","router.min.js","route-loader.min.js","preferences.min.js","live-updates.min.js","observability.min.js","cloudflare-live.min.js","url-safety.min.js","app.min.js"];
  const FULL_STYLES=[{"name":"full-routes.min.css","version":VERSION}];
  let quick=null,full=null,styles=null;
  const requests=new Map(),prefetched=new Set();
  const seasonLabel=value=>{const season=String(value||"");return season.length===8?`${season.slice(0,4)}–${season.slice(6)}`:"Current season"};
  const dateLabel=value=>{const date=new Date(value);return isNaN(date)?"Latest artifact":date.toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})};
  const g=window.NHLTrackerGameState;
  const gameLabel=game=>g.normalizeGameState(game||{}).label;
  const reportLoadFailure=(label,error)=>{
    const offline=!navigator.onLine,message=offline
      ?`${label} needs a connection the first time it is opened. Core routes remain available offline.`
      :`${label} could not load. Check your connection and retry.`;
    document.getElementById("updated").textContent=offline?"Offline · stored routes available":`${label} unavailable`;
    const status=document.getElementById("route-status");
    if(status){status.textContent=message;status.hidden=false}
    const announcer=document.getElementById("route-announcer");
    if(announcer)announcer.textContent=message;
    console.error(error);
  };
  const loadScript=name=>{
    if(requests.has(name))return requests.get(name);
    const request=new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=`${name}?v=${VERSION}`;script.async=false;script.onload=resolve;script.onerror=()=>reject(new Error(`${name} could not load`));document.body.appendChild(script)}).catch(error=>{requests.delete(name);throw error});
    requests.set(name,request);return request;
  };
  const loadScripts=names=>Promise.all(names.map(loadScript)).then(()=>{});
  const loadCompleteStyles=()=>{
    if(styles)return styles;
    const links=FULL_STYLES.map(asset=>{const link=document.createElement("link");link.rel="preload";link.as="style";link.href=`${asset.name}?v=${asset.version}`;return link});
    styles=Promise.all(links.map((link,index)=>new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=()=>reject(new Error(`${FULL_STYLES[index].name} could not load`));document.head.appendChild(link)}))).then(()=>{for(const link of links){link.rel="stylesheet";link.removeAttribute("as");link.media="all"}}).catch(error=>{for(const link of links)link.remove();styles=null;throw error});
    return styles;
  };
  const canPrefetch=()=>{const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;return navigator.onLine!==false&&!connection?.saveData&&!/^(slow-)?2g$/.test(connection?.effectiveType||"")};
  const prefetchCompleteApp=()=>{
    if(!canPrefetch())return false;
    for(const name of FULL_SCRIPTS){
      if(requests.has(name)||prefetched.has(name))continue;
      const link=document.createElement("link");link.rel="prefetch";link.as="script";link.href=`${name}?v=${VERSION}`;document.head.appendChild(link);prefetched.add(name);
    }
    return true;
  };
  const loadCompleteApp=target=>{
    if(target&&document.getElementById(target))history.replaceState(null,"",`${location.pathname}${location.search}#${target}`);
    if(full)return full;
    document.getElementById("updated").textContent="Opening full tracker…";
    full=loadCompleteStyles().then(()=>loadScripts(FULL_SCRIPTS)).catch(error=>{full=null;reportLoadFailure("Full tracker",error);throw error});return full;
  };
  const loadFullApp=target=>{if(target&&QUICK_PAGES.has(target)&&!full&&!new URLSearchParams(location.search).has("season")){if(!quick){window.NHLTrackerQuickTarget=target;document.getElementById("updated").textContent="Opening tracker…";quick=loadScripts(QUICK_SCRIPTS).catch(error=>{quick=null;reportLoadFailure("Tracker",error);throw error})}return quick.then(()=>window.NHLTrackerQuickRoutes?.ready).then(()=>window.NHLTrackerQuickRoutes?.open(target))}return loadCompleteApp(target)};
  const requestLoad=target=>{void loadFullApp(target).catch(()=>{})};
  const bindLoadIntent=(button,target)=>{
    const handle=()=>{void loadFullApp(typeof target==="function"?target():target).then(()=>button.removeEventListener("click",handle)).catch(()=>{})};
    button.addEventListener("click",handle);
  };
  window.NHLTrackerLoadFullApp=loadFullApp;
  window.NHLTrackerLoadCompleteApp=loadCompleteApp;
  window.NHLTrackerLoadCompleteStyles=loadCompleteStyles;
  window.NHLTrackerPrefetchCompleteApp=prefetchCompleteApp;
  window.NHLTrackerLoadScript=loadScript;

  const renderSnapshot=summary=>{const html=summary.snapshotHtml;if(html)for(const id in html)document.getElementById(id).innerHTML=html[id];const ready=loadScript("home-snapshot.min.js").then(()=>window.NHLTrackerHomeSnapshot[html?"attach":"render"](summary,{open:requestLoad})).catch(()=>{});return html?0:ready};

  const renderHome=summary=>{
    const season=seasonLabel(summary.season),updated=dateLabel(summary.dataGeneratedAt),games=summary.daily?.games||[],slate=g.describeSlateWindow({games,slateDate:summary.daily?.currentDate||summary.daily?.slateDate});
    document.getElementById("home-dossier-season").textContent=season;
    document.getElementById("home-dossier-updated").textContent=`Updated ${updated.split(",")[0]}`;
    document.getElementById("dashboard-season-label").textContent=season;
    window.NHLTrackerFreshnessStatus?.render({status:"static",snapshotAt:summary.dataGeneratedAt});
    document.getElementById("today-date").textContent=slate.dateText;
    const host=document.getElementById("today-games");
    host.textContent="";
    const snapshot=renderSnapshot(summary);
    if(summary.watchNext)return host.ariaBusy=!1,snapshot;
    if(slate.notice){const context=document.createElement("p");context.className="notice home-slate-notice";context.textContent=slate.code==="offseason-next"?"Offseason · next published slate · UK time":slate.notice;host.appendChild(context)}
    if(!games.length){const notice=document.createElement("p");notice.className="notice";notice.textContent="No games are published in the current NHL window.";host.appendChild(notice);return snapshot}
    games.slice(0,6).forEach(game=>{
      const button=document.createElement("button");button.type="button";button.className="game-link";
      const clubs=document.createElement("strong");clubs.textContent=`${game.away} at ${game.home}`;
      const detail=document.createElement("span");detail.textContent=gameLabel(game);
      button.append(clubs,detail);bindLoadIntent(button,"games");host.appendChild(button);
    });
    return host.ariaBusy=!1,snapshot;
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
  const homeController=new AbortController(),homeTimeout=setTimeout(()=>homeController.abort(),4000);
  fetch("data/home.json",{cache:"no-store",signal:homeController.signal}).then(response=>response.ok?response.json():Promise.reject(new Error("Home unavailable"))).then(renderHome).then(settleHome).catch(()=>{
    document.getElementById("updated").textContent="Unavailable";
    document.getElementById("today-games").textContent="Open the full tracker to retry NHL data.";
    settleHome();
  }).finally(()=>clearTimeout(homeTimeout));
  fetch("data/seasons/index.json",{cache:"no-store"}).then(response=>response.ok?response.json():Promise.reject(new Error("Season list unavailable"))).then(renderSeasonPicker).catch(()=>{
    const select=document.getElementById("season-select");
    if(select)select.firstElementChild.textContent="Current season";
  });
  if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").then(registration=>registration.update()).catch(()=>{});

  document.querySelectorAll("#nav [data-default-page]").forEach(button=>bindLoadIntent(button,()=>button.dataset.defaultPage));
  document.querySelectorAll("[data-page],[data-home-page]").forEach(button=>bindLoadIntent(button,()=>button.dataset.page||button.dataset.homePage));
  document.querySelectorAll("#edit-home,[data-module-move],[data-module-hide]").forEach(button=>bindLoadIntent(button,"dashboard"));
  for(const id of ["theme-button","global-search-button"]){const button=document.getElementById(id);if(!button)continue;const handle=()=>{
    window.NHLTrackerPendingAction=id;
    void loadCompleteApp().then(()=>button.removeEventListener("click",handle)).catch(()=>{});
  };button.addEventListener("click",handle)}
  if(location.hash&&location.hash!=="#dashboard"||location.search)requestLoad(location.hash.slice(1)||null);
})();
