(function initialiseRouteLoader(root,factory){
  const api=factory(root);root.NHLTrackerRoutes=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
}(typeof globalThis!=="undefined"?globalThis:this,function createRouteLoader(root){
  "use strict";
  const VERSION="7.21.0";
  const GROUPS={night:["tonight","games"],season:["schedule"],people:["teams","players","availability","compare","news","watchlist"],explore:["league","power","trends","playoffs","guide","status"]};
  const registry=new Map(),loading=new Map();
  const groupFor=page=>Object.entries(GROUPS).find(([,pages])=>pages.includes(page))?.[0]||null;
  const register=(group,initialisers)=>registry.set(group,Object.freeze({...initialisers}));
  const ensure=page=>{const group=groupFor(page);if(!group||registry.has(group))return Promise.resolve(group);if(loading.has(group))return loading.get(group);const promise=new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=`routes/${group}.js?v=${VERSION}`;script.async=true;script.onload=()=>registry.has(group)?resolve(group):reject(new Error(`${group} route module did not register`));script.onerror=()=>reject(new Error(`${group} route module unavailable`));document.body.appendChild(script)});loading.set(group,promise);return promise};
  const initialise=(page,context)=>{const group=groupFor(page),handler=group&&registry.get(group)?.[page];return handler?handler(context):false};
  return Object.freeze({GROUPS,groupFor,register,ensure,initialise,loaded:page=>{const group=groupFor(page);return !group||registry.has(group)}});
}));
