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
  const stateFor=(summary,row,state)=>{
    const team=row.team,form=summary.teamForm?.[team]||[],recent={w:form.filter(game=>game.result==="W").length,l:form.filter(game=>game.result==="L").length,otl:form.filter(game=>game.result==="OTL").length},recentPoints=recent.w*2+recent.otl;
    if(state==="form")return form.length?{value:`${recentPoints}/${form.length*2}`,unit:"recent points",detail:`${recent.w}-${recent.l}-${recent.otl} over the last ${form.length}`,position:recentPoints/(form.length*2)*100}:{value:"Not started",unit:`${seasonLabel(summary.season)} form`,detail:"No completed games yet",position:5};
    if(state==="process")return{value:"Open",unit:"team process",detail:"Expected-goal context is available in the full analysis",position:50};
    if(state==="path"){const scheduled=summary.scheduledGames?.[team]||0;return{value:scheduled||"Awaiting",unit:scheduled?"scheduled games":"season path",detail:scheduled?"Published regular-season schedule":"No current model forecast",position:scheduled?Math.min(95,scheduled):5}}
    const rate=row.gp?row.points/(row.gp*2)*100:0;return{value:row.points||0,unit:`${seasonLabel(summary.standingsEvidence?.season)} points`,detail:`${row.w||0}-${row.l||0}-${row.otl||0} · ${signed(row.gd)} goal difference · ${rate.toFixed(1)} PTS%`,position:Math.max(5,Math.min(95,rate))};
  };
  const renderSeason=(summary,state="record")=>{
    const rows=summary.standingsEvidence?.rows||[],active=states.find(item=>item.id===state)||states[0],nav=document.getElementById("season-state-nav"),stage=document.getElementById("season-state-stage");
    if(!nav||!stage)return;
    nav.innerHTML=states.map(item=>`<button type="button" data-shell-season-state="${item.id}" class="${item.id===active.id?"active":""}" aria-pressed="${item.id===active.id}"><span>${item.index}</span><strong>${item.label}</strong><small>${item.note}</small></button>`).join("");
    const cards=rows.map(row=>({row,item:stateFor(summary,row,active.id)})),average=cards.length?cards.reduce((sum,card)=>sum+card.item.position,0)/cards.length:5;
    stage.dataset.state=active.id;stage.innerHTML=`<div class="season-rink" aria-hidden="true"><i class="rink-line centre"></i><i class="rink-line blue left"></i><i class="rink-line blue right"></i><b class="season-puck" style="--puck-position:${average}%"></b></div><div class="season-state-heading"><span>${active.index} / Season state</span><h3>${active.label}</h3><p>${active.note}</p></div><div class="season-state-teams">${cards.map(({row,item},index)=>`<article style="--delay:${index*55}ms"><img src="https://assets.nhle.com/logos/nhl/svg/${encodeURIComponent(row.team)}_light.svg" alt=""><div><span>${escape(row.name||summary.teams?.[row.team]||row.team)}</span><strong>${escape(item.value)}</strong><small>${escape(item.unit)}</small><p>${escape(item.detail)}</p></div><i class="season-state-meter"><b style="width:${item.position}%"></b></i></article>`).join("")}</div>`;
    document.getElementById("season-file-index").textContent=`File ${active.index} / 04`;
    nav.querySelectorAll("[data-shell-season-state]").forEach(button=>button.onclick=()=>renderSeason(summary,button.dataset.shellSeasonState));
  };
  const render=(summary,{open=()=>{}}={})=>{
    const rows=summary.standingsEvidence?.rows||[],evidence=seasonLabel(summary.standingsEvidence?.season);
    renderSeason(summary);
    const performance=document.getElementById("dashboard-points");
    if(performance){performance.classList.add("home-snapshot-list");performance.setAttribute("role","list");performance.setAttribute("aria-label",`${evidence} followed-team records`);performance.innerHTML=rows.length?rows.map(row=>`<div class="rank-row" role="listitem"><strong>${escape(row.team)}</strong><span>${escape(`${row.w||0}-${row.l||0}-${row.otl||0} · ${row.points||0} PTS · ${signed(row.gd)} GD`)}</span></div>`).join(""):'<p class="notice">Followed-team standings are updating.</p>'}
    const recent=document.getElementById("recent-form"),hasForm=rows.some(row=>(summary.teamForm?.[row.team]||[]).length);
    if(recent)recent.innerHTML=hasForm?rows.map(row=>{const games=summary.teamForm?.[row.team]||[];return`<div class="rank-row dashboard-form-row"><strong>${escape(row.team)}</strong><div class="form">${games.map(game=>`<span class="pill ${escape(game.result)}">${escape(game.result)}</span>`).join("")||"No games yet"}</div></div>`}).join(""):`<p class="notice">${escape(seasonLabel(summary.season))} form begins after completed games.</p>`;
    const saved=document.getElementById("home-saved-players");if(saved)saved.innerHTML='<div class="home-empty-state"><strong>Saved players are ready</strong><span>Open player analysis to view and manage your watchlist.</span></div>';
    const pinned=document.getElementById("home-pinned-analytics");if(pinned){pinned.innerHTML='<button type="button" class="home-pin" data-shell-page="league"><span>Team Rankings</span><small>League-wide performance categories</small><b>→</b></button><button type="button" class="home-pin" data-shell-page="playoffs"><span>Playoff Path</span><small>Forecasts and postseason routes</small><b>→</b></button><button type="button" class="home-pin" data-shell-page="schedule"><span>Season Shape</span><small>Density, rest and difficulty</small><b>→</b></button>';pinned.querySelectorAll("[data-shell-page]").forEach(button=>button.onclick=()=>open(button.dataset.shellPage))}
  };
  const attach=(summary,{open=()=>{}}={})=>{const performance=document.getElementById("dashboard-points");if(performance){performance.classList.add("home-snapshot-list");performance.setAttribute("role","list");performance.setAttribute("aria-label",`${seasonLabel(summary.standingsEvidence?.season)} followed-team records`)}document.getElementById("season-state-nav")?.querySelectorAll("[data-shell-season-state]").forEach(button=>button.onclick=()=>renderSeason(summary,button.dataset.shellSeasonState));document.getElementById("home-pinned-analytics")?.querySelectorAll("[data-shell-page]").forEach(button=>button.onclick=()=>open(button.dataset.shellPage))};
  window.NHLTrackerHomeSnapshot=Object.freeze({render,attach});
})();
