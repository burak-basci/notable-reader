/* beNotable! Reader web app · service worker (own code, MIT). Offline shell and runtime assets; files, texts and downloaded voice models are never touched here (models live in their own cache, written by the engine).
   Raise the revision (--rev) with every change of app code: the old cache is deleted when the new worker activates. */
const CACHE='__CACHE__';
const SHELL=__SHELL__;
const ISOLATE=true;   // cross-origin isolation for WASM threads (faster voices) without a server header: added to the app's own responses
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(async cache=>{
  const urls=['./',...SHELL];for(let i=0;i<urls.length;i+=24)await Promise.all(urls.slice(i,i+24).map(url=>cache.add(new Request(url,{cache:'reload'}))));
}));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>/^notable-reader-\d/.test(key)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
const isolate=response=>{
  if(!ISOLATE||!response||response.status===0)return response;
  const headers=new Headers(response.headers);headers.set('Cross-Origin-Embedder-Policy','require-corp');headers.set('Cross-Origin-Opener-Policy','same-origin');headers.set('Cross-Origin-Resource-Policy','same-origin');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
};
/* Media elements ask for byte ranges; a cached file answers them properly (206) instead of the whole file. */
async function ranged(request,response){
  const range=/^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range')||'');if(!range||!response||response.status!==200)return response;
  const blob=await response.blob(),size=blob.size;let start=range[1]===''?Math.max(0,size-Number(range[2])):Number(range[1]),end=range[1]===''||range[2]===''?size-1:Math.min(size-1,Number(range[2]));
  if(!(start<=end&&start<size))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
  const headers=new Headers(response.headers);headers.set('Content-Range',`bytes ${start}-${end}/${size}`);headers.set('Content-Length',String(end-start+1));
  return new Response(blob.slice(start,end+1),{status:206,statusText:'Partial Content',headers});
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),scope=new URL('./',self.registration.scope).href;
  if(request.method!=='GET'||url.origin!==location.origin||!url.href.startsWith(scope)||url.pathname.endsWith('/sw.js'))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const hit=await cache.match(request,{ignoreSearch:request.mode==='navigate'});
    if(hit)return isolate(await ranged(request,hit));
    let response;try{response=await fetch(request);}catch(error){if(request.mode==='navigate'){const shell=await cache.match('./');if(shell)return isolate(shell);}throw error;}
    if(response.ok&&response.status===200&&response.type==='basic'&&!request.headers.has('range'))cache.put(request,response.clone()).catch(()=>{});
    return isolate(response);
  })());
});
