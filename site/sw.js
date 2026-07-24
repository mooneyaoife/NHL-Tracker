const CACHE="nhl-tracker-7.21.0";
const LEGACY_CACHE="nhl-tracker-7.20.0";
// Historical archives, auxiliary models and Plotly are deliberately fetched
// only when an online view needs them, keeping offline Home/Tonight dependable.
const SHELL=["./","./index.html","./critical.css?v=7.21.0","./styles.css?v=6.0.0","./theme-569.css?v=6.0.0","./design-system.css?v=7.21.0","./freshness-status.js?v=7.21.0","./statistics.js?v=7.21.0","./shell.js?v=7.21.0","./game-state.js?v=7.21.0","./data-contracts.js?v=7.21.0","./data-loader.js?v=7.21.0","./router.js?v=7.21.0","./route-loader.js?v=7.21.0","./route-app.js?v=7.21.0","./routes/night.js?v=7.21.0","./routes/season.js?v=7.21.0","./preferences.js?v=7.21.0","./live-updates.js?v=7.21.0","./observability.js?v=7.21.0","./cloudflare-live.js?v=7.21.0","./app.js?v=7.21.0","./manifest.webmanifest","./icons/icon.svg?v=7.0.1","./icons/icon-192.png","./icons/icon-512.png","./build-meta.json","./data/home.json","./data/tracker-manifest.json","./data/tracker-core.json","./data/tracker-schedule.json"];

self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  // Verify the new offline contract before retiring legacy caches. If an
  // interrupted update omitted a shard, old cached tracker.json remains a
  // valid compatibility fallback instead of leaving the install unusable.
  const cache=await caches.open(CACHE),required=["./data/home.json","./data/tracker-manifest.json","./data/tracker-core.json","./data/tracker-schedule.json"];
  const ready=(await Promise.all(required.map(path=>cache.match(path)))).every(Boolean);
  // Keep the immediately preceding cache for this migration release. The
  // compatibility loader can still recover tracker.json if an installed app
  // comes online with the old schema but before every new capability exists.
  if(ready){
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name!==CACHE&&name!==LEGACY_CACHE).map(name=>caches.delete(name)));
  }else console.warn("NHL Tracker capability cache is incomplete; retaining legacy cache fallback.");
  await self.clients.claim();
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
