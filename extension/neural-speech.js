/* Notable Reader optional local speech · own code MIT; combined neural package GPL-3.0-or-later. */
import {MODELS,MODEL_CACHE,RUNTIME_ASSETS} from './neural-models.js';
const totalBytes=model=>model.files.reduce((sum,file)=>sum+file.bytes,0);
export class LocalModels extends EventTarget{
 constructor(){super();this.installed=new Set();this.worker=null;this.workerKind='';this.requests=new Map();this.serial=0;this.sequence=Promise.resolve();this.downloading=false;this.abort=null;this.epoch=0;}
 event(message,error=false){this.dispatchEvent(new CustomEvent('status',{detail:{message,error}}));}
 async restore(){
  if(!('caches'in globalThis))return;
  const cache=await caches.open(MODEL_CACHE);
  for(const model of Object.values(MODELS))if((await Promise.all(model.files.map(file=>cache.match(file.url)))).every(Boolean))this.installed.add(model.id);
  this.dispatchEvent(new Event('voiceschanged'));
 }
 voices(){return [...this.installed].map(id=>({...MODELS[id],name:`${MODELS[id].name} · KI auf diesem Gerät`}));}
 async install(id){
  if(this.downloading)throw Error('Ein Modelldownload läuft bereits.');
  const model=MODELS[id];if(!model)throw Error('Unbekanntes Sprachmodell.');
  if(!isSecureContext||!('caches'in globalThis))throw Error('Lokale KI-Stimmen benötigen HTTPS oder eine installierte Erweiterung.');
  this.downloading=true;this.abort=new AbortController();const epoch=this.epoch,signal=this.abort.signal;let loadedBefore=0;
  try{
   const cache=await caches.open(MODEL_CACHE);
   if(location.protocol!=='chrome-extension:')for(const path of RUNTIME_ASSETS){
    const url=new URL('./'+path,import.meta.url).href;
    if(!await cache.match(url)){this.event('Lokale Sprachmodule werden gespeichert · einmalig zusätzlich ca. 30 MB …');const response=await fetch(url,{signal});if(!response.ok)throw Error('Ein lokales Sprachmodul konnte nicht geladen werden.');await cache.put(url,response);}
   }
   for(const file of model.files){
    const stored=await cache.match(file.url);if(stored){loadedBefore+=file.bytes;continue;}
    this.event(`Lade ${model.name} · ${Math.round(loadedBefore/totalBytes(model)*100)} %`);
    const response=await fetch(file.url,{credentials:'omit',referrerPolicy:'no-referrer',signal:this.abort.signal});
    if(!response.ok)throw Error('Der Modellanbieter ist derzeit nicht erreichbar.');
    const stream=response.body.getReader(),parts=[];let loaded=0;
    while(true){const {done,value}=await stream.read();if(done)break;loaded+=value.byteLength;if(loaded>file.bytes){await stream.cancel();throw Error('Der Modelldownload überschreitet die geprüfte Dateigröße.');}parts.push(value);this.event(`Lade ${model.name} · ${Math.round((loadedBefore+loaded)/totalBytes(model)*100)} % · ${((loadedBefore+loaded)/1e6).toLocaleString('de-DE',{maximumFractionDigits:1})} MB`);}
    if(loaded!==file.bytes)throw Error('Der Modelldownload ist unvollständig. Bitte erneut versuchen.');
    const bytes=await new Blob(parts).arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==file.sha256)throw Error('Der Modell-Fingerabdruck stimmt nicht. Die Datei wurde verworfen.');
    if(signal.aborted||epoch!==this.epoch)throw new DOMException('Abgebrochen','AbortError');
    await cache.put(file.url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream','X-Notable-SHA256':digest}}));loadedBefore+=loaded;
   }
   if(signal.aborted||epoch!==this.epoch)throw new DOMException('Abgebrochen','AbortError');
   this.installed.add(id);this.event(`${model.name} ist lokal gespeichert. Stimme wählen und „Vorlesen“ starten.`);this.dispatchEvent(new Event('voiceschanged'));
  }catch(error){this.event(error.name==='AbortError'?'Modelldownload abgebrochen.':error.message,true);throw error;}
  finally{this.downloading=false;this.abort=null;}
 }
 cancelDownload(){this.abort?.abort();}
 async clear(){
  this.epoch++;this.cancelDownload();this.terminate();await caches.delete(MODEL_CACHE);this.installed.clear();this.dispatchEvent(new Event('voiceschanged'));this.event('Lokale KI-Modelle wurden von diesem Gerät gelöscht.');
 }
 terminate(){this.worker?.terminate();this.worker=null;this.workerKind='';for(const request of this.requests.values())request.reject(new Error('Die lokale Stimme wurde angehalten.'));this.requests.clear();}
 call(message,transfer=[]){return new Promise((resolve,reject)=>{const id=++this.serial;this.requests.set(id,{resolve,reject});this.worker.postMessage({...message,id},transfer);});}
 async initialize(id){
  if(this.workerKind===id&&this.worker)return;
  this.terminate();const model=MODELS[id],cache=await caches.open(MODEL_CACHE),payload={action:'init',kind:id},transfer=[];
  this.event(`${model.name} wird auf diesem Gerät vorbereitet …`);
  for(const file of model.files){const response=await cache.match(file.url);if(!response)throw Error('Bitte das lokale Sprachmodell zuerst über den Downloadknopf laden.');if(['config','tokenizer'].includes(file.role))payload[file.role]=await response.json();else{const value=await response.arrayBuffer();payload[file.role]=value;transfer.push(value);}}
  this.worker=new Worker(new URL('./neural-worker.js',import.meta.url),{type:'module'});
  this.worker.addEventListener('message',event=>{const request=this.requests.get(event.data.id);if(!request)return;this.requests.delete(event.data.id);event.data.ok?request.resolve(event.data):request.reject(new Error(event.data.error));});
  this.worker.addEventListener('error',()=>{this.event('Die lokale KI-Stimme konnte nicht geladen werden. Bitte Browser aktualisieren oder eine Systemstimme wählen.',true);this.terminate();});
  await this.call(payload,transfer);this.workerKind=id;
 }
 synthesize(id,text,rate){
  const work=this.sequence.catch(()=>{}).then(async()=>{if(!this.installed.has(id))throw Error('Bitte das Sprachmodell zuerst ausdrücklich herunterladen.');await this.initialize(id);this.event(`${MODELS[id].name} berechnet den nächsten Abschnitt lokal …`);const audio=await this.call({action:'synthesize',text,rate});this.dispatchEvent(new CustomEvent('audio',{detail:{id,sampleCount:audio.sampleCount,sampleRate:audio.sampleRate,duration:audio.duration,peak:audio.peak,milliseconds:audio.milliseconds}}));return audio;});this.sequence=work;return work;
 }
}
function wav(samples,sampleRate){const bytes=new ArrayBuffer(44+samples.length*2),view=new DataView(bytes);const text=(offset,value)=>{for(let n=0;n<value.length;n++)view.setUint8(offset+n,value.charCodeAt(n));};text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.max(-1,Math.min(1,samples[i]))*(samples[i]<0?32768:32767),true);return new Blob([bytes],{type:'audio/wav'});}
export class Speech extends EventTarget{
 constructor(models,system=globalThis.speechSynthesis){super();this.models=models;this.system=system;this.generation=0;this.audio=null;this.url='';this.lastAudio=null;this.prepared=null;const changed=()=>this.dispatchEvent(new Event('voiceschanged'));system?.addEventListener('voiceschanged',changed);models.addEventListener('voiceschanged',changed);}
 getVoices(){return [...(this.system?.getVoices()||[]),...this.models.voices()];}
 cancel(){this.generation++;this.prepared=null;this.system?.cancel();if(this.audio){this.audio.pause();this.audio.src='';this.audio=null;}if(this.url){URL.revokeObjectURL(this.url);this.url='';}}
 prefetch(text,voice,rate){const model=Object.values(MODELS).find(model=>model.voiceURI===voice?.voiceURI);if(!model)return;const promise=this.models.synthesize(model.id,text,rate);promise.catch(()=>{});this.prepared={id:model.id,text,rate,promise};}
 speak(utterance){
  const model=Object.values(MODELS).find(model=>model.voiceURI===utterance.voice?.voiceURI);
  if(!model){const native=new globalThis.SpeechSynthesisUtterance(utterance.text);native.voice=utterance.voice;native.lang=utterance.lang;native.rate=utterance.rate;native.volume=utterance.volume;native.onboundary=utterance.onboundary;native.onend=utterance.onend;native.onerror=utterance.onerror;native.onstart=utterance.onstart;this.system?.speak(native);return;}
  const gen=this.generation;
  const prepared=this.prepared;this.prepared=null;
  const work=prepared&&prepared.id===model.id&&prepared.text===utterance.text&&prepared.rate===utterance.rate?prepared.promise:this.models.synthesize(model.id,utterance.text,utterance.rate);
  work.then(result=>{
   if(gen!==this.generation)return;
   this.lastAudio={sampleCount:result.sampleCount,duration:result.duration,peak:result.peak,sampleRate:result.sampleRate};
   this.url=URL.createObjectURL(wav(result.samples,result.sampleRate));const audio=new Audio(this.url);this.audio=audio;audio.volume=utterance.volume;
   audio.addEventListener('ended',()=>{if(gen===this.generation){URL.revokeObjectURL(this.url);this.url='';this.audio=null;utterance.onend?.();}});
   audio.addEventListener('error',()=>{if(gen===this.generation)utterance.onerror?.({error:'audio-error'});});
   audio.play().then(()=>{if(gen===this.generation){this.models.event(`${model.name} liest lokal vor.`);utterance.onstart?.();}}).catch(()=>{if(gen===this.generation)utterance.onerror?.({error:'not-allowed'});});
  }).catch(error=>{if(gen===this.generation){this.models.event(error.message,true);utterance.onerror?.({error:'synthesis-failed'});}});
 }
}
export class Utterance{constructor(text){this.text=text;this.voice=null;this.lang='';this.rate=1;this.volume=1;}}
export {MODELS,totalBytes};
