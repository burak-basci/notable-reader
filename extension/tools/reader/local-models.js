/* beNotable! Reader · model management and synthesis of the file view's own engine (own code MIT; combined neural package GPL-3.0-or-later).
   Only the export run (audiobook, in the file tab) and the engine measurements use it; PLAYBACK is the session's pipeline in the engine host. */
import {MODELS,modelBytes as totalBytes} from './neural-models.js';
import {TtsEngine} from '../../engine/tts-engine.js';
const IDLE_UNLOAD_MS=90000;
export class LocalModels extends EventTarget{
 /* Model management and synthesis run on the shared engine (extension/engine): WASM threads where available, word times, one warm worker, 1.0x synthesis (tempo at playback). */
 constructor(engine=new TtsEngine()){super();this.engine=engine;this.installed=new Set();this.downloading=false;this.abort=null;this.generation=0;this.idleUnload=false;this.pending=0;engine.setIdleUnload(IDLE_UNLOAD_MS);engine.addEventListener('voiceschanged',()=>{this.installed=new Set(engine.installedIds);this.dispatchEvent(new Event('voiceschanged'));});}
 event(message,error=false){this.dispatchEvent(new CustomEvent('status',{detail:{message,error}}));}
 async restore(){
  if(!('caches'in globalThis))return;
  this.installed=await this.engine.installed();
  this.dispatchEvent(new Event('voiceschanged'));
 }
 voices(){return [...this.installed].map(id=>({...MODELS[id],name:`${MODELS[id].name} · KI auf diesem Gerät`}));}
 async install(id){
  if(this.downloading)throw Error('Ein Modelldownload läuft bereits.');
  const model=MODELS[id];if(!model)throw Error('Unbekanntes Sprachmodell.');
  if(!isSecureContext||!('caches'in globalThis))throw Error('Lokale KI-Stimmen benötigen HTTPS oder eine installierte Erweiterung.');
  this.downloading=true;this.abort=new AbortController();const signal=this.abort.signal,total=totalBytes(model);
  try{
   this.event(`Lade ${model.name} · 0 %`);
   await this.engine.install(id,{signal,onProgress:p=>{const done=Math.min(total,p.loaded??0);this.event(`Lade ${model.name} · ${Math.round(done/total*100)} % · ${(done/1e6).toLocaleString('de-DE',{maximumFractionDigits:1})} MB`);}});
   this.installed=new Set(this.engine.installedIds);this.event(`${model.name} ist lokal gespeichert. Stimme wählen und „Vorlesen“ starten.`);this.dispatchEvent(new Event('voiceschanged'));
  }catch(error){this.event(error.name==='AbortError'?'Modelldownload abgebrochen.':error.message,true);throw error;}
  finally{this.downloading=false;this.abort=null;}
 }
 cancelDownload(){this.abort?.abort();}
 async clear(){
  this.cancelDownload();await this.engine.clear();this.installed.clear();this.dispatchEvent(new Event('voiceschanged'));this.event('Lokale KI-Modelle wurden von diesem Gerät gelöscht.');
 }
 /* Deletes one model; files shared with another installed model (Kokoro style/tokenizer) stay. */
 async remove(id){
  const model=MODELS[id];if(!model||!('caches'in globalThis))return;
  await this.engine.remove(id);this.installed=new Set(this.engine.installedIds);this.dispatchEvent(new Event('voiceschanged'));this.event(`${model.name} wurde von diesem Gerät gelöscht.`);
 }
 /* Optional: release the model memory after a quiet period; the next section reloads it from the local cache. */
 setIdleUnload(enabled){this.idleUnload=enabled===true;this.engine.setIdleUnload(this.idleUnload?IDLE_UNLOAD_MS:0);}
 cancelSynthesis(){this.engine.cancel();}
 terminate(){this.engine.terminate();}
 /* rate is accepted for compatibility and ignored: synthesis is always 1.0x, Speech applies the tempo while playing (preservesPitch). */
 async synthesize(id,text,rate){
  if(!this.installed.has(id))throw Error('Bitte das Sprachmodell zuerst ausdrücklich herunterladen.');
  this.pending++;
  try{
   this.event(`${MODELS[id].name} berechnet den nächsten Abschnitt lokal …`);
   const result=await this.engine.synthesize({modelId:id,text,generation:++this.generation,normalize:this.normalize!==false});
   const audio={samples:result.pcm,sampleRate:result.sampleRate,sampleCount:result.pcm.length,duration:result.durationSec,peak:result.peak,milliseconds:result.ms,stats:result.stats,wordTimings:result.wordTimings,timingKind:result.timingKind};
   this.dispatchEvent(new CustomEvent('audio',{detail:{id,sampleCount:audio.sampleCount,sampleRate:audio.sampleRate,duration:audio.duration,peak:audio.peak,milliseconds:audio.milliseconds}}));
   return audio;
  }finally{this.pending--;}
 }
}
export {MODELS,totalBytes};
