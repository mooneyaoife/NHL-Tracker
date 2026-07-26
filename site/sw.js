const CACHE="nhl-tracker-7.39.0";
// Home, Tonight and Schedule are the dependable install shell. Full analysis,
// historical archives, auxiliary models and Plotly are cached only after use.
const SHELL=["./","./index.html","./critical.css?v=7.39.0","./core-routes.css?v=7.39.0","./freshness-status.js?v=7.39.0","./shell.js?v=7.39.0","./home-snapshot.js?v=7.39.0","./game-state.js?v=7.39.0","./data-contracts.js?v=7.39.0","./data-loader.js?v=7.39.0","./route-loader.js?v=7.39.0","./route-app.js?v=7.39.0","./routes/night.js?v=7.39.0","./routes/season.js?v=7.39.0","./cloudflare-live.js?v=7.39.0","./manifest.webmanifest","./icons/icon.svg?v=7.0.1","./icons/icon-192.png","./icons/icon-512.png","./build-meta.json","./data/home.json","./data/tracker-manifest.json","./data/tracker-core.json","./data/tracker-schedule.json"];

self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  // Retire previous generations only after verifying the complete new shell.
  const cache=await caches.open(CACHE),required=["./data/home.json","./data/tracker-manifest.json","./data/tracker-core.json","./data/tracker-schedule.json"];
  const ready=(await Promise.all(required.map(path=>cache.match(path)))).every(Boolean);
  if(ready){
    const names=await caches.keys(),previous=names.filter(name=>name.startsWith("nhl-tracker-")&&name!==CACHE);
    await Promise.all(names.filter(name=>name!==CACHE).map(name=>caches.delete(name)));
    await self.clients.claim();
    if(previous.length){
      const windows=await self.clients.matchAll({type:"window"});
      await Promise.all(windows.map(client=>client.navigate(client.url).catch(()=>null)));
    }
  }else{
    console.warn("NHL Tracker offline shell is incomplete; retaining the previous cache generation.");
    await self.clients.claim();
  }
})()));
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting()});

async function networkFirst(request,fallback){
  const cache=await caches.open(CACHE);
  try{const response=await fetch(request);if(response.ok)cache.put(request,response.clone());return response}catch(_){return (await caches.match(request))||(fallback&&await caches.match(fallback))||Response.error()}
}

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(event.request.mode==="navigate"){event.respondWith(networkFirst(event.request,"./index.html"));return}
  if(url.origin===self.location.origin&&url.pathname.includes("/data/")){event.respondWith(networkFirst(event.request));return}
  event.respondWith(caches.match(event.request).then(cached=>{
    const fresh=fetch(event.request).then(async response=>{if(response.ok||response.type==="opaque"){const cache=await caches.open(CACHE);cache.put(event.request,response.clone())}return response});
    return cached||fresh.catch(()=>Response.error());
  }));
});
