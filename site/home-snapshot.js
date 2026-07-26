"use strict";
(()=>{
  const states=[
    {id:"record",index:"01",label:"Record",note:"What happened"},
    {id:"form",index:"02",label:"Form",note:"What is moving"},
    {id:"process",index:"03",label:"Process",note:"What supports it"},
    {id:"path",index:"04",label:"Path",note:"What comes next"}
  ];
  const escape=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const seasonLabel=value=>{const season=String(value||"");return season.length===8?`${season.slice(0,4)}–${season.slice(6)}`:"Current season"};
  const signed=value=>Number(value)>0?`+${value}`:String(value??0);
  const teamName=(summary,code)=>summary.teams?.[code]||code;
  const londonTime=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString("en-GB",{timeZone:"Europe/London",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).replace(",","")+" UK":"Start time TBC"};
  const readJson=(key,fallback=null)=>{try{const value=JSON.parse(localStorage.getItem(key)||"null");return value===null?fallback:value}catch(_){return fallback}};
  const storageAvailable=()=>{try{const key="nhl-storage-check";localStorage.setItem(key,"1");localStorage.removeItem(key);return true}catch(_){return false}};
  const freshnessStale=summary=>["stale","failed","error"].includes(String(summary.freshness?.status||"").toLowerCase());

  const selectedTeams=summary=>{
    const available=new Set(Object.keys(summary.watchNext?.teamBriefs||{})),stored=readJson("nhl-tracked-teams",null);
    if(Array.isArray(stored)&&stored.length){const teams=[...new Set(stored.map(String))].filter(team=>available.has(team));if(teams.length)return{teams,personalised:true}}
    return{teams:[],personalised:false};
  };
  const uniqueBriefs=rows=>{const seen=new Set();return rows.filter(row=>row&&!seen.has(String(row.id))&&seen.add(String(row.id))).sort((a,b)=>(a.startTimeUTC||a.londonDate||"").localeCompare(b.startTimeUTC||b.londonDate||""))};
  const briefRows=(summary,selection)=>selection.personalised
    ?uniqueBriefs(selection.teams.map(team=>summary.watchNext?.teamBriefs?.[team])).slice(0,3)
    :uniqueBriefs(summary.watchNext?.leagueBriefs||[]).slice(0,3);
  const signalHtml=signal=>`<div class="watch-next-signal"><span>${escape(signal.label)}</span><strong>${escape(signal.value)}</strong><small>${escape(signal.detail)}</small></div>`;
  const openGame=(id,open)=>{const url=new URL(location.href);url.searchParams.set("game",id);url.hash="games";history.pushState({page:"games",scrollY:0},"",`${url.pathname}${url.search}${url.hash}`);open("games")};
  const watchMarkup=(summary,rows,selection)=>{
    if(!rows.length)return'<div class="watch-next-empty"><strong>No upcoming games in this season</strong><span>The published schedule has no future matchup to brief.</span><button type="button" data-watch-page="schedule">Open Schedule →</button></div>';
    const hero=rows[0],supporting=rows.slice(1),evidence=seasonLabel(summary.watchNext?.sourceSeason),mode=selection.personalised?"Your teams":"League watch",stale=freshnessStale(summary),updated=new Date(summary.dataGeneratedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short"}),freshness=stale?`stale snapshot · updated ${updated}`:`updated ${updated}`;
    return `<article class="watch-next-hero" data-watch-mode="${selection.personalised?"personal":"league"}"><header><div><span class="section-kicker">${mode}</span><h3>${escape(teamName(summary,hero.away))} at ${escape(teamName(summary,hero.home))}</h3><p>${escape(londonTime(hero.startTimeUTC))} · ${escape(hero.venue||"Venue TBC")}</p></div><b class="watch-next-state state-${escape(hero.status)}">${escape(hero.statusLabel)}</b></header><div class="watch-next-signals" aria-label="Things to know">${(hero.signals||[]).map(signalHtml).join("")||'<p class="notice">Schedule context is not available for this matchup.</p>'}</div><footer><button type="button" class="watch-next-open" data-watch-game="${escape(hero.id)}">Open Game Centre →</button><span class="${stale?"is-stale":""}">${escape(evidence)} opponent evidence · ${escape(freshness)} · UK time</span></footer><details class="watch-next-method"><summary>How to read this brief</summary><p>${escape(summary.watchNext?.methodology?.inputs)}. ${escape(summary.watchNext?.methodology?.limitations)}.</p><small>Schedule burden is context, not a result or win-probability forecast.</small></details></article>${supporting.length?`<div class="watch-next-support" aria-label="More games to watch">${supporting.map(row=>`<button type="button" class="watch-next-row" data-watch-game="${escape(row.id)}"><span>${escape(row.statusLabel)} · ${escape(londonTime(row.startTimeUTC))}</span><strong>${escape(teamName(summary,row.away))} at ${escape(teamName(summary,row.home))}</strong><small>${escape(row.signals?.[0]?.value||"Open matchup evidence")}</small><b>→</b></button>`).join("")}</div>`:""}`;
  };
  const renderWatchNext=(summary,open)=>{
    const host=document.getElementById("today-games");if(!host)return;
    const selection=selectedTeams(summary),rows=briefRows(summary,selection);
    host.innerHTML=watchMarkup(summary,rows,selection);host.removeAttribute("aria-busy");
    const date=document.getElementById("today-date");if(date)date.textContent=`${selection.personalised?`${selection.teams.length} followed team${selection.teams.length===1?"":"s"}`:"League-wide first look"}${freshnessStale(summary)?" · stale data":""} · UK time`;
    host.querySelectorAll("[data-watch-game]").forEach(button=>button.onclick=()=>openGame(button.dataset.watchGame,open));
    host.querySelectorAll("[data-watch-page]").forEach(button=>button.onclick=()=>open(button.dataset.watchPage));
  };

  const continuityTeams=(summary,selection)=>selection.personalised?selection.teams:(summary.trackedTeams||[]);
  const continuityCurrent=(summary,teams)=>{
    const base=summary.continuity||{},followed=new Set(teams),filterGames=rows=>Object.fromEntries(Object.entries(rows||{}).filter(([,row])=>(row.focusTeams||[row.away,row.home]).some(team=>followed.has(team))).map(([id,row])=>[id,{...row,team:(row.focusTeams||[row.away,row.home]).find(team=>followed.has(team))||row.home}])),roster=Object.fromEntries(Object.entries(base.roster||{}).filter(([,row])=>followed.has(row.team)));
    return{schema:3,season:base.season||summary.season,capturedAt:base.capturedAt||summary.dataGeneratedAt,updatedAt:base.updatedAt||summary.dataGeneratedAt,teams:[...teams],finished:filterGames(base.finished),upcoming:filterGames(base.upcoming),roster,schedule:base.schedule||{},ranks:{},power:{},forecasts:{},leaders:{},news:{},playerStates:{}};
  };
  const gameLabel=game=>game.awayScore!=null?`${game.away} ${game.awayScore}–${game.homeScore} ${game.home}`:`${game.away} at ${game.home}`;
  const currentPulse=current=>{
    const rows=[];
    if(current.schedule?.complete)rows.push({type:"schedule",team:current.teams[0],title:`${seasonLabel(current.schedule.activeSeason||current.season)} schedule verified`,detail:"The published regular-season schedule is complete",page:"schedule",priority:0});
    Object.values(current.finished||{}).sort((a,b)=>(b.startTimeUTC||b.date||"").localeCompare(a.startTimeUTC||a.date||"")).slice(0,2).forEach(game=>rows.push({type:"result",team:game.team,title:gameLabel(game),detail:"Latest official result",gameId:game.id,priority:1}));
    Object.values(current.roster||{}).slice(0,2).forEach(row=>rows.push({type:"roster",team:row.team,title:`${row.name} · ${row.direction}`,detail:"Official roster snapshot changed",page:"news",priority:2}));
    return rows.sort((a,b)=>a.priority-b.priority).slice(0,5);
  };
  const scheduleChanges=(previous,current)=>{
    const rows=[],before=previous.schedule||{},after=current.schedule||{},team=current.teams[0];
    if(!before.complete&&after.complete)rows.push({type:"schedule",team,title:`${seasonLabel(after.activeSeason||current.season)} schedule is now complete`,detail:"Published games and calendar feeds are ready",page:"schedule",priority:0});
    Object.entries(after.changes||{}).filter(([key])=>!before.changes?.[key]).slice(0,3).forEach(([,change])=>{const game=change.game||{},match=`${game.away||"TBC"} at ${game.home||"TBC"}`;rows.push({type:"schedule",team:[game.away,game.home].find(code=>current.teams.includes(code))||team,title:`${match} ${change.kind==="changed"?"rescheduled":change.kind||"changed"}`,detail:"Official schedule snapshot changed",page:"schedule",priority:0})});
    return rows;
  };
  const visitChanges=(previous,current)=>{
    const rows=scheduleChanges(previous,current),seenFinished=previous.finished||{},seenRoster=previous.roster||{};
    Object.values(current.finished||{}).filter(game=>!seenFinished[game.id]).sort((a,b)=>(b.startTimeUTC||b.date||"").localeCompare(a.startTimeUTC||a.date||"")).slice(0,4).forEach(game=>rows.push({type:"result",team:game.team,title:gameLabel(game),detail:"Final · official NHL result",gameId:game.id,priority:1}));
    Object.values(current.upcoming||{}).filter(game=>previous.upcoming?.[game.id]?.startTimeUTC&&game.startTimeUTC&&previous.upcoming[game.id].startTimeUTC!==game.startTimeUTC).slice(0,3).forEach(game=>rows.push({type:"schedule",team:game.team,title:`${game.away} at ${game.home} changed time`,detail:`Now ${londonTime(game.startTimeUTC)}`,page:"schedule",priority:2}));
    Object.values(current.roster||{}).filter(row=>!seenRoster[row.key]).slice(0,3).forEach(row=>rows.push({type:"roster",team:row.team,title:`${row.name} · ${row.direction}`,detail:"Official roster snapshot changed",page:"news",priority:2}));
    return rows.sort((a,b)=>a.priority-b.priority).slice(0,6);
  };
  const pruneVisitKeys=currentKey=>{try{const keys=Object.keys(localStorage).filter(key=>key.startsWith("nhl-visit-")&&key!==currentKey).sort();keys.slice(0,Math.max(0,keys.length-2)).forEach(key=>localStorage.removeItem(key))}catch(_){}};
  const writeVisit=(key,current)=>{try{localStorage.setItem(key,JSON.stringify(current));pruneVisitKeys(key);return true}catch(_){return false}};
  const renderContinuity=(summary,open)=>{
    const host=document.getElementById("since-last-visit");if(!host||!summary.continuity)return;
    const selection=selectedTeams(summary),teams=continuityTeams(summary,selection),current=continuityCurrent(summary,teams),key=`nhl-visit-${current.season}`,previous=readJson(key,null),sameTeams=previous&&[...(previous.teams||[])].sort().join("|")===teams.slice().sort().join("|"),hasPrior=previous&&sameTeams&&previous.schema>=1,changes=hasPrior?visitChanges(previous,current):currentPulse(current),stale=freshnessStale(summary),canStore=storageAvailable();
    if(!changes.length){if(!stale&&canStore)writeVisit(key,current);host.hidden=true;return}
    host.hidden=false;const currentPulseMode=!hasPrior,title=document.getElementById("visit-panel-title"),note=document.getElementById("visit-panel-note"),mark=document.getElementById("visit-mark-seen");
    title.textContent=currentPulseMode?"Latest update":`${changes.length} meaningful ${changes.length===1?"change":"changes"}`;
    note.textContent=stale?"Stored evidence is shown, but this stale snapshot will not advance your local briefing.":!canStore?"Current evidence is available, but this browser cannot save return-visit state.":currentPulseMode?"A factual starting point; future visits show only what moved.":`Since ${new Date(previous.capturedAt).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})} · saved only on this device`;
    const icon={result:"G",schedule:"T",roster:"R"};document.getElementById("visit-change-list").innerHTML=changes.map(change=>`<button type="button" class="visit-change" style="--team-colour:var(--brand)" ${change.gameId?`data-visit-game="${escape(change.gameId)}"`:`data-visit-page="${escape(change.page||"schedule")}"`}><span class="visit-change-icon" title="${escape(change.type)}">${icon[change.type]||"•"}</span><span><strong>${escape(change.title)}</strong><small>${escape(change.detail)}</small></span><b>→</b></button>`).join("");
    mark.disabled=stale||!canStore;mark.textContent=stale?"Snapshot is stale":canStore?"Mark as read":"Storage unavailable";mark.onclick=()=>{if(writeVisit(key,current))host.hidden=true};
    host.querySelectorAll("[data-visit-game]").forEach(button=>button.onclick=()=>openGame(button.dataset.visitGame,open));host.querySelectorAll("[data-visit-page]").forEach(button=>button.onclick=()=>open(button.dataset.visitPage));
  };

  const stateFor=(summary,row,state)=>{
    const team=row.team,form=summary.teamForm?.[team]||[],recent={w:form.filter(game=>game.result==="W").length,l:form.filter(game=>game.result==="L").length,otl:form.filter(game=>game.result==="OTL").length},recentPoints=recent.w*2+recent.otl;
    if(state==="form")return form.length?{value:`${recentPoints}/${form.length*2}`,unit:"recent points",detail:`${recent.w}-${recent.l}-${recent.otl} over the last ${form.length}`,position:recentPoints/(form.length*2)*100}:{value:"Not started",unit:`${seasonLabel(summary.season)} form`,detail:"No completed games yet",position:5};
    if(state==="process")return{value:"Open",unit:"team process",detail:"Expected-goal context is available in the full analysis",position:50};
    if(state==="path"){const scheduled=summary.scheduledGames?.[team]||0;return{value:scheduled||"Awaiting",unit:scheduled?"scheduled games":"season path",detail:scheduled?"Published regular-season schedule":"No current model forecast",position:scheduled?Math.min(95,scheduled):5}}
    const rate=row.gp?row.points/(row.gp*2)*100:0;return{value:row.points||0,unit:`${seasonLabel(summary.standingsEvidence?.season)} points`,detail:`${row.w||0}-${row.l||0}-${row.otl||0} · ${signed(row.gd)} goal difference · ${rate.toFixed(1)} PTS%`,position:Math.max(5,Math.min(95,rate))};
  };
  const renderSeason=(summary,state="record")=>{
    const rows=summary.standingsEvidence?.rows||[],active=states.find(item=>item.id===state)||states[0],nav=document.getElementById("season-state-nav"),stage=document.getElementById("season-state-stage");if(!nav||!stage)return;
    nav.innerHTML=states.map(item=>`<button type="button" data-shell-season-state="${item.id}" class="${item.id===active.id?"active":""}" aria-pressed="${item.id===active.id}"><span>${item.index}</span><strong>${item.label}</strong><small>${item.note}</small></button>`).join("");
    const cards=rows.map(row=>({row,item:stateFor(summary,row,active.id)})),average=cards.length?cards.reduce((sum,card)=>sum+card.item.position,0)/cards.length:5;stage.dataset.state=active.id;stage.innerHTML=`<div class="season-rink" aria-hidden="true"><i class="rink-line centre"></i><i class="rink-line blue left"></i><i class="rink-line blue right"></i><b class="season-puck" style="--puck-position:${average}%"></b></div><div class="season-state-heading"><span>${active.index} / Season state</span><h3>${active.label}</h3><p>${active.note}</p></div><div class="season-state-teams">${cards.map(({row,item},index)=>`<article style="--delay:${index*55}ms"><img src="https://assets.nhle.com/logos/nhl/svg/${encodeURIComponent(row.team)}_light.svg" alt=""><div><span>${escape(row.name||summary.teams?.[row.team]||row.team)}</span><strong>${escape(item.value)}</strong><small>${escape(item.unit)}</small><p>${escape(item.detail)}</p></div><i class="season-state-meter"><b style="width:${item.position}%"></b></i></article>`).join("")}</div>`;document.getElementById("season-file-index").textContent=`File ${active.index} / 04`;nav.querySelectorAll("[data-shell-season-state]").forEach(button=>button.onclick=()=>renderSeason(summary,button.dataset.shellSeasonState));
  };
  const renderSupporting=(summary,open)=>{
    const rows=summary.standingsEvidence?.rows||[],evidence=seasonLabel(summary.standingsEvidence?.season);renderSeason(summary);const performance=document.getElementById("dashboard-points");if(performance){performance.classList.add("home-snapshot-list");performance.setAttribute("role","list");performance.setAttribute("aria-label",`${evidence} followed-team records`);performance.innerHTML=rows.length?rows.map(row=>`<div class="rank-row" role="listitem"><strong>${escape(row.team)}</strong><span>${escape(`${row.w||0}-${row.l||0}-${row.otl||0} · ${row.points||0} PTS · ${signed(row.gd)} GD`)}</span></div>`).join(""):'<p class="notice">Followed-team standings are updating.</p>'}const recent=document.getElementById("recent-form"),hasForm=rows.some(row=>(summary.teamForm?.[row.team]||[]).length);if(recent)recent.innerHTML=hasForm?rows.map(row=>{const games=summary.teamForm?.[row.team]||[];return`<div class="rank-row dashboard-form-row"><strong>${escape(row.team)}</strong><div class="form">${games.map(game=>`<span class="pill ${escape(game.result)}">${escape(game.result)}</span>`).join("")||"No games yet"}</div></div>`}).join(""):`<p class="notice">${escape(seasonLabel(summary.season))} form begins after completed games.</p>`;const saved=document.getElementById("home-saved-players");if(saved)saved.innerHTML='<div class="home-empty-state"><strong>Saved players are ready</strong><span>Open player analysis to view and manage your watchlist.</span></div>';const pinned=document.getElementById("home-pinned-analytics");if(pinned){pinned.innerHTML='<button type="button" class="home-pin" data-shell-page="league"><span>Team Rankings</span><small>League-wide performance categories</small><b>→</b></button><button type="button" class="home-pin" data-shell-page="playoffs"><span>Playoff Path</span><small>Forecasts and postseason routes</small><b>→</b></button><button type="button" class="home-pin" data-shell-page="schedule"><span>Season Shape</span><small>Density, rest and difficulty</small><b>→</b></button>';pinned.querySelectorAll("[data-shell-page]").forEach(button=>button.onclick=()=>open(button.dataset.shellPage))}
  };
  const render=(summary,{open=()=>{}}={})=>{renderSupporting(summary,open);renderWatchNext(summary,open);renderContinuity(summary,open)};
  const attach=(summary,{open=()=>{}}={})=>render(summary,{open});
  window.NHLTrackerHomeSnapshot=Object.freeze({render,attach});
})();
