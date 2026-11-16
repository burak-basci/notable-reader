/* beNotable! Reader engine · model store · own code MIT.
 * Model files live in the Cache API under the same cache name and URL keys as the reader page, so an already installed
 * model is found by both. The worker reads the files itself (no extra main-thread copy). */
import {MODEL_CACHE,MODELS} from './registry.js';
import {installModel,workerFetch} from './download.js';
import {downloadVerified} from '../../tools/reader/neural-download.js';
import {SUPERSEDED_URLS} from '../../tools/reader/neural-models.js';
const norm=url=>{try{return new URL(url).href;}catch{return String(url);}};
export class ModelStore{
 constructor({cacheStorage=globalThis.caches,storage=globalThis.navigator?.storage,cacheName=MODEL_CACHE,worker=typeof Worker==='function'}={}){this.cacheStorage=cacheStorage;this.storage=storage;this.cacheName=cacheName;this.persistAsked=false;this.worker=worker;this.busy=0;this.known=null;}
 get available(){return !!this.cacheStorage;}
 async cache(){if(!this.cacheStorage)throw Object.assign(new Error('Lokale KI-Stimmen benötigen eine installierte Erweiterung oder HTTPS.'),{code:'no-cache'});return this.cacheStorage.open(this.cacheName);}
 /* All stored URLs with ONE cache.keys() call instead of one match() per model file (225 voices = 600 calls). */
 async urls(){const cache=await this.cache();return new Set((await cache.keys()).map(request=>norm(typeof request==='string'?request:request.url)));}
 async has(model){
  /* during a download every read of this cache waits behind the write: answer from the set known before it started */
  if(this.busy&&this.known)return this.known.has(model.id);
  const urls=await this.urls();return model.files.every(file=>urls.has(norm(file.url)));
 }
 /* While a download writes into this cache the browser blocks EVERY read of that cache (measured: match() waits up to 7 s behind a 700 MB write), so the voice list, the
  * "is this voice there?" check and the host's answers would hang for that long. During an install the last known answer is used: it can not change before the install ends. */
 async installed(models=Object.values(MODELS)){
  if(!this.available)return new Set();
  const mine=new Set(models.map(model=>model.id));
  if(this.busy&&this.known)return new Set([...this.known].filter(id=>mine.has(id)));
  const urls=await this.urls(),ids=new Set();
  for(const model of models)if(model.files.every(file=>urls.has(norm(file.url))))ids.add(model.id);
  if(models.length===Object.keys(MODELS).length)this.known=new Set(ids);
  return ids;
 }
 estimate(){return this.storage?.estimate?this.storage.estimate().then(e=>({usage:e.usage,quota:e.quota})):Promise.resolve({});}
 /* Asks once for durable storage so the browser does not evict a 300 MB model under pressure; a refusal is harmless. */
 async persist(){
  if(this.persistAsked||!this.storage?.persist)return this.storage?.persisted?this.storage.persisted():false;
  this.persistAsked=true;try{return await this.storage.persist();}catch{return false;}
 }
 async install(model,{signal,onProgress}={}){
  await this.installed().catch(()=>{});   /* remember what is there before the cache is busy with the write */
  this.busy++;
  try{return await this.installNow(model,{signal,onProgress});}finally{this.busy--;this.known=null;}
 }
 async installNow(model,{signal,onProgress}={}){
  const cache=await this.cache(),viaWorker=this.worker?workerFetch({cacheName:this.cacheName}):null;
  /* Hash and cache writes in a worker (host page stays responsive); a worker that can not start falls back to the in-thread download once. */
  const fetchFile=viaWorker?async(...args)=>{try{return await viaWorker(...args);}catch(error){if(error?.code!=='worker-failed')throw error;this.worker=false;return downloadVerified(...args);}}:downloadVerified;
  const changed=await installModel({cache,model,signal,onProgress,estimate:()=>this.estimate(),fetchFile});
  if(changed)await this.persist();
  return changed;
 }
 /* Deletes one model's files; files another installed model still needs (Kokoro style/tokenizer) stay. */
 async remove(model,keepModels=[]){
  const cache=await this.cache(),urls=m=>m.files.map(file=>file.url).sort().join('\n'),mine=urls(model);
  /* Voices of one engine (Kitten: 8 voices in one file set) are one installation: a sibling with the identical file set does not keep the files alive, otherwise removing never frees anything. */
  const keep=new Set(keepModels.filter(other=>other.id!==model.id&&urls(other)!==mine).flatMap(other=>other.files.map(file=>file.url)));
  for(const file of model.files)if(!keep.has(file.url))await cache.delete(file.url);
 }
 /* One-time, failure-tolerant cleanup of files no current model uses (former revisions of retrained voices, ~63 MB
  * each). Deletes only URLs in the superseded list AND not referenced by any model in `models` (checked twice on
  * purpose). Does nothing (false) while a download runs here or isBusy() reports playback/synthesis/download. The
  * "done" marker lives in a small second cache (works in the offscreen document, which has no chrome.storage); any
  * failure leaves it unset, so the next call retries. Never throws; no URLs leave this function. */
 async pruneSuperseded({isBusy=()=>false,urls=SUPERSEDED_URLS,models=MODELS}={}){
  const busy=()=>this.busy>0||!!isBusy();
  this.pruneStats={deleted:0,failed:0};
  if(!this.available||busy())return false;
  try{
   const marker=`https://notable.invalid/pruned-superseded/${urls.length}`;
   const meta=await this.cacheStorage.open(this.cacheName+'-meta');
   if(await meta.match(marker))return true;
   const old=new Set(urls.map(norm)),files=Object.values(models).flatMap(model=>model.files);
   const used=new Set(files.map(file=>norm(file.url)));
   const cache=await this.cache();
   for(const request of await cache.keys()){
    const url=norm(typeof request==='string'?request:request.url);
    if(!old.has(url)||used.has(url))continue;
    if(busy())return false;
    try{if(await cache.delete(request))this.pruneStats.deleted++;}catch{this.pruneStats.failed++;}
   }
   if(this.pruneStats.failed)return false;
   await meta.put(marker,new Response('1'));return true;
  }catch{this.pruneStats.failed++;return false;}
 }
 async clearAll(){if(this.available)await this.cacheStorage.delete(this.cacheName);}
 /* Bytes held by the model cache = exact registered size of every stored file (never reads the files back into memory),
  * plus quota and persistence of the origin. */
 async usage(){
  const seen=new Set();let bytes=0;
  if(this.available&&await this.cacheStorage.has(this.cacheName)){
   const urls=this.busy&&this.known?null:await this.urls();      /* busy: from the last known installed set, never from the cache that is being written */
   for(const model of Object.values(MODELS))if(urls?model.files.some(file=>urls.has(norm(file.url))):this.known.has(model.id))for(const file of model.files)if(!seen.has(file.url)&&(!urls||urls.has(norm(file.url)))){seen.add(file.url);bytes+=file.bytes;}
  }
  const {quota}=await this.estimate();
  return {bytes,quota,persisted:this.storage?.persisted?await this.storage.persisted():false};
 }
}
