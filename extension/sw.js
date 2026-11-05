/* Notable Reader PWA shell. PDF assets are cached on first use; files and text are never cached. */
const CACHE='notable-reader-2.3.1';
const SHELL=['./','./reader.html','./reader.css','./reader.js','./formats.js','./core.js','./app.webmanifest','./icons/icon-32.png','./icons/icon-48.png','./icons/icon-192.png','./icons/icon-512.png','./vendor/pdfjs/pdf.mjs','./vendor/pdfjs/pdf.worker.mjs'];
self.addEventListener('install',event=>{event.waitUntil(fetch('./offline-assets.json').then(response=>{if(!response.ok)throw Error('offline assets unavailable');return response.json();}).then(assets=>caches.open(CACHE).then(cache=>cache.addAll([...new Set([...SHELL,...assets])]))));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>/^notable-reader-\d/.test(key)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin||!url.href.startsWith(new URL('./',location.href).href))return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{if(response.ok&&response.type==='basic'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;})));
});
