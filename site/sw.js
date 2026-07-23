const CACHE="nhl-tracker-7.18.0";
// Historical archives, auxiliary models and Plotly are deliberately fetched
// only when an online view needs them, keeping offline Home/Tonight dependable.
const SHELL=["./","./index.html","./critical.css?v=7.18.0","./styles.css?v=6.0.0","./theme-569.css?v=6.0.0","./design-system.css?v=7.18.0","./statistics.js?v=7.18.0","./shell.js?v=7.18.0","./game-state.js?v=7.18.0","./data-contracts.js?v=7.18.0","./router.js?v=7.18.0","./live-updates.js?v=7.18.0","./observability.js?v=7.18.0","./cloudflare-live.js?v=7.18.0","./app.js?v=7.18.0","./manifest.webmanifest","./icons/icon.svg?v=7.0.1","./icons/icon-192.png","./icons/icon-512.png","./build-meta.json","./data/home.json","./data/tracker.json"];

self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
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
