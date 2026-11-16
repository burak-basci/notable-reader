/* beNotable! Reader engine · model download worker · own code MIT.
 * Network -> incremental SHA-256 -> Cache API run HERE, not in the host page: the host page also schedules the audio, answers the play/pause/seek
 * commands of the reading page and talks to the synthesis worker. A 300-1500 MB download used to keep its main thread busy for the whole transfer
 * (hash of every chunk, copy of the verified file), so the next section started late and commands waited behind it.
 * Protocol: {t:'start',cacheName,file} -> {t:'progress',loaded} (at most 4 per second) ... {t:'done',fetched} | {t:'error',name,code,message}; {t:'abort'} stops it. */
import {downloadVerified} from '../../tools/reader/neural-download.js';
let controller=null;
const fail=error=>postMessage({t:'error',name:error?.name||'Error',code:error?.code,message:String(error?.message||error)});
onmessage=async event=>{
 const message=event.data;
 if(message?.t==='abort'){controller?.abort();return;}
 if(message?.t!=='start'||controller)return;
 controller=new AbortController();
 let last=0;
 try{
  const cache=await caches.open(message.cacheName);
  const fetched=await downloadVerified(cache,message.file,{signal:controller.signal,onProgress:loaded=>{
   const now=performance.now();
   if(now-last<250&&loaded<message.file.bytes)return;
   last=now;postMessage({t:'progress',loaded});
  }});
  postMessage({t:'done',fetched});
 }catch(error){fail(error);}
};
