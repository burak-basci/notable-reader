import {cleanSemanticRanges} from '../playback/reading-rules.js';
import {wordOffsets} from '../playback/timeline.js';
/* Playback history uses an immutable binding per document. An authorized last
 * checkpoint can finish after navigation, without ever targeting the new text. */
/* crypto.randomUUID exists only in secure contexts; a content script on a plain-http page (or an http frame) has getRandomValues only */
const randomToken=()=>globalThis.crypto?.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
const apiDefault=()=>globalThis.chrome?.runtime?.id?globalThis.chrome:globalThis.browser;
export function createReadingHistory({api=apiDefault(),onError=()=>{},now=()=>Date.now(),intervalMs=1000,onBookmarksChanged=()=>{}}={}){
 let binding=null,chain=Promise.resolve(),destroyed=false;
 const disabled=api?.extension?.inIncognitoContext===true;
 const invalidateBookmarks=()=>{if(binding){binding.bookmarks=null;binding.bookmarkEpoch=(binding.bookmarkEpoch||0)+1;}onBookmarksChanged();};
 const onStorage=(changes,area)=>{if(area==='local'&&changes?.notableBookmarkRevision)invalidateBookmarks();};api?.storage?.onChanged?.addListener(onStorage);
 async function bookmarkLocations(b){
  if(b.bookmarks)return b.bookmarks;const epoch=b.bookmarkEpoch||0;
  if(b.bookmarkQuery?.epoch===epoch)return b.bookmarkQuery.promise;
  const promise=message(b,{action:'bookmarkState'}).then(r=>{if(!r?.ok)throw Object.assign(new Error(r?.code||'bookmark_failed'),{code:r?.code||'bookmark_failed'});if(binding!==b||epoch!==(b.bookmarkEpoch||0))return null;return b.bookmarks=Array.isArray(r.bookmarks)?r.bookmarks:[];});
  b.bookmarkQuery={epoch,promise};try{return await promise;}finally{if(b.bookmarkQuery?.promise===promise)b.bookmarkQuery=null;}
 }
 async function writeBookmark(action,position,name='',chapter=''){const b=binding;if(disabled)return {ok:true,private:true};if(!b)return {ok:false,code:'document_unavailable'};await prepare(b);if(binding!==b)return {ok:false,code:'document_changed'};const r=await message(b,{action,document:b.document,position:positionFor(b,position),name,chapter});if(r?.ok&&binding===b)invalidateBookmarks();return r;}

 const senderTab=async()=>{try{const tab=await api.tabs?.getCurrent?.();return Number.isSafeInteger(tab?.id)?{tabId:tab.id}:{};}catch{return {};}};
 const message=async(b,value)=>api.runtime.sendMessage({...b.tabFields||await senderTab(),t:'readingHistory',generation:b.document.generation,fingerprint:b.document.fingerprint,token:b.token,...value});
 const positionFor=(b,raw)=>{
  const chunk=Math.max(0,Math.min(b.chunks.length-1,Number.isInteger(raw?.chunk)?raw.chunk:0)),part=b.chunks[chunk],words=wordOffsets(part?.text||'',part?.words||[])||[];
  const word=Math.max(0,Math.min(words.length-1,Number.isInteger(raw?.word)?raw.word:0)),chunkChar=words[word]?.start??0;
  let char=chunkChar;for(let i=0;i<chunk;i++)char+=(b.chunks[i]?.text.length||0)+1;
  if(Number.isSafeInteger(raw?.char)&&raw.char>=0)char=raw.char;
  return {chunk,word,char,chunkChar,block:Math.max(0,part?.block||0),blockChar:Math.max(0,(part?.start||0)+chunkChar)};
 };
 async function prepare(b=binding){
  if(disabled||!b)return null;if(b.authorized)return b.id;if(b.authorizing)return b.authorizing;
  b.authorizing=(async()=>{b.tabFields=await senderTab();const r=await message(b,{action:'authorize',document:b.document});if(!r?.ok)throw Object.assign(new Error(r?.code||'history_storage_failed'),{code:r?.code||'history_storage_failed'});b.authorized=true;b.id=r.id||'';return b.id;})().finally(()=>{b.authorizing=null;});
  return b.authorizing;
 }
 function send(raw,force,finish=false){
  const b=binding;if(disabled||destroyed||!b||!b.heard||b.suppressed)return Promise.resolve(null);
  const at=now();if(!force&&at-b.lastSent<intervalMs)return chain;b.lastSent=at;b.completed=finish||b.completed;
  const position=positionFor(b,raw),sequence=++b.sequence,completed=b.completed,readAt=b.readAt||at;
  const run=async()=>{
   await prepare(b);
   const payload={action:'record',sequence,readAt,position,progress:Math.min(1,position.char/Math.max(1,b.document.text.length)),completed,...(b.persisted?{id:b.id}:{document:b.document})};
   let r=await message(b,payload);
   if(r?.code==='history_document_missing')r=await message(b,{...payload,document:b.document});
   if(!r?.ok)throw Object.assign(new Error(r?.code||'history_storage_failed'),{code:r?.code||'history_storage_failed'});
   b.id=r.id||b.id;b.persisted=true;b.suppressed=r.removed===true;return r;
  };
  chain=chain.catch(()=>{}).then(run).catch(error=>{onError(error.code||'history_storage_failed');return null;});return chain;
 }
 return {
  bind(value){if(destroyed)return;binding=value?.text?{document:{title:value.title||'',text:value.text,semanticRanges:cleanSemanticRanges(value.semanticRanges,value.text.length),url:value.url||'',navigationURL:value.navigationURL||'',kind:value.kind||'file',fileName:value.fileName||'',mimeType:value.mimeType||'',language:value.language||'',fingerprint:value.fingerprint||'',generation:value.generation||''},chunks:Array.isArray(value.chunks)?value.chunks:[],heard:false,completed:false,readAt:0,lastPosition:null,id:'',lastSent:-Infinity,sequence:0,token:randomToken(),authorized:false,persisted:false}:null;},
  async prepare(){try{await chain;if(binding?.suppressed)binding={...binding,heard:false,completed:false,readAt:0,lastPosition:null,lastSent:-Infinity,sequence:0,token:randomToken(),authorized:false,persisted:false,authorizing:null,suppressed:false};return await prepare();}catch(error){onError(error.code||'history_storage_failed');return null;}},
  heard(pos){if(!binding)return Promise.resolve(null);if(!binding.heard)binding.lastSent=-Infinity;binding.heard=true;binding.completed=false;binding.readAt=now();binding.lastPosition=positionFor(binding,pos);return send(pos,false);},
  checkpoint(pos,{completed=false}={}){if(binding?.heard){const at=positionFor(binding,pos),old=binding.lastPosition;if(completed&&!binding.completed||!old||at.char!==old.char||at.chunk!==old.chunk||at.word!==old.word)binding.readAt=now();binding.lastPosition=at;}return send(pos,true,completed);},
  bookmark:(position,name='',chapter='')=>writeBookmark('bookmark',position,name,chapter),
  toggleBookmark:(position,name='',chapter='')=>writeBookmark('toggleBookmark',position,name,chapter),
  async bookmarkState(position){const b=binding;if(disabled)return {ok:true,saved:false,private:true};if(!b)return {ok:false,code:'document_unavailable'};try{await prepare(b);if(binding!==b)return {ok:false,code:'document_changed'};const locations=await bookmarkLocations(b);if(!locations||binding!==b)return {ok:false,code:'document_changed'};const found=locations.find(x=>x.char===positionFor(b,position).char);return {ok:true,saved:!!found,...(found?{id:found.id}: {})};}catch(error){return {ok:false,code:error.code||'bookmark_failed'};}},

  async restore(){const b=binding;if(disabled||!b)return null;try{const r=await message(b,{action:'restore',document:b.document});return binding===b&&r?.ok?r.entry||null:null;}catch{return null;}},
  flush(){return chain;},
  destroy(){destroyed=true;binding=null;api?.storage?.onChanged?.removeListener(onStorage);},
 };
}

export function historyFailureText(lang){return ({de:'Der Leseverlauf konnte nicht gespeichert werden. Prüfe den freien Speicherplatz.',en:'Reading history could not be saved. Check the available device storage.',fr:'Impossible d’enregistrer l’historique. Vérifiez l’espace disponible.',es:'No se pudo guardar el historial. Comprueba el espacio disponible.',it:'Impossibile salvare la cronologia. Controlla lo spazio disponibile.',pt:'Não foi possível guardar o histórico. Verifica o espaço disponível.'})[String(lang).split('-')[0]]||'Reading history could not be saved. Check the available device storage.';}
