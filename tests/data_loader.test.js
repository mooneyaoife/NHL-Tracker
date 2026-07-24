const assert=require("node:assert/strict");
const loaderPath=require.resolve("../site/data-loader.js");
const responses={
  "data/tracker-manifest.json":{schema:1,legacyUrl:"data/tracker.json",capabilities:{core:{url:"data/tracker-core.json"},players:{url:"data/tracker-players.json"},schedule:{url:"data/tracker-schedule.json"},analytics:{url:"data/tracker-analytics.json"}}},
  "data/tracker-core.json":{meta:{season:"20262027"},standings:[],teams:{},daily:{games:[]}},
  "data/tracker-players.json":{rosters:{MTL:[{id:1,name:"Player"}]}},
};
global.structuredClone=value=>JSON.parse(JSON.stringify(value));
global.fetch=async url=>({ok:Boolean(responses[url]),status:responses[url]?200:404,json:async()=>responses[url]});
delete require.cache[loaderPath];
const loader=require(loaderPath);
(async()=>{
  const core=await loader.load({capabilities:["core"]});
  assert.equal(core.meta.season,"20262027");
  assert.deepEqual(core.rosters,{});
  assert.equal(loader.hasForRoute("players"),false);
  const players=await loader.ensure(["players"]);
  assert.equal(players.rosters.MTL[0].name,"Player");
  assert.deepEqual(loader.forRoute("schedule"),["core","schedule"]);
  delete require.cache[loaderPath];
  const legacyPayload={meta:{season:"20252026"},standings:[],teams:{},games:[]};
  global.fetch=async url=>({ok:url==="data/tracker.json",status:url==="data/tracker.json"?200:404,json:async()=>legacyPayload});
  const compatibilityLoader=require(loaderPath);
  const legacy=await compatibilityLoader.load({capabilities:["core"]});
  assert.equal(legacy.meta.season,"20252026");
  assert.equal(compatibilityLoader.state().legacy,true);
  console.log("data loader tests passed");
})().catch(error=>{console.error(error);process.exitCode=1});
