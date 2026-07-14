const CACHE="nhl-tracker-5.26.0";
const SHELL=["./","./index.html","./styles.css?v=5.26.0","./app.js?v=5.26.0","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./data/tracker.json","./data/seasons/index.json","./vendor/plotly-2.35.2.min.js"];

self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(SHELL.map(url=>cache.add(url))))));
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
