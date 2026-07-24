const assert=require("node:assert/strict");
let appended=0;
global.document={createElement:()=>({}),body:{appendChild(script){appended+=1;queueMicrotask(()=>script.onerror?.())}}};
const routes=require("../site/route-loader.js");
assert.equal(routes.groupFor("tonight"),"night");
assert.equal(routes.groupFor("schedule"),"season");
assert.equal(routes.groupFor("players"),"people");
assert.equal(routes.groupFor("league"),"explore");
assert.equal(routes.groupFor("dashboard"),null);
routes.register("night",{tonight:context=>context.run()});
let called=false;
assert.equal(routes.initialise("tonight",{run:()=>{called=true}}),undefined);
assert.equal(called,true);
(async()=>{
  await assert.rejects(routes.ensure("players"),/people route module unavailable/);
  await assert.rejects(routes.ensure("players"),/people route module unavailable/);
  assert.equal(appended,2,"a failed lazy route can be requested again");
  console.log("route loader tests passed");
})().catch(error=>{console.error(error);process.exitCode=1});
