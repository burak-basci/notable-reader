import {cleanSemanticRanges} from '../playback/reading-rules.js';
/* Local, explicit-save reading library and audio archive. Own code MIT.
 * The database never contains account/licence information and has no network path. */
export const LIMITS = Object.freeze({items:100, text:500000, textTotal:10000000, audioItems:20, audioBytes:256*1024*1024, audioFile:128*1024*1024, captureBytes:32*1024*1024});
const DB='benotable-reader-library-v1', VERSION=3;
let pending;
const fail=code=>Object.assign(new Error(code),{code});
const idOK=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id);
const string=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
export function cleanItem(raw){
 if(!raw||typeof raw.text!=='string'||!raw.text.trim()||raw.text.length>LIMITS.text)throw fail('library_invalid_text');
 let url='';if(raw.url){try{const u=new URL(raw.url);if(!['http:','https:'].includes(u.protocol))throw Error();u.username='';u.password='';url=u.href.slice(0,4096);}catch{throw fail('library_invalid_url');}}
 return {title:string(raw.title,240)||raw.text.trim().slice(0,80),text:raw.text,url,language:/^[a-z]{2,3}(?:-[A-Za-z]{2})?$/.test(raw.language||'')?raw.language:''};
}
function database(){
 return pending??=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,VERSION);r.onupgradeneeded=()=>{for(const s of ['items','audio','captures','history','historyMeta','historyDocuments','documents','bookmarks','bookmarkDocuments'])if(!r.result.objectStoreNames.contains(s))r.result.createObjectStore(s,{keyPath:'id'});};r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();pending=null;};resolve(r.result);};r.onerror=()=>{pending=null;reject(fail('library_storage_unavailable'));};});
}
async function tx(name,mode,fn){const db=await database();return new Promise((resolve,reject)=>{const t=db.transaction(name,mode),s=t.objectStore(name);let value,error;t.oncomplete=()=>resolve(value);t.onabort=()=>reject(error||fail(t.error?.name==='QuotaExceededError'?'library_quota':'library_storage_failed'));t.onerror=()=>{};try{fn(s,v=>value=v,e=>{error=e;t.abort();});}catch(e){error=e;t.abort();}});}
export const getItem=id=>idOK(id)?tx('items','readonly',(s,done)=>{const r=s.get(id);r.onsuccess=()=>done(r.result||null);}):Promise.resolve(null);
export const listItems=({query=''}={})=>tx('items','readonly',(s,done)=>{const r=s.getAll();r.onsuccess=()=>{const q=string(query,300).toLocaleLowerCase();done(r.result.filter(i=>!q||(i.title+' '+i.text).toLocaleLowerCase().includes(q)).sort((a,b)=>a.order-b.order));};});
export async function saveItem(raw){const item=cleanItem(raw);return tx('items','readwrite',(s,done,abort)=>{const r=s.getAll();r.onsuccess=()=>{const all=r.result;if(all.length>=LIMITS.items)return abort(fail('library_item_limit'));if(all.reduce((n,i)=>n+i.text.length,0)+item.text.length>LIMITS.textTotal)return abort(fail('library_text_limit'));const value={...item,id:crypto.randomUUID(),created:Date.now(),order:Math.max(-1,...all.map(i=>i.order))+1};s.add(value);done(value);};});}
export const removeItem=id=>tx('items','readwrite',(s,done)=>{if(idOK(id))s.delete(id);done(true);});
export const clearItems=()=>tx('items','readwrite',(s,done)=>{s.clear();done(true);});
export const reorderItems=ids=>tx('items','readwrite',(s,done,abort)=>{if(!Array.isArray(ids)||ids.length>LIMITS.items||new Set(ids).size!==ids.length||ids.some(id=>!idOK(id)))return abort(fail('library_invalid_order'));const r=s.getAll();r.onsuccess=()=>{const all=r.result;if(ids.length!==all.length||all.some(i=>!ids.includes(i.id)))return abort(fail('library_invalid_order'));for(const i of all)s.put({...i,order:ids.indexOf(i.id)});done(true);};});
export const getAudio=id=>idOK(id)?tx('audio','readonly',(s,done)=>{const r=s.get(id);r.onsuccess=()=>done(r.result||null);}):Promise.resolve(null);
export const listAudio=()=>tx('audio','readonly',(s,done)=>{const r=s.getAll();r.onsuccess=()=>done(r.result.map(({blob,...m})=>m).sort((a,b)=>b.created-a.created));});
export function saveAudio({blob,title,voice,format,filename}={}){
 if(!(blob instanceof Blob)||!['mp3','wav'].includes(format)||blob.size<1||blob.size>LIMITS.audioFile)return Promise.reject(fail('library_audio_limit'));
 return tx('audio','readwrite',(s,done,abort)=>{const r=s.getAll();r.onsuccess=()=>{const all=r.result;if(all.length>=LIMITS.audioItems||all.reduce((n,i)=>n+i.bytes,0)+blob.size>LIMITS.audioBytes)return abort(fail('library_audio_limit'));const item={id:crypto.randomUUID(),blob,bytes:blob.size,title:string(title,240)||'Audio',voice:string(voice,120),format,filename:(string(filename,180)||'beNotable-audio.'+format).replace(/[\\/<>:"|?*\x00-\x1f]/g,'_'),created:Date.now()};s.add(item);done({...item,blob:undefined});};});
}
export const removeAudio=id=>tx('audio','readwrite',(s,done)=>{if(idOK(id))s.delete(id);done(true);});
export const clearAudio=()=>tx('audio','readwrite',(s,done)=>{s.clear();done(true);});
export function saveCapture(blob){if(!(blob instanceof Blob)||!/^image\/(png|jpeg|webp)$/.test(blob.type)||!blob.size||blob.size>LIMITS.captureBytes)return Promise.reject(fail('library_invalid_capture'));return tx('captures','readwrite',(s,done)=>{s.clear();const item={id:crypto.randomUUID(),blob,created:Date.now()};s.add(item);done(item.id);});}
export const takeCapture=id=>tx('captures','readwrite',(s,done)=>{if(!idOK(id)){done(null);return;}const r=s.get(id);r.onsuccess=()=>{s.delete(id);done(r.result&&Date.now()-r.result.created<300000?r.result.blob:null);};});

/* Actual reading is separate from the explicit queue and from exported audio.
 * No age/count eviction: only an explicit remove/clear or browser storage removal deletes it. */
const historyID=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
export function canonicalSource(raw){
 if(!raw)return '';
 try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol))return '';u.username='';u.password='';if(!/^#(?:\/|!)/.test(u.hash))u.hash='';return u.href;}catch{return '';}
}
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value instanceof Uint8Array?value:new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
export async function historyDocument(raw){
 if(!raw||typeof raw.text!=='string'||!raw.text.trim())throw fail('history_invalid_document');
 const url=canonicalSource(raw.url),kind=url?'web':'file',text=raw.text;
 let navigationURL='';if(raw.navigationURL){try{const u=new URL(raw.navigationURL);u.username='';u.password='';if(u.href.length>8192||canonicalSource(u.href)!==url)throw Error();navigationURL=u.href;}catch{throw fail('library_invalid_url');}}
 if(raw.url&&!url)throw fail('library_invalid_url');
 let semanticRanges;try{semanticRanges=cleanSemanticRanges(raw.semanticRanges,text.length);}catch{throw fail('history_invalid_document');}const semanticHash=await digest(JSON.stringify(semanticRanges));
 const contentHash=await digest(text),fileName=string(raw.fileName,512),identity=kind==='web'?'web:'+url:'file:'+(fileName||string(raw.title,512))+'|'+contentHash;
 return {id:await digest(identity),contentHash,semanticHash,semanticRanges,text,url,...(navigationURL?{navigationURL}:{}),kind,title:string(raw.title,512)||fileName||(url?new URL(url).hostname:'Document'),fileName,mimeType:string(raw.mimeType,160),language:string(raw.language,24),fingerprint:string(raw.fingerprint,160),recovered:raw.recovered===true};
}
export function cleanHistoryPosition(raw={}){
 const out={};for(const key of ['chunk','word','char','chunkChar','block','blockChar'])if(Number.isSafeInteger(raw[key])&&raw[key]>=0)out[key]=raw[key];
 return {chunk:out.chunk||0,word:out.word||0,...out};
}
export async function recordHistory({document:raw,id,position,progress=0,completed=false,readAt=Date.now(),startedAt=readAt,token='',sequence=0}={}){
 const doc=raw?await historyDocument(raw):null,key=doc?.id||id;if(!historyID(key))throw fail('history_invalid_document');
 return historyWrite((s,meta,done,abort,documents)=>{const r=s.get(key),removed=meta.get(key),cleared=meta.get('*');let pending=3;for(const q of [r,removed,cleared])q.onsuccess=()=>{if(--pending)return;
  if(startedAt<=Math.max(removed.result?.removedAt||0,cleared.result?.removedAt||0)){done({id:key,ignored:true,removed:true});return;}
  const old=r.result;if(!doc&&!old)return abort(fail('history_document_missing'));
  const at=Number.isFinite(readAt)?Math.min(Date.now(),Math.max(0,readAt)):Date.now();
  if(old&&(at<old.lastRead||token&&old.token===token&&sequence<=old.sequence)){done({id:key,ignored:true});return;}
  const {text:documentText,semanticRanges,...metadata}=doc||{};if(doc&&(doc.contentHash!==old?.contentHash||doc.semanticHash!==old?.semanticHash))documents.put({id:key,text:documentText,contentHash:doc.contentHash,semanticRanges});
  const value={...old,...metadata,id:key,position:cleanHistoryPosition(position),progress:completed?1:Math.max(0,Math.min(1,Number(progress)||0)),completed:completed===true,lastRead:at,firstRead:old?.firstRead||at,token:string(token,100),sequence:Number.isSafeInteger(sequence)?sequence:0};
  s.put(value);done({id:key,lastRead:at});
 };});
}
export async function getHistory(id){if(!historyID(id))return null;const db=await database();return new Promise((resolve,reject)=>{const t=db.transaction(['history','historyDocuments'],'readonly'),meta=t.objectStore('history').get(id),body=t.objectStore('historyDocuments').get(id);t.oncomplete=()=>resolve(meta.result?{...meta.result,text:body.result?.text||meta.result.text||'',semanticRanges:body.result?.semanticRanges||meta.result.semanticRanges||[]}:null);t.onabort=()=>reject(fail('library_storage_failed'));});}
export async function findHistory(raw){const doc=await historyDocument(raw);return getHistory(doc.id);}
export const listHistory=({query=''}={})=>tx('history','readonly',(s,done)=>{const r=s.getAll();r.onsuccess=()=>{const q=string(query,300).toLocaleLowerCase();done(r.result.filter(i=>!q||(i.title+' '+i.fileName+' '+i.url).toLocaleLowerCase().includes(q)).sort((a,b)=>b.lastRead-a.lastRead).map(({text,token,sequence,...item})=>item));};});
export const removeHistory=id=>historyWrite((s,meta,done,abort,documents)=>{if(historyID(id)){s.delete(id);documents.delete(id);meta.put({id,removedAt:Date.now()});}done(true);});
export const clearHistory=()=>historyWrite((s,meta,done,abort,documents)=>{s.clear();documents.clear();meta.clear();meta.put({id:'*',removedAt:Date.now()});done(true);});

async function historyWrite(fn){const db=await database();return new Promise((resolve,reject)=>{const t=db.transaction(['history','historyMeta','historyDocuments'],'readwrite');let value,error;t.oncomplete=()=>resolve(value);t.onabort=()=>reject(error||fail(t.error?.name==='QuotaExceededError'?'library_quota':'library_storage_failed'));t.onerror=()=>{};try{fn(t.objectStore('history'),t.objectStore('historyMeta'),v=>value=v,e=>{error=e;t.abort();},t.objectStore('historyDocuments'));}catch(e){error=e;t.abort();}});}

/* Explicit Reader downloads/imports and named positions. Separate stores preserve
 * the playback history and old saved queue without converting or deleting them. */
export const ARCHIVE_LIMITS=Object.freeze({documents:100,documentBytes:256*1024*1024,documentFile:128*1024*1024,bookmarks:1000,bookmarkText:10000000,bookmarkTextTotal:25000000});
const ARCHIVE_FORMATS=new Set(['pdf','html','htm','txt','md','epub','docx']);
const archiveFormat=(filename,format)=>String(format||String(filename||'').split('.').at(-1)||'').toLowerCase();
const safeFilename=value=>(string(value,180)||'Reader-document').replace(/[\\/<>:"|?*\x00-\x1f]/g,'_');
export async function saveDocument({blob,title,filename,format,origin='import',source=null}={}){
 format=archiveFormat(filename,format);if(!(blob instanceof Blob)||!ARCHIVE_FORMATS.has(format)||!blob.size||blob.size>ARCHIVE_LIMITS.documentFile)throw fail('library_document_limit');
 let snapshot=null;if(source!==null){if(typeof source.text!=='string'||source.text.length>ARCHIVE_LIMITS.bookmarkText)throw fail('library_document_limit');snapshot=await historyDocument(source);}
 const id=await digest(format+'|'+await digest(new Uint8Array(await blob.arrayBuffer())));
 return tx('documents','readwrite',(s,done,abort)=>{const q=s.getAll();q.onsuccess=()=>{const all=q.result,old=all.find(i=>i.id===id);if(old){if(snapshot&&!old.source){if(all.reduce((n,i)=>n+(i.source?.text.length||0),0)+snapshot.text.length>ARCHIVE_LIMITS.bookmarkTextTotal)return abort(fail('library_document_limit'));s.put({...old,source:snapshot});}const {blob,source,...metadata}=old;done(metadata);return;}if(all.length>=ARCHIVE_LIMITS.documents||all.reduce((n,i)=>n+i.bytes,0)+blob.size>ARCHIVE_LIMITS.documentBytes||all.reduce((n,i)=>n+(i.source?.text.length||0),0)+(snapshot?.text.length||0)>ARCHIVE_LIMITS.bookmarkTextTotal)return abort(fail('library_document_limit'));const value={id,blob,title:string(title,240)||safeFilename(filename),filename:safeFilename(filename||'Reader.'+format),format,bytes:blob.size,mimeType:blob.type,origin:origin==='export'?'export':'import',...(snapshot?{source:snapshot}:{}),created:Date.now()};s.add(value);const {blob:body,source:sourceBody,...metadata}=value;done(metadata);};});
}
export const getDocument=id=>historyID(id)?tx('documents','readonly',(s,done)=>{const q=s.get(id);q.onsuccess=()=>done(q.result||null);}):Promise.resolve(null);
export const listDocuments=({query=''}={})=>tx('documents','readonly',(s,done)=>{const q=s.getAll();q.onsuccess=()=>{const filter=string(query,300).toLocaleLowerCase();done(q.result.filter(i=>!filter||(i.title+' '+i.filename+' '+i.format).toLocaleLowerCase().includes(filter)).sort((a,b)=>b.created-a.created).map(({blob,source,...value})=>value));};});
export const removeDocument=id=>tx('documents','readwrite',(s,done)=>{if(historyID(id))s.delete(id);done(true);});
export const clearDocuments=()=>tx('documents','readwrite',(s,done)=>{s.clear();done(true);});
/* A local refresh pulse contains no document identity or user information. */
export const BOOKMARK_REVISION_KEY='notableBookmarkRevision';
async function bookmarkChanged(){try{const api=globalThis.chrome||globalThis.browser;if(api?.storage?.local?.set)await api.storage.local.set({[BOOKMARK_REVISION_KEY]:crypto.randomUUID()});}catch{}}
async function writeBookmark({document:raw,position,name='',chapter=''}={},toggle=false){
 const document=await historyDocument(raw),place=cleanHistoryPosition(position);
 if(!Number.isSafeInteger(place.char)||place.char>=document.text.length||document.text.length>ARCHIVE_LIMITS.bookmarkText)throw fail('bookmark_invalid_position');
 const documentKey=document.id+':'+document.contentHash,db=await database();
 const result=await new Promise((resolve,reject)=>{const t=db.transaction(['bookmarks','bookmarkDocuments'],'readwrite'),s=t.objectStore('bookmarks'),docs=t.objectStore('bookmarkDocuments');let value,error;t.oncomplete=()=>resolve(value);t.onabort=()=>reject(error||fail('library_storage_failed'));t.onerror=()=>{};const abort=code=>{error=fail(code);t.abort();},all=s.getAll(),bodies=docs.getAll();let waiting=2;for(const q of [all,bodies])q.onsuccess=()=>{if(--waiting)return;const old=all.result.find(i=>i.documentKey===documentKey&&i.position.char===place.char);
  // Toggle and last-snapshot cleanup share this readwrite transaction, so two
  // callers cannot both observe an absent mark or delete a sibling's body.
  if(toggle&&old){s.delete(old.id);if(!all.result.some(i=>i.id!==old.id&&i.documentKey===documentKey))docs.delete(documentKey);value={saved:false,id:old.id,position:old.position};return;}
  if(!old&&all.result.length>=ARCHIVE_LIMITS.bookmarks)return abort('library_bookmark_limit');if(!bodies.result.some(i=>i.id===documentKey)&&bodies.result.reduce((n,i)=>n+i.text.length,0)+document.text.length>ARCHIVE_LIMITS.bookmarkTextTotal)return abort('library_bookmark_limit');const {text,semanticRanges,...metadata}=document,at=Date.now(),context=text.slice(Math.max(0,place.char-45),Math.min(text.length,place.char+155));value={...metadata,id:old?.id||crypto.randomUUID(),documentKey,position:place,chapter:string(chapter,160),name:string(name,120)||old?.name||text.slice(place.char,place.char+72).trim()||document.title,context,created:old?.created||at,updated:at};docs.put({id:documentKey,text,semanticRanges});s.put(value);if(toggle)value={saved:true,id:value.id,position:value.position};};});
 await bookmarkChanged();return result;
}
export const saveBookmark=value=>writeBookmark(value);
export const toggleBookmark=value=>writeBookmark(value,true);
export const bookmarkLocations=documentKey=>typeof documentKey==='string'&&/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(documentKey)?tx('bookmarks','readonly',(s,done)=>{const items=[],q=s.openCursor();q.onsuccess=()=>{const c=q.result;if(!c){done(items);return;}const v=c.value;if(v.documentKey===documentKey&&idOK(v.id)&&Number.isSafeInteger(v.position?.char)&&v.position.char>=0)items.push({id:v.id,char:v.position.char});if(items.length>=ARCHIVE_LIMITS.bookmarks)done(items);else c.continue();};}):Promise.resolve([]);
export async function getBookmark(id){if(!idOK(id))return null;const db=await database();return new Promise((resolve,reject)=>{const t=db.transaction(['bookmarks','bookmarkDocuments'],'readonly'),q=t.objectStore('bookmarks').get(id);let result=null;q.onsuccess=()=>{if(!q.result)return;const body=t.objectStore('bookmarkDocuments').get(q.result.documentKey);body.onsuccess=()=>{if(body.result)result={...q.result,text:body.result.text,semanticRanges:body.result.semanticRanges||[]};};};t.oncomplete=()=>resolve(result);t.onabort=()=>reject(fail('library_storage_failed'));});}
export const listBookmarks=({query=''}={})=>tx('bookmarks','readonly',(s,done)=>{const q=s.getAll();q.onsuccess=()=>{const filter=string(query,300).toLocaleLowerCase();done(q.result.filter(i=>!filter||(i.name+' '+i.title+' '+i.fileName+' '+i.url+' '+i.context).toLocaleLowerCase().includes(filter)).sort((a,b)=>b.updated-a.updated));};});
export const renameBookmark=(id,name)=>{const title=string(name,120);if(!idOK(id)||!title)return Promise.reject(fail('bookmark_invalid_name'));return tx('bookmarks','readwrite',(s,done)=>{const q=s.get(id);q.onsuccess=()=>{if(q.result){const item={...q.result,name:title,updated:Date.now()};s.put(item);done(item);}else done(null);};}).then(async value=>{if(value)await bookmarkChanged();return value;});};
export async function removeBookmark(id){if(!idOK(id))return false;const db=await database();const result=await new Promise((resolve,reject)=>{const t=db.transaction(['bookmarks','bookmarkDocuments'],'readwrite'),s=t.objectStore('bookmarks'),docs=t.objectStore('bookmarkDocuments'),q=s.get(id);q.onsuccess=()=>{if(!q.result)return;const key=q.result.documentKey;s.delete(id);const all=s.getAll();all.onsuccess=()=>{if(!all.result.some(i=>i.documentKey===key))docs.delete(key);};};t.oncomplete=()=>resolve(true);t.onabort=()=>reject(fail('library_storage_failed'));});await bookmarkChanged();return result;}
export async function clearBookmarks(){const db=await database();const result=await new Promise((resolve,reject)=>{const t=db.transaction(['bookmarks','bookmarkDocuments'],'readwrite');t.objectStore('bookmarks').clear();t.objectStore('bookmarkDocuments').clear();t.oncomplete=()=>resolve(true);t.onabort=()=>reject(fail('library_storage_failed'));});await bookmarkChanged();return result;}
/* Undo of one removal in the popup: the exact record read just before removing it goes back unchanged.
 * Limits still apply, and a restored reading entry clears its own removal marker so later progress is kept again. */
export function restoreItem(item){
 if(!item||!idOK(item.id))return Promise.reject(fail('library_invalid_text'));const clean=cleanItem(item);
 return tx('items','readwrite',(s,done,abort)=>{const r=s.getAll();r.onsuccess=()=>{const all=r.result.filter(i=>i.id!==item.id);if(all.length>=LIMITS.items)return abort(fail('library_item_limit'));if(all.reduce((n,i)=>n+i.text.length,0)+clean.text.length>LIMITS.textTotal)return abort(fail('library_text_limit'));const value={...clean,id:item.id,created:Number.isFinite(item.created)?item.created:Date.now(),order:Number.isFinite(item.order)?item.order:Math.max(-1,...all.map(i=>i.order))+1};s.put(value);done(value);};});
}
export function restoreHistory(entry){
 if(!entry||!historyID(entry.id)||typeof entry.text!=='string'||!entry.text)return Promise.reject(fail('history_invalid_document'));
 const {text,semanticRanges=[],...metadata}=entry;
 return historyWrite((s,meta,done,abort,documents)=>{s.put(metadata);documents.put({id:entry.id,text,contentHash:metadata.contentHash,semanticRanges});meta.delete(entry.id);done(true);});
}
export async function restoreBookmark(entry){
 if(!entry||!idOK(entry.id)||typeof entry.text!=='string'||typeof entry.documentKey!=='string')throw fail('bookmark_invalid_position');
 const {text,semanticRanges=[],...metadata}=entry,db=await database();
 const result=await new Promise((resolve,reject)=>{const t=db.transaction(['bookmarks','bookmarkDocuments'],'readwrite'),s=t.objectStore('bookmarks'),docs=t.objectStore('bookmarkDocuments');let error;t.oncomplete=()=>resolve(true);t.onabort=()=>reject(error||fail('library_storage_failed'));t.onerror=()=>{};const count=s.count();count.onsuccess=()=>{if(count.result>=ARCHIVE_LIMITS.bookmarks){error=fail('library_bookmark_limit');t.abort();return;}s.put(metadata);docs.put({id:metadata.documentKey,text,semanticRanges});};});
 await bookmarkChanged();return result;
}
/* Length of the stored text behind each bookmark's document (for "at 42 %" in the popup); a missing body gives no entry. */
export async function bookmarkTextLengths(documentKeys=[]){
 const keys=[...new Set(documentKeys)].filter(key=>typeof key==='string'&&/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(key));if(!keys.length)return new Map();
 const db=await database();return new Promise((resolve,reject)=>{const t=db.transaction('bookmarkDocuments','readonly'),s=t.objectStore('bookmarkDocuments'),out=new Map();for(const key of keys){const q=s.get(key);q.onsuccess=()=>{if(typeof q.result?.text==='string')out.set(key,q.result.text.length);};}t.oncomplete=()=>resolve(out);t.onabort=()=>reject(fail('library_storage_failed'));});
}
