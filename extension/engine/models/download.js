/* beNotable! Reader engine · verified model download · own code MIT.
 * Bytes flow network -> incremental SHA-256 -> Cache API (neural-download.js); this wrapper adds the whole-model view:
 * storage-quota check before the first byte, one progress stream over all files, clear phases. */
export {Sha256,downloadVerified,partialKey} from '../../tools/reader/neural-download.js';
import {downloadVerified} from '../../tools/reader/neural-download.js';
import {modelBytes,engineError} from './registry.js';
/* Missing bytes of a model given the cache (files already stored are not counted). */
export async function missingBytes(cache,model){
 let missing=0;
 for(const file of model.files)if(!await cache.match(file.url))missing+=file.bytes;
 return missing;
}
/* Refuses to start when the browser quota (if it reports one) cannot hold the missing bytes plus 10 % headroom. */
export function assertQuota({missing,usage,quota}){
 if(quota===undefined||usage===undefined)return;
 if(quota-usage<missing*1.1)throw engineError('quota',`Zu wenig Speicherplatz für dieses Sprachmodell: benötigt ca. ${Math.ceil(missing/1e6)} MB, frei ca. ${Math.max(0,Math.floor((quota-usage)/1e6))} MB.`);
}
/* A fetchFile that runs in a dedicated worker (download-worker.js): the host page keeps its main thread for audio and commands while hashing and cache writes happen elsewhere.
 * Same contract as downloadVerified(cache,file,{signal,onProgress}); errors keep name/code/message (AbortError, offline, unreachable, hash ...).
 * A worker that can not start rejects with code 'worker-failed' before any byte moved, so the caller may fall back to the in-thread download. */
export function workerFetch({cacheName,createWorker=()=>new Worker(new URL('./download-worker.js',import.meta.url),{type:'module'})}){
 return async(cache,file,{signal,onProgress=()=>{}}={})=>{
  if(await cache.match(file.url))return false;
  if(signal?.aborted)throw new DOMException('Abgebrochen','AbortError');
  return new Promise((resolve,reject)=>{
  let worker,started=false;
  try{worker=createWorker();}catch(error){return reject(Object.assign(Error('worker-failed'),{code:'worker-failed',cause:error}));}
  const end=(fn,value)=>{signal?.removeEventListener('abort',stop);try{worker.terminate();}catch{}fn(value);};
  const stop=()=>{try{worker.postMessage({t:'abort'});}catch{}};
  signal?.addEventListener('abort',stop,{once:true});
  worker.onmessage=event=>{
   const m=event.data;started=true;
   if(m.t==='progress')onProgress(m.loaded);
   else if(m.t==='done')end(resolve,m.fetched);
   else if(m.t==='error'){const error=m.name==='AbortError'?new DOMException(m.message,'AbortError'):Object.assign(Error(m.message),{code:m.code});end(reject,error);}
  };
  worker.onerror=event=>{event.preventDefault?.();end(reject,started?Object.assign(Error('Der Download-Prozess wurde unerwartet beendet.'),{code:'unreachable'}):Object.assign(Error('worker-failed'),{code:'worker-failed'}));};
  worker.postMessage({t:'start',cacheName,file});
  });
 };
}
/* Downloads every missing file of `model`. onProgress({loaded,total,phase}) with phase download -> verify -> ready (error is thrown, never reported as progress).
 * Resolves true when something was downloaded, false when the model was already complete. */
export async function installModel({cache,model,signal,onProgress=()=>{},estimate,fetchFile=downloadVerified}){
 const total=modelBytes(model),missing=await missingBytes(cache,model);
 if(!missing){onProgress({loaded:total,total,phase:'ready'});return false;}
 if(estimate){const {usage,quota}=await estimate();assertQuota({missing,usage,quota});}
 let done=0;
 for(const file of model.files){
  if(await cache.match(file.url)){done+=file.bytes;continue;}
  if(signal?.aborted)throw new DOMException('Abgebrochen','AbortError');
  onProgress({loaded:done,total,phase:'download'});
  await fetchFile(cache,file,{signal,onProgress:loaded=>onProgress({loaded:done+loaded,total,phase:loaded>=file.bytes?'verify':'download'})});
  done+=file.bytes;
 }
 onProgress({loaded:total,total,phase:'ready'});
 return true;
}
