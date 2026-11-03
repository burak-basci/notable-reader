/* Notable Reader local audiobook export · Copyright (c) 2026 Burak Basci · MIT.
 * MP3 encoder is separately replaceable LGPL-3.0 software; see vendor/export/. */
const BLOCK=1152,BUFFER_BYTES=256*1024,MEMORY_LIMIT=32*1024*1024,JOB_PREFIX='notable-audiobook-';
const abortError=()=>new DOMException('Hörbuchexport abgebrochen. Es wurde keine fertige Datei gespeichert.','AbortError');
const check=signal=>{if(signal.aborted)throw abortError();};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));

// A generator, not a second full-book PCM/text array. Every non-whitespace
// character belongs to exactly one yielded span, including the final sentence.
export function* audiobookChunks(text,limit=230){
 if(typeof text!=='string'||!Number.isInteger(limit)||limit<2)throw new TypeError('Ungültiger Buchtext oder Abschnittsgrenze.');
 let cursor=0;
 while(cursor<text.length){
  while(cursor<text.length&&/\s/u.test(text[cursor]))cursor++;
  if(cursor===text.length)break;
  let end=Math.min(text.length,cursor+limit);
  if(end<text.length){
   const part=text.slice(cursor,end),boundaries=[...part.matchAll(/[.!?。！？]["'»”’)]*(?=\s)|\n/gu)];
   const sentence=boundaries.at(-1);let boundary=sentence?sentence.index+sentence[0].length:0;
   if(boundary<limit/3){const space=part.search(/\s+\S*$/u);boundary=space>limit/3?space+1:0;}
   if(boundary)end=cursor+boundary;
   if(/[\uD800-\uDBFF]/u.test(text[end-1]))end--;
  }
  const raw=text.slice(cursor,end),spoken=raw.trim();
  if(spoken)yield {text:spoken,start:cursor+raw.indexOf(spoken),end:cursor+raw.indexOf(spoken)+spoken.length};
  cursor=end;
 }
}
export function audiobookFilename(title='Hörbuch',format='mp3'){
 const name=Array.from(String(title).replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'').replace(/^[. ]+|[. ]+$/gu,'')).slice(0,110).join('')||'Hörbuch';
 return `${name.replace(/\.(mp3|wav)$/iu,'')}.${format}`;
}
function pcm16(samples){const result=new Int16Array(samples.length);for(let i=0;i<samples.length;i++){const value=Number.isFinite(samples[i])?Math.max(-1,Math.min(1,samples[i])):0;result[i]=Math.round(value*(value<0?32768:32767));}return result;}
function waveHeader(samples,rate){
 const bytes=new Uint8Array(44),view=new DataView(bytes.buffer),put=(at,text)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};
 put(0,'RIFF');view.setUint32(4,36+samples*2,true);put(8,'WAVE');put(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);put(36,'data');view.setUint32(40,samples*2,true);return bytes;
}
const bytesOf=value=>new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
function signalPromise(work,signal){return new Promise((resolve,reject)=>{const stop=()=>reject(abortError());if(signal.aborted){reject(abortError());return;}signal.addEventListener('abort',stop,{once:true});Promise.resolve(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});}
function storageError(error){return error?.name==='QuotaExceededError'?new Error('Der lokale Speicher ist voll. Bitte Speicher freigeben oder mit „Datei speichern“ direkt auf ein Laufwerk exportieren.'):error;}

async function database(){
 return new Promise((resolve,reject)=>{const request=indexedDB.open('notable-reader-audiobook-exports',1);request.onupgradeneeded=()=>request.result.createObjectStore('parts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Der Exportspeicher ist blockiert. Andere Reader-Tabs schließen und erneut versuchen.'));});
}
function transaction(db,mode,action){return new Promise((resolve,reject)=>{const tx=db.transaction('parts',mode);let value;try{value=action(tx.objectStore('parts'));}catch(error){reject(error);return;}tx.oncomplete=()=>resolve(value?.result);tx.onerror=tx.onabort=()=>reject(tx.error||value?.error||new Error('Der lokale Exportspeicher ist nicht verfügbar.'));});}
async function lease(id){
 if(!globalThis.navigator?.locks)return ()=>{};
 let release,acquired,failed;const ready=new Promise((resolve,reject)=>{acquired=resolve;failed=reject;}),lifetime=new Promise(resolve=>release=resolve);
 navigator.locks.request(id,async()=>{acquired();await lifetime;}).catch(failed);await ready;return release;
}
// Explicitly delete orphaned audio jobs, never an active export or a ready file
// still owned by another tab. Browser crash/close automatically releases locks.
export async function clearAudiobookStorage(){
 if(!globalThis.navigator?.locks)return {removed:0,skipped:0,unavailable:true,message:'Dieser Browser kann aktive Exporte nicht sicher unterscheiden. Temporäre Audiodaten lassen sich über die Website-Daten im Browser löschen.'};
 let removed=0,skipped=0;
 const unused=async(id,action)=>navigator.locks.request(id,{ifAvailable:true},async lock=>{if(!lock){skipped++;return;}await action();removed++;});
 if(navigator.storage?.getDirectory){try{const directory=await navigator.storage.getDirectory();for await(const [name,handle]of directory.entries())if(handle.kind==='file'&&name.startsWith(JOB_PREFIX))await unused(name,()=>directory.removeEntry(name));}catch(error){if(!['SecurityError','NotSupportedError'].includes(error.name))throw storageError(error);}}
 if(globalThis.indexedDB){const db=await database();try{const keys=await transaction(db,'readonly',store=>store.getAllKeys()),ids=new Set(keys.map(key=>key[0]).filter(id=>typeof id==='string'&&id.startsWith(JOB_PREFIX)));for(const id of ids)await unused(id,()=>transaction(db,'readwrite',store=>store.delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]))));}finally{db.close();}}
 return {removed,skipped,unavailable:false,message:`${removed} temporäre Hörbuchdateien gelöscht. ${skipped} aktive oder noch verwendete Exporte bleiben erhalten.`};
}
async function makeStorage(supplied,mime){
 if(supplied){if(typeof supplied.write!=='function'||typeof supplied.close!=='function'||typeof supplied.abort!=='function')throw new Error('Das Speicherziel unterstützt keinen sicheren Dateiexport.');return {kind:'file',write:data=>supplied.write(data),patch:async header=>{if(typeof supplied.seek==='function'){await supplied.seek(0);await supplied.write(header);}else await supplied.write({type:'write',position:0,data:header});},finish:async()=>{await supplied.close();return null;},discard:()=>supplied.abort(),cleanup:async()=>{}};}
 if(globalThis.navigator?.storage?.getDirectory){
  try{
   const directory=await navigator.storage.getDirectory(),name=JOB_PREFIX+crypto.randomUUID(),release=await lease(name);
   let writer,handle;try{handle=await directory.getFileHandle(name,{create:true});if(typeof handle.createWritable!=='function')throw new DOMException('Schreibbarer Dateispeicher ist nicht verfügbar.','NotSupportedError');writer=await handle.createWritable();}catch(error){await directory.removeEntry(name).catch(()=>{});release();throw error;}
   const cleanup=async()=>{try{await directory.removeEntry(name).catch(()=>{});}finally{release();}};
   return {kind:'opfs',write:data=>writer.write(data),patch:async header=>{await writer.seek(0);await writer.write(header);},finish:async()=>{await writer.close();const file=await handle.getFile();return file.slice(0,file.size,mime);},discard:async()=>{await writer.abort().catch(()=>{});await cleanup();},cleanup};
  }catch(error){if(!['SecurityError','NotSupportedError','InvalidStateError'].includes(error.name))throw storageError(error);}
 }
 if(globalThis.indexedDB){
  try{
  const db=await database(),id=JOB_PREFIX+crypto.randomUUID(),release=await lease(id),range=()=>IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]);let index=0,closed=false;
  const cleanup=async()=>{if(closed)return;try{await transaction(db,'readwrite',store=>store.delete(range()));}finally{db.close();closed=true;release();}};
  return {kind:'indexeddb',write:data=>transaction(db,'readwrite',store=>store.put(new Blob([data],{type:mime}),[id,index++])),patch:header=>transaction(db,'readwrite',store=>store.put(new Blob([header],{type:mime}),[id,0])),finish:async()=>{const parts=await transaction(db,'readonly',store=>store.getAll(range()));return new Blob(parts,{type:mime});},discard:cleanup,cleanup};
  }catch(error){if(!['SecurityError','NotSupportedError','InvalidStateError'].includes(error.name))throw storageError(error);}
 }
 // A real, explicit browser capability limit, not a word-count/paywall limit.
 const parts=[];let bytes=0;
 return {kind:'memory',write:async data=>{if(bytes+data.byteLength>MEMORY_LIMIT)throw new Error('Dieser Browser bietet keinen Dateispeicher. Für mehr als 32 MiB Audio bitte einen Browser mit Dateispeicher verwenden oder einzelne Kapitel exportieren.');bytes+=data.byteLength;parts.push(new Blob([data],{type:mime}));},patch:async header=>{parts[0]=new Blob([header],{type:mime});},finish:async()=>new Blob(parts,{type:mime}),discard:async()=>{parts.length=0;},cleanup:async()=>{parts.length=0;}};
}
class BufferedOutput{
 constructor(store){this.store=store;this.parts=[];this.pending=0;this.bytes=0;}
 async write(data){if(!data.byteLength)return;if(this.pending+data.byteLength>BUFFER_BYTES)await this.flush();const copy=new Uint8Array(data.byteLength);copy.set(bytesOf(data));this.parts.push(copy);this.pending+=copy.byteLength;this.bytes+=copy.byteLength;if(this.pending>=BUFFER_BYTES)await this.flush();}
 async flush(){if(!this.pending)return;const merged=new Uint8Array(this.pending);let offset=0;for(const part of this.parts){merged.set(part,offset);offset+=part.length;}await this.store.write(merged);this.parts=[];this.pending=0;}
}

