/* Service worker: makes The Deep Cut installable and keeps the app shell
   available offline. Pages and code are network-first, so a new deploy is
   picked up on the next load; the cache is only the fallback. The API, the
   archive and the cover cache the page keeps itself are never touched. */
const SHELL_CACHE='deep-cut-shell-v1';
const SHELL=['/','/albums.mjs','/manifest.webmanifest','/assets/thedeepcut-logo.svg','/assets/save-icon.svg',
  '/assets/GeistPixel-Regular-VariableFont_ELSH.ttf','/assets/icons/icon-192.png','/assets/icons/apple-touch-icon.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k.startsWith('deep-cut-shell-')&&k!==SHELL_CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  event.respondWith((async()=>{
    try{
      const response=await fetch(request);
      if(response.ok&&SHELL.includes(url.pathname==='/index.html'?'/':url.pathname)){
        const copy=response.clone();caches.open(SHELL_CACHE).then(cache=>cache.put(request,copy));
      }
      return response;
    }catch(error){
      const cached=await caches.match(request,{ignoreSearch:true})||(request.mode==='navigate'&&await caches.match('/'));
      if(cached)return cached;
      throw error;
    }
  })());
});
