"use strict";
(()=>{
  const VERSION="7.19.0";
  const QUICK_PAGES=new Set(["tonight","games","schedule"]);
  const QUICK_SCRIPTS=["game-state.js","data-contracts.js","data-loader.js","route-loader.js","cloudflare-live.js","route-app.js"];
  const FULL_SCRIPTS=["statistics.js","game-state.js","data-contracts.js","data-loader.js","router.js","route-loader.js","preferences.js","live-updates.js","observability.js","cloudflare-live.js","app.js"];
  let quickLoading=null,fullLoading=null;
  const seasonLabel=value=>{const season=String(value||"");return season.length===8?`${season.slice(0,4)}–${season.slice(6)}`:"Current season"};
  const dateLabel=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}):"Latest artifact"};
  const gameLabel=game=>game.status?.label||game.stateLabel||game.state||"Scheduled";
  const loadScripts=(names,label)=>new Promise((resolve,reject)=>{let remaining=names.length;for(const name of names){const script=document.createElement("script");script.src=`${name}?v=${VERSION}`;script.async=false;script.onload=()=>{remaining-=1;if(!remaining)resolve()};script.onerror=()=>reject(new Error(`${name} could not load`));document.body.appendChild(script)}}).catch(error=>{document.getElementById("updated").textContent=`${label} unavailable`;console.error(error);throw error});
  const loadCompleteApp=target=>{
    if(target&&document.getElementById(target))history.replaceState(null,"",`${location.pathname}${location.search}#${target}`);
    if(fullLoading)return fullLoading;
    document.getElementById("updated").textContent="Opening full tracker…";
    fullLoading=loadScripts(FULL_SCRIPTS,"Full tracker");return fullLoading;
  };
  const loadFullApp=target=>{if(target&&QUICK_PAGES.has(target)&&!fullLoading){if(target&&document.getElementById(target))history.replaceState(null,"",`${location.pathname}${location.search}#${target}`);if(!quickLoading){document.getElementById("updated").textContent="Opening tracker…";quickLoading=loadScripts(QUICK_SCRIPTS,"Tracker")}return quickLoading.then(()=>window.NHLTrackerQuickRoutes?.open(target))}return loadCompleteApp(target)};
  window.NHLTrackerLoadFullApp=loadFullApp;
  window.NHLTrackerLoadCompleteApp=loadCompleteApp;

  const renderHome=summary=>{
    const season=seasonLabel(summary.season),updated=dateLabel(summary.dataGeneratedAt),games=summary.daily?.games||[],teams=summary.teams||{};
    document.getElementById("home-dossier-season").textContent=season;
    document.getElementById("home-dossier-updated").textContent=`Updated ${updated.split(",")[0]}`;
    document.getElementById("dashboard-season-label").textContent=season;
    window.NHLTrackerFreshnessStatus?.render({status:"static",snapshotAt:summary.dataGeneratedAt});
    document.getElementById("today-date").textContent=summary.daily?.currentDate||"Latest NHL slate";
    const host=document.getElementById("today-games");
    host.replaceChildren();
    if(!games.length){const notice=document.createElement("p");notice.className="notice";notice.textContent="No games are published in the current NHL window.";host.appendChild(notice);return}
    games.slice(0,6).forEach(game=>{
      const button=document.createElement("button");button.type="button";button.className="game-link";
      const clubs=document.createElement("strong");clubs.textContent=`${teams[game.away]||game.away} at ${teams[game.home]||game.home}`;
      const detail=document.createElement("span");detail.textContent=gameLabel(game);
      button.append(clubs,detail);button.addEventListener("click",()=>loadFullApp("games"),{once:true});host.appendChild(button);
    });
  };

  fetch("data/home.json",{cache:"no-store"}).then(response=>response.ok?response.json():Promise.reject(new Error("Home snapshot unavailable"))).then(renderHome).catch(()=>{
    document.getElementById("updated").textContent="Static snapshot unavailable";
    document.getElementById("today-games").textContent="Open the full tracker to retry NHL data.";
  });
  if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});

  document.querySelectorAll("#nav [data-default-page]").forEach(button=>button.addEventListener("click",()=>loadFullApp(button.dataset.defaultPage),{once:true}));
  document.querySelectorAll("[data-page],[data-home-page]").forEach(button=>button.addEventListener("click",()=>loadFullApp(button.dataset.page||button.dataset.homePage),{once:true}));
  for(const id of ["theme-button","global-search-button","season-select"])document.getElementById(id)?.addEventListener("click",()=>loadFullApp(),{once:true});
  const loadForDashboardExploration=()=>{if(!QUICK_PAGES.has(location.hash.slice(1)))loadFullApp()};
  window.addEventListener("wheel",loadForDashboardExploration,{once:true,passive:true});
  window.addEventListener("touchmove",loadForDashboardExploration,{once:true,passive:true});
  window.addEventListener("keydown",event=>{if(["ArrowDown","PageDown","End"," "].includes(event.key))loadForDashboardExploration()},{once:true});
  if(location.hash&&location.hash!=="#dashboard"||location.search)loadFullApp(location.hash.slice(1)||null);
})();