export class AudiobookExport{
 constructor({models}){if(typeof models?.synthesize!=='function')throw new TypeError('Lokale KI-Stimmen fehlen.');this.models=models;this.running=false;this.committing=false;this.controller=null;}
 cancel(){if(this.running&&!this.committing)this.controller?.abort();}
 async exportBook({text,modelId,format='mp3',title='Hörbuch',signal,onProgress=()=>{},sink}={}){
  if(this.running)throw new Error('Ein Hörbuchexport läuft bereits.');
  const refuse=async error=>{await sink?.abort?.().catch(()=>{});throw error;};
  if(typeof text!=='string'||!text.trim())return refuse(new Error('Bitte zuerst einen Text oder ein vollständiges Buch öffnen.'));
  if(!['mp3','wav'].includes(format))return refuse(new Error('Bitte MP3 oder WAV als Audioformat wählen.'));
  if(!['piper','kokoro'].includes(modelId)||!this.models.installed?.has(modelId))return refuse(new Error('Für Audiodateien bitte zuerst eine lokale KI-Stimme ausdrücklich herunterladen. Gerätestimmen lassen sich nicht als Datei speichern.'));
  if(signal?.aborted)return refuse(abortError());
  this.running=true;const controller=new AbortController();this.controller=controller;const active=controller.signal;const cancel=()=>{if(!this.committing)controller.abort();};signal?.addEventListener('abort',cancel,{once:true});
  const stop=()=>this.models.cancelSynthesis?.();active.addEventListener('abort',stop,{once:true});
  let store,output,encoder,samples=0,sampleRate=0,completedChunks=0,totalChunks=0,processedCharacters=0;
  const mime=format==='mp3'?'audio/mpeg':'audio/wav',filename=audiobookFilename(title,format);
  const progress=(phase,message)=>{try{onProgress({phase,message,completedChunks,totalChunks,processedCharacters,totalCharacters:text.length,bytes:output?.bytes||0,samples,sampleRate,duration:sampleRate?samples/sampleRate:0,percent:phase==='done'?100:Math.min(99,Math.floor(processedCharacters/text.length*100))});}catch{/* A UI status handler cannot corrupt the audio file. */}};
  try{
   progress('preparing','Der vollständige Text wird für den lokalen Export vorbereitet …');
   for(const chunk of audiobookChunks(text)){totalChunks++;if(totalChunks%2000===0){await pause();check(active);}}
   if(!totalChunks)throw new Error('Der Text enthält keine vorlesbaren Zeichen.');
   const Mp3Encoder=format==='mp3'?(await import('./vendor/export/lamejs.js')).Mp3Encoder:null;check(active);
   store=await makeStorage(sink,mime);output=new BufferedOutput(store);check(active);
   if(format==='wav'){await output.write(waveHeader(0,22050));await output.flush();}
   for(const chunk of audiobookChunks(text)){
    check(active);progress('synthesizing',`Abschnitt ${completedChunks+1} von ${totalChunks} wird auf diesem Gerät gesprochen …`);
    const result=await signalPromise(this.models.synthesize(modelId,chunk.text,1),active);check(active);
    const pcm=result?.samples,rate=result?.sampleRate;
    if(!(pcm instanceof Float32Array)||!pcm.length||!Number.isInteger(rate)||rate<8000||rate>192000)throw new Error('Die lokale Stimme hat keine vollständigen Audiodaten geliefert.');
    let peak=0;for(const sample of pcm){if(!Number.isFinite(sample))throw new Error('Die lokale Stimme hat ungültige Audiodaten geliefert. Bitte den Export erneut starten.');peak=Math.max(peak,Math.abs(sample));}
    if(!peak&&/[\p{L}\p{N}]/u.test(chunk.text))throw new Error('Die lokale Stimme hat für diesen Text keine hörbaren Audiodaten geliefert.');
    if(sampleRate&&rate!==sampleRate)throw new Error('Die Abtastrate hat sich während des Exports geändert. Bitte erneut versuchen.');
    if(pcm.length>rate*180)throw new Error('Ein Sprachabschnitt ist unerwartet groß. Der Export wurde sicher angehalten.');
    if(!sampleRate){sampleRate=rate;if(Mp3Encoder)encoder=new Mp3Encoder(1,rate,64);}
    if(format==='wav'&&(samples+pcm.length)*2>0xffffffff-36)throw new Error('WAV-Dateien sind auf knapp 4 GiB begrenzt. Bitte das platzsparende MP3-Format wählen.');
    progress('encoding',`Abschnitt ${completedChunks+1} von ${totalChunks} wird als ${format.toUpperCase()} gespeichert …`);
    for(let offset=0,block=0;offset<pcm.length;offset+=BLOCK,block++){
     check(active);const integers=pcm16(pcm.subarray(offset,offset+BLOCK));
     if(encoder)await output.write(encoder.encodeBuffer(integers));else await output.write(bytesOf(integers));
     if(block%32===31){await pause();check(active);}
    }
    samples+=pcm.length;completedChunks++;processedCharacters=chunk.end;progress('synthesizing',`${completedChunks} von ${totalChunks} Abschnitten vollständig verarbeitet.`);
   }
   check(active);if(!samples||completedChunks!==totalChunks)throw new Error('Der vollständige Buchtext konnte nicht verarbeitet werden.');
   if(encoder)await output.write(encoder.flush());await output.flush();check(active);
   if(format==='wav')await store.patch(waveHeader(samples,sampleRate));check(active);
   // All samples are written now. Atomic close is the commit boundary: an
   // abort after this point cannot truthfully promise that no file was saved.
   this.committing=true;progress('saving','Das vollständige Hörbuch wird abgeschlossen …');
   const blob=await store.finish();processedCharacters=text.length;
   const result={filename,mime,bytes:output.bytes,duration:samples/sampleRate,sampleRate,samples,completedChunks,totalChunks,totalCharacters:text.length,storage:store.kind,blob,cleanup:store.cleanup};
   progress('done','Das vollständige Hörbuch ist fertig.');return result;
  }catch(error){if(store)await store.discard().catch(()=>{});else await sink?.abort?.().catch(()=>{});const failure=active.aborted?abortError():storageError(error);progress(failure.name==='AbortError'?'aborted':'error',failure.message);throw failure;}
  finally{signal?.removeEventListener('abort',cancel);active.removeEventListener('abort',stop);this.running=false;this.committing=false;this.controller=null;}
 }
}
