(function initialiseDataLoader(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.NHLTrackerDataLoader=api;
}(typeof globalThis!=="undefined"?globalThis:this,function createDataLoader(){
  "use strict";
  const EMPTY={games:[],preseasonGames:[],standings:[],teams:{},daily:{games:[]},sources:{},rosters:{},players:{},officialPlayers:{skaters:[],goalies:[]},moneypuck:{teams:[],teamGames:[],skaters:[],goalies:[],lines:[],simulations:[]},naturalStatTrick:{teams:[],players:[],goalies:[]},gameCentre:{},news:{articles:[]},podcasts:{episodes:[]},videos:{videos:[]},transactions:{items:[]},rosterChanges:{},rosterChangeHistory:[],scheduleRelease:{},scheduleDifficulty:{},previousSeasonStandings:[],specialTeams:[],history:[],gameLibrary:[]};
  const ROUTE_CAPABILITIES={
    dashboard:["core"],tonight:["core"],schedule:["core","schedule"],games:["core","schedule","players","analytics"],
    teams:["core","schedule","players","analytics"],players:["core","players","analytics"],availability:["core","schedule","players","analytics"],compare:["core","players","analytics"],
    league:["core","players","analytics"],power:["core","schedule","analytics"],trends:["core","schedule","analytics"],playoffs:["core","schedule","analytics"],
    news:["core","players"],watchlist:["core","players","analytics"],status:["core","schedule","players","analytics"],guide:["core"]
  };
  let manifest=null,payload=null,legacy=false;
  const loaded=new Set();
  const merge=(base,addition)=>Object.assign(base,addition||{});
  const responseJson=async(url)=>{const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error(`${url} unavailable (${response.status})`);return response.json()};
  const withDefaults=value=>merge(structuredClone(EMPTY),value);
  async function legacyLoad(url="data/tracker.json"){
    payload=withDefaults(await responseJson(url));legacy=true;["core","schedule","players","analytics"].forEach(name=>loaded.add(name));return payload;
  }
  async function load({legacyUrl="data/tracker.json",capabilities=["core"]}={}){
    try{
      manifest=await responseJson("data/tracker-manifest.json");
      const manifestErrors=globalThis.NHLTrackerDataContracts?.validateCapabilityManifest(manifest)||[];if(manifestErrors.length)throw new Error(manifestErrors[0]);
      payload=withDefaults({});
      await ensure(capabilities);
      return payload;
    }catch(error){
      console.warn("Capability artifacts unavailable; using the compatible tracker artifact.",error);
      return legacyLoad(legacyUrl);
    }
  }
  async function ensure(capabilities=[]){
    if(!payload)throw new Error("Data loader must be initialised before loading a capability");
    if(legacy)return payload;
    for(const name of capabilities){
      if(loaded.has(name))continue;
      const entry=manifest?.capabilities?.[name];
      if(!entry?.url)return legacyLoad(manifest?.legacyUrl||"data/tracker.json");
      const shard=await responseJson(entry.url),errors=globalThis.NHLTrackerDataContracts?.validateCapabilityData(name,shard)||[];if(errors.length)throw new Error(errors[0]);merge(payload,shard);loaded.add(name);
    }
    return payload;
  }
  const forRoute=route=>ROUTE_CAPABILITIES[route]||["core"];
  const hasForRoute=route=>forRoute(route).every(name=>loaded.has(name));
  return Object.freeze({load,loadLegacy:legacyLoad,ensure,forRoute,hasForRoute,state:()=>({legacy,loaded:[...loaded],manifest}),EMPTY});
}));
