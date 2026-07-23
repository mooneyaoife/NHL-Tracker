"use strict";
(()=>{
  const VERSION="7.18.0";
  const FULL_SCRIPTS=["statistics.js","game-state.js","data-contracts.js","router.js","live-updates.js","observability.js","cloudflare-live.js","app.js"];
  let loading=null;
  const seasonLabel=value=>{const season=String(value||"");return season.length===8?`${season.slice(0,4)}–${season.slice(6)}`:"Current season"};
  const dateLabel=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}):"Latest artifact"};
  const gameLabel=game=>game.status?.label||game.stateLabel||game.state||"Scheduled";
  const loadFullApp=target=>{
    if(target&&document.getElementById(target))history.replaceState(null,"",`${location.pathname}${location.search}#${target}`);
    if(loading)return loading;
    document.getElementById("updated").textContent="Opening full tracker…";
    loading=new Promise((resolve,reject)=>{
      let remaining=FULL_SCRIPTS.length;
      for(const name of FULL_SCRIPTS){
        const script=document.createElement("script");
        script.src=`${name}?v=${VERSION}`;
        script.async=false;
        script.onload=()=>{remaining-=1;if(!remaining)resolve()};
        script.onerror=()=>reject(new Error(`${name} could not load`));
        document.body.appendChild(script);
      }
    }).catch(error=>{document.getElementById("updated").textContent="Full tracker unavailable";console.error(error);throw error});
    return loading;
  };
  window.NHLTrackerLoadFullApp=loadFullApp;

  const renderHome=summary=>{
    const season=seasonLabel(summary.season),updated=dateLabel(summary.dataGeneratedAt),games=summary.daily?.games||[],teams=summary.teams||{};
    document.getElementById("home-dossier-season").textContent=season;
    document.getElementById("home-dossier-updated").textContent=`Updated ${updated.split(",")[0]}`;
    document.getElementById("dashboard-season-label").textContent=season;
    document.getElementById("updated").textContent=`Static snapshot · ${updated}`;
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
  window.addEventListener("wheel",()=>loadFullApp(),{once:true,passive:true});
  window.addEventListener("touchmove",()=>loadFullApp(),{once:true,passive:true});
  window.addEventListener("keydown",event=>{if(["ArrowDown","PageDown","End"," "].includes(event.key))loadFullApp()},{once:true});
  if(location.hash&&location.hash!=="#dashboard"||location.search)loadFullApp(location.hash.slice(1)||null);
})();
