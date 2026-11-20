/* Streaming, hash-verified model download · own code MIT.
 * Bytes flow network -> incremental SHA-256 -> Cache API without ever being collected in memory,
 * so the peak is a few chunks instead of 1-3x the model size. */
const K=Uint32Array.from([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
export class Sha256{
 constructor(){this.h=Uint32Array.from([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);this.w=new Uint32Array(64);this.block=new Uint8Array(64);this.filled=0;this.length=0;}
 compress(bytes,offset){
  const w=this.w,h=this.h;
  for(let i=0;i<16;i++,offset+=4)w[i]=(bytes[offset]<<24|bytes[offset+1]<<16|bytes[offset+2]<<8|bytes[offset+3])>>>0;
  for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2],s0=(a>>>7|a<<25)^(a>>>18|a<<14)^(a>>>3),s1=(b>>>17|b<<15)^(b>>>19|b<<13)^(b>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)|0;}
  let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
  for(let i=0;i<64;i++){
   const t1=(hh+((e>>>6|e<<26)^(e>>>11|e<<21)^(e>>>25|e<<7))+((e&f)^(~e&g))+K[i]+w[i])|0,t2=(((a>>>2|a<<30)^(a>>>13|a<<19)^(a>>>22|a<<10))+((a&b)^(a&c)^(b&c)))|0;
   hh=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
  }
  h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=hh;
 }
 update(data){
  let offset=0;this.length+=data.length;
  if(this.filled){const take=Math.min(64-this.filled,data.length);this.block.set(data.subarray(0,take),this.filled);this.filled+=take;offset=take;if(this.filled===64){this.compress(this.block,0);this.filled=0;}}
  for(;offset+64<=data.length;offset+=64)this.compress(data,offset);
  if(offset<data.length){this.block.set(data.subarray(offset),0);this.filled=data.length-offset;}
  return this;
 }
 digest(){
  const bits=this.length*8,pad=new Uint8Array((this.filled<56?64:128)-this.filled);pad[0]=0x80;
  const view=new DataView(pad.buffer);view.setUint32(pad.length-8,Math.floor(bits/2**32));view.setUint32(pad.length-4,bits>>>0);
  this.update(pad);
  return Array.from(this.h,value=>value.toString(16).padStart(8,'0')).join('');
 }
}
export const partialKey=url=>url+(url.includes('?')?'&':'?')+'notable-partial=1';
const STALL_MS=45000,RETRIES=2,BACKOFF_MS=[2000,8000],MAX_RETRY_AFTER_MS=30000;
const coded=(message,code,retry=false)=>Object.assign(Error(message),{code,retry});
const pause=(ms,signal)=>new Promise((resolve,reject)=>{
 if(signal?.aborted)return reject(new DOMException('Abgebrochen','AbortError'));
 const stop=()=>{clearTimeout(timer);reject(new DOMException('Abgebrochen','AbortError'));};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
 signal?.addEventListener('abort',stop,{once:true});
});
/* Stores one verified file under file.url. Resolves true when it came from the network, false when already cached.
 * ONE write into the final key: the body stream checks size and SHA-256 itself and ERRORS at the very end when either is wrong, and Cache.put commits only after it has
 * read the whole body (Cache API spec: put reads the body fully, then runs the batch operation), so a rejected file is never stored and no unverified byte is readable.
 * (Before: a temporary key plus a second put of the same bytes. Every write to a cache blocks all match() calls on that cache in the browser; two 700 MB writes meant
 * seconds in which the voice list, the "is this voice here?" check and every model load of the reader waited.) */
/* A stalled connection (sleep, network switch) gives no error at all: no new byte for `stallMs` aborts the attempt
 * with code 'stalled'. Stalls, dropped connections and 408/429/5xx answers are retried `retries` times (Retry-After
 * honoured, capped); everything else (wrong size or fingerprint, 4xx, full disk, the user's abort) fails at once.
 * Each attempt starts the file from its first byte: the fingerprint is computed while streaming into the one cache
 * write, so a resumed range could not be verified. */
export async function downloadVerified(cache,file,options={}){
 const {signal,retries=RETRIES,backoffMs=BACKOFF_MS}=options;
 for(let attempt=0;;attempt++){
  try{return await downloadOnce(cache,file,options);}
  catch(error){
   if(signal?.aborted||error?.name==='AbortError'||error?.retry!==true||attempt>=retries)throw error;
   await pause(error.retryAfterMs??backoffMs[Math.min(attempt,backoffMs.length-1)],signal);
  }
 }
}
async function downloadOnce(cache,file,{signal,onProgress=()=>{},messages={},stallMs=STALL_MS,headers={}}={}){
 if(await cache.match(file.url))return false;
 const text={size:'Der Modelldownload überschreitet die geprüfte Dateigröße.',incomplete:'Der Modelldownload ist unvollständig. Bitte erneut versuchen.',hash:'Der Modell-Fingerabdruck stimmt nicht. Die Datei wurde verworfen.',offline:'Der Modellanbieter ist derzeit nicht erreichbar.',...messages};
 const noNetwork='Kein Netz: Das Sprachmodell konnte nicht geladen werden. '+
  'Verbinde dich mit dem Internet und versuche es erneut.';
 Object.assign(text,{noNetwork,stalled:'The model download stalled.',quota:'Not enough storage for the voice model.'});
 Object.assign(text,messages);
 const inner=new AbortController(),relay=()=>inner.abort();signal?.addEventListener('abort',relay,{once:true});
 let timer=0,stalled=false,reader=null;
 /* abort the request and release a pending read: some bodies do not error on abort */
 const stall=()=>{stalled=true;inner.abort();reader?.cancel().catch(()=>{});};
 const arm=()=>{clearTimeout(timer);timer=setTimeout(stall,stallMs);};
 const lost=error=>stalled?coded(text.stalled,'stalled',true)
  :signal?.aborted?error:coded(text.incomplete,'incomplete',true);
 try{
  arm();
  let response;
  const init={credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:inner.signal};
  try{response=await fetch(file.url,init);}
  catch(error){
   if(stalled)throw coded(text.stalled,'stalled',true);
   if(error?.name==='AbortError'||signal?.aborted)throw error;
   const offline=globalThis.navigator?.onLine===false;
   throw coded(offline?text.noNetwork:text.offline,offline?'offline':'unreachable',!offline);
  }
  if(!response.ok||!response.body){
   const status=response.status,again=status===408||status===429||status>=500;
   const after=Number(response.headers?.get?.('Retry-After'));
   const failure=coded(text.offline,'unreachable',again);
   if(again&&after>0)failure.retryAfterMs=Math.min(after*1000,MAX_RETRY_AFTER_MS);
   throw failure;
  }
  reader=response.body.getReader();const hash=new Sha256();let loaded=0,lastReport=0,failure=null;
  /* browsers replace the error of a failed stream by their own (Chromium: TypeError), so the original is kept here */
  const fail=(controller,error)=>{failure=error;controller.error(error);};
  const body=new ReadableStream({
   async pull(controller){
    let chunk;try{chunk=await reader.read();}catch(error){fail(controller,lost(error));return;}
    arm();
    if(chunk.done){
     if(stalled){fail(controller,coded(text.stalled,'stalled',true));return;}
     if(loaded!==file.bytes){fail(controller,coded(text.incomplete,'incomplete',true));return;}
     onProgress(loaded);
     if(hash.digest()!==file.sha256){fail(controller,coded(text.hash,'hash'));return;}
     if(signal?.aborted){fail(controller,new DOMException('Abgebrochen','AbortError'));return;}
     controller.close();return;
    }
    loaded+=chunk.value.byteLength;
    if(loaded>file.bytes){reader.cancel().catch(()=>{});fail(controller,coded(text.size,'size'));return;}
    hash.update(chunk.value);controller.enqueue(chunk.value);
    const now=performance.now();if(now-lastReport>120||loaded===file.bytes){lastReport=now;onProgress(loaded);}
   },
   cancel(reason){return reader.cancel(reason);}
  });
  const stored={'Content-Type':'application/octet-stream','X-Notable-SHA256':file.sha256,...headers};
  try{await cache.put(file.url,new Response(body,{headers:stored}));}
  catch(error){
   if(failure)throw failure;
   /* Chromium private windows refuse files over ~300 MB in the Cache API with 'UnknownError: Unexpected internal error' (measured): it is the storage limit */
   if(error?.name==='QuotaExceededError'||error?.name==='UnknownError')throw coded(text.quota,'quota');
   throw error;
  }
  return true;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',relay);}
}
