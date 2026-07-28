(function initialiseDataLoader(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.NHLTrackerDataLoader=api;
}(typeof globalThis!=="undefined"?globalThis:this,function createDataLoader(){
  "use strict";
  const EMPTY={games:[],preseasonGames:[],standings:[],teams:{},daily:{games:[]},sources:{},rosters:{},players:{},officialPlayers:{skaters:[],goalies:[]},moneypuck:{teams:[],teamGames:[],skaters:[],goalies:[],lines:[],simulations:[]},naturalStatTrick:{teams:[],players:[],goalies:[]},gameCentre:{},news:{articles:[]},podcasts:{episodes:[]},videos:{videos:[]},transactions:{items:[]},rosterChanges:{},rosterChangeHistory:[],scheduleRelease:{},scheduleDifficulty:{},previousSeasonStandings:[],specialTeams:[],history:[],gameLibrary:[]};
  const ROUTE_CAPABILITIES={
    dashboard:["core"],tonight:["core"],schedule:["core","schedule"],games:["core","analytics"],
    teams:["core","calendar","players","analytics"],players:["core","players","analytics"],availability:["core","calendar","players"],compare:["core","players","analytics"],
    league:["core","players","analytics"],power:["core","analytics"],trends:["core","analytics"],playoffs:["core","analytics"],
    news:["core","players"],watchlist:["core","players","analytics"],status:["core","schedule","players","analytics"],guide:["core"]
  };
  let manifest=null,payload=null,legacy=false,manifestPromise=null,legacyPromise=null;
  const loaded=new Set();
  const inFlight=new Map();
  const merge=(base,addition)=>Object.assign(base,addition||{});
  // Revalidate current-season artifacts without forcing an unconditional
  // download on every visit. Changed files still arrive immediately via ETag.
  const responseJson=async(url)=>{const response=await fetch(url,{cache:"no-cache"});if(!response.ok)throw new Error(`${url} unavailable (${response.status})`);return response.json()};
  const withDefaults=value=>merge(structuredClone(EMPTY),value);
  async function legacyLoad(url="data/tracker.json"){
    if(legacy&&payload)return payload;
    if(legacyPromise)return legacyPromise;
    legacyPromise=responseJson(url).then(value=>{payload=withDefaults(value);legacy=true;["core","schedule","players","analytics"].forEach(name=>loaded.add(name));return payload}).finally(()=>{legacyPromise=null});
    return legacyPromise;
  }
  async function load({legacyUrl="data/tracker.json",capabilities=["core"]}={}){
    try{
      manifestPromise=manifestPromise||responseJson("data/tracker-manifest.json").catch(error=>{manifestPromise=null;throw error});
      manifest=await manifestPromise;
      const manifestErrors=globalThis.NHLTrackerDataContracts?.validateCapabilityManifest(manifest)||[];if(manifestErrors.length)throw new Error(manifestErrors[0]);
      if(!payload)payload=withDefaults({});
      if(legacy)return payload;
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
      if(!inFlight.has(name))inFlight.set(name,(async()=>{const entry=manifest?.capabilities?.[name];if(!entry?.url)return legacyLoad(manifest?.legacyUrl||"data/tracker.json");const shard=await responseJson(entry.url),errors=globalThis.NHLTrackerDataContracts?.validateCapabilityData(name,shard)||[];if(errors.length)throw new Error(errors[0]);merge(payload,shard);loaded.add(name);return payload})().finally(()=>inFlight.delete(name)));
      await inFlight.get(name);
    }
    return payload;
  }
  const forRoute=route=>ROUTE_CAPABILITIES[route]||["core"];
  const hasForRoute=route=>forRoute(route).every(name=>loaded.has(name));
  return Object.freeze({load,loadLegacy:legacyLoad,ensure,forRoute,hasForRoute,state:()=>({legacy,loaded:[...loaded],manifest}),EMPTY});
}));
