import {downloadVerified} from '../tools/reader/neural-download.js';
export const MODEL_CACHE='benotable-local-explain-granite4-350m-62fc8f3-q4-v1';
/* The model of the 2.4 releases (Qwen2.5-0.5B-Instruct q8) as 'legacy': no longer offered or downloaded; a copy users
   already have keeps working until a current model is installed, then the engine host frees it. */
export const LEGACY_CACHE='benotable-local-explain-qwen-22942cb-v1';
/* Model tiers of the local explanation, each one pinned manifest (revision + SHA-256 per file) and its own cache, so one
   can be removed without the other. All run on the processor (WASM).
   'small' = IBM Granite 4.0 350M q4 (onnx-community conversion of ibm-granite/granite-4.0-350m, Apache-2.0, ~580 MB):
   in the 2.5 measurement on ten real pages (18 English, 26 German explanation sentences) 12 English sentences were
   usable against none with the 2.4 model, with shorter steps (median ~8 s against ~11 s) and less memory (renderer
   peak ~2.7 GB against ~3.1 GB); German stays unusable with every small model measured. Not offered: Qwen3.5 0.8B
   (~5x the time per step in WASM), Granite 4.0 1B (better German, but ~5x the time and ~4.8 GB), Qwen3.5 2B (ran a
   14 GB machine out of memory). 'better' has no manifest (not offered): Qwen3
   0.6B was not clearly better than 'small' (English alike, German still mostly unusable) and needed ~3.7 GB and more
   time per step; a pinned manifest here turns the second button on again. */
export const TIERS=Object.freeze({small:{manifest:'./model-manifest.json',cache:MODEL_CACHE},better:{manifest:null,cache:'benotable-local-explain-better-v1'},legacy:{manifest:'./model-manifest-legacy.json',cache:LEGACY_CACHE,offered:false}});
export const offered=tier=>!!TIERS[tier]?.manifest&&TIERS[tier].offered!==false;
const tierOf=tier=>TIERS[tier]?tier:'small';
export function cacheName(tier='small'){return TIERS[tierOf(tier)].cache;}
export async function manifest(tier='small'){const file=TIERS[tierOf(tier)].manifest;if(!file)throw Object.assign(Error('Model tier not offered.'),{code:'unavailable'});return (await fetch(new URL(file,import.meta.url))).json();}
export async function installed(tier='small'){const m=await manifest(tier),c=await caches.open(cacheName(tier));return (await Promise.all(m.files.map(f=>c.match(f.url)))).every(Boolean);}
export async function removeModel(tier='small'){await caches.delete(cacheName(tier));}
/* Streams every file through the verified download of the voices (incremental SHA-256 into one cache write): the
   model is about 0.5 GB, buffering it plus a copy for the digest needed 1 to 1.5 GB of memory in this page. */
async function declaresUnlimitedStorage(){
 const listed=globalThis.chrome?.runtime?.getManifest?.()?.permissions;if(Array.isArray(listed)&&listed.includes('unlimitedStorage'))return true;
 try{const m=await(await fetch(new URL('../manifest.json',import.meta.url))).json();return Array.isArray(m?.permissions)&&m.permissions.includes('unlimitedStorage');}catch{return false;}
}
export async function downloadModel({signal,onProgress=()=>{},tier='small'}={}){
 const m=await manifest(tier),c=await caches.open(cacheName(tier)),total=m.files.reduce((n,f)=>n+f.bytes,0);
 let missing=0;for(const f of m.files)if(!await c.match(f.url))missing+=f.bytes;
 /* The reported quota only stops a download where it is real: with "unlimitedStorage" (this extension's manifest) it is
    not, and Brave reports a fixed 2 GiB there (measured: 3.2 GB were written fine), which refused the model as soon as
    voices plus the 2.4 model filled 1.5 GB. Then only a write that really fails (QuotaExceededError) says "quota".
    Read from the manifest (a required permission is granted at install): the download runs in the offscreen document,
    which has no chrome.permissions, and in Brave a check through runtime.getManifest alone still refused (real run),
    so the manifest file itself is read. */
 const estimate=await globalThis.navigator?.storage?.estimate?.().catch(()=>null);
 const tight=estimate?.quota!==undefined&&estimate.quota-estimate.usage<missing*1.1;
 signal?.throwIfAborted();
 if(tight&&!await declaresUnlimitedStorage())throw Object.assign(Error('Not enough free storage for the explanation model.'),{code:'quota'});   // asked only when the report would refuse
 let completed=0;
 for(const f of m.files){
  signal?.throwIfAborted();
  const type=f.path.endsWith('.json')?'application/json':'application/octet-stream';
  const headers={'Content-Type':type,'Content-Length':String(f.bytes)};
  const progress=loaded=>onProgress({loaded:completed+loaded,total});
  await downloadVerified(c,{url:f.url,bytes:f.bytes,sha256:f.sha256},{signal,headers,onProgress:progress});
  completed+=f.bytes;onProgress({loaded:completed,total});
 }
 signal?.throwIfAborted();return true;
}
