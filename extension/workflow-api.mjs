import {askFrame,authorizedFrame,withTimeout} from './frame-session.mjs';
/* Explicit local workflows. Only the extension's trusted UI calls handleWorkflowRequest. */
import * as readerAPI from './engine-api.js';
import {saveItem,saveCapture,recordHistory,findHistory,canonicalSource,historyDocument,saveBookmark,toggleBookmark,bookmarkLocations} from './library/store.mjs';
const api = globalThis.chrome?.runtime?.id ? chrome : browser;
const READER = api.runtime.getURL('tools/reader/reader.html');
const workflowCommands = new Set(['addBookmark','explainPage','readPage','readSelection','selectArea','captureArea','saveForLater','openSettings','openDownload','pickNextChapter','cancelNextChapter']);
const navigationEpochs=new Map();
const chapterKey = id => 'notable-chapter-' + id;
const ownReader = url => typeof url === 'string' && url.split(/[?#]/)[0] === READER;
export async function routeSession(tab, command, value, t = 'control', sourceGeneration) {
  const message = {target:'session',t,command,...(sourceGeneration?{sourceGeneration}:{}),...(value !== undefined ? {value} : {})};
  return ownReader(tab.url)
    ? api.runtime.sendMessage({...message,fileTabId:tab.id})
    : askFrame(tab.id,message);
}
const STOP={target:'session',t:'control',command:'stop'},STOP_TIMEOUT=2000;
// A closed, discarded, frozen or replaced document has nothing left to stop; only a live session's refusal counts.
const NOTHING_TO_STOP=new RegExp(['receiving end does not exist','could not establish connection','no tab with id',
  'invalid tab id','message port closed','timeout','document_changed'].join('|'),'i');
/* Stops every other reading session. Each tab is addressed as a whole (all frames), so a stale or vanished
   frame binding can never block playback elsewhere. Sessions in other frames of the claiming tab stop too. */
export async function stopOtherReaders(except,claimantGeneration) {
  const tabs = await api.tabs.query({});
  const stop=t=>ownReader(t.url)?api.runtime.sendMessage({...STOP,fileTabId:t.id}):api.tabs.sendMessage(t.id,STOP);
  const jobs=[api.runtime.sendMessage({t:'stopLibraryAudio'}),...tabs.filter(t=>t.id!==except).map(stop)];
  const claimant=Number.isSafeInteger(except)&&typeof claimantGeneration==='string';
  if(claimant)jobs.push(stopSiblingFrames(except,claimantGeneration));
  const results=await Promise.allSettled(jobs.map(job=>withTimeout(Promise.resolve(job),STOP_TIMEOUT)));
  const harmless=reason=>NOTHING_TO_STOP.test(String(reason?.code||reason?.message||reason));
  const refused=results.some(r=>r.status==='fulfilled'?r.value?.ok===false:!harmless(r.reason));
  return refused?{ok:false,code:'audio_owner_unavailable'}:{ok:true};
}
async function stopSiblingFrames(tabId,claimantGeneration){
  let rows=[];
  const sessions=()=>api.scripting.executeScript({target:{tabId,allFrames:true},injectImmediately:true,
    func:()=>globalThis.__notableSession?.generation||null});
  try{rows=await withTimeout(Promise.resolve().then(sessions),STOP_TIMEOUT);}
  catch{return {ok:true};}
  const others=rows.filter(r=>typeof r.result==='string'&&r.result!==claimantGeneration);
  const target=r=>({frameId:r.frameId,...(r.documentId?{documentId:r.documentId}:{})});
  await Promise.allSettled(others.map(r=>api.tabs.sendMessage(tabId,STOP,target(r))));
  return {ok:true};
}
/* Audio plays in the extension host, so the browser sees the reading tab as silent and may discard or freeze it
   mid-session. The tab stays non-discardable while playback reports progress and is released afterwards. */
const PROTECTED='notablePlaybackTabs',HEARTBEAT_MS=20000;let releaseTimer=0;
const setDiscardable=(tabId,value)=>
  Promise.resolve().then(()=>api.tabs.update(tabId,{autoDiscardable:value})).catch(()=>{});
async function protectedTabs(){try{return (await api.storage.session.get(PROTECTED))[PROTECTED]||[];}catch{return [];}}
export async function protectPlayback(tabId){
  const previous=await protectedTabs();
  await Promise.all(previous.filter(id=>id!==tabId).map(id=>setDiscardable(id,true)));
  if(!previous.includes(tabId)||previous.length!==1){
    await setDiscardable(tabId,false);await api.storage.session.set({[PROTECTED]:[tabId]}).catch(()=>{});
  }
  clearTimeout(releaseTimer);releaseTimer=setTimeout(()=>void releasePlayback(tabId).catch(()=>{}),HEARTBEAT_MS);
}
export async function releasePlayback(tabId){
  const previous=await protectedTabs();if(!previous.includes(tabId))return;
  await setDiscardable(tabId,true);
  await api.storage.session.set({[PROTECTED]:previous.filter(id=>id!==tabId)}).catch(()=>{});
}
const fileAccessDenied=async url=>{
  // Firefox reports false here even when its content scripts may run on files; its injection error decides instead.
  if(!/^file:/i.test(url||'')||api.runtime.getURL('').startsWith('moz-extension:'))return false;
  try{return await api.extension.isAllowedFileSchemeAccess()===false;}catch{return false;}
};
const START_WORKFLOWS=new Set(['readPage','readSelection']);
export async function handleWorkflowRequest(m, page, sender) {
  if (m.type === 'libraryStopAll' && ['popup.html','library/library.html','tools/reader/reader.html','sidebar.html'].includes(page)) return stopOtherReaders(sender.tab?.id);
  if (m.type === 'control' && m.command === 'openSidebar' && ['popup.html','sidebar.html'].includes(page)) {
    const tabs = await api.tabs.query({active:true,currentWindow:true}), tab = tabs[0];
    if (api.sidePanel) { await api.sidePanel.open({windowId:tab.windowId}); return {ok:true}; }
    if (globalThis.browser?.sidebarAction) { await browser.sidebarAction.open(); return {ok:true}; }
    await api.tabs.create({url:api.runtime.getURL('sidebar.html')}); return {ok:true};
  }
  if (m.type !== 'control' || !workflowCommands.has(m.command) || !['popup.html','sidebar.html'].includes(page)) return null;
  if (Object.keys(m).some(k=>!['type','command','value','tabId','sourceGeneration','sourceURL'].includes(k))) return {ok:false,code:'invalid'};
  const tab = Number.isSafeInteger(m.tabId) ? await api.tabs.get(m.tabId).catch(()=>null) : (await api.tabs.query({active:true,currentWindow:true}))[0];
  // Without an activeTab grant or host permission the browser hides the tab's URL (e.g. clicks in the side panel).
  if (tab && typeof tab.url !== 'string') return {ok:false,code:'page_access_required'};
  if (!tab || !tab.active || !ownReader(tab.url) && !/^(?:https?:\/\/|file:)/.test(tab.url || '')) return {ok:false,code:'unsupported'};
  if(await fileAccessDenied(tab.url))return {ok:false,code:'file_access_required'};
  if(m.sourceURL!==undefined&&m.sourceURL!==tab.url)return {ok:false,code:'tab_changed'};
  if(m.command==='saveForLater'&&tab.incognito)return {ok:false,code:'private_window'};
  /* Round 3 (owner request): opening the bar never starts the sound. Read / Read selection only play when the bar was already open on this document
     before this request (a second press); otherwise they open it, paused, at the place it will read from. The file view's bar is its page: open. */
  const wasOpen=!START_WORKFLOWS.has(m.command)||ownReader(tab.url)?true:await withTimeout(Promise.resolve(routeSession(tab,undefined,undefined,'status')),1500).then(s=>s?.ok===true&&s.overlayVisible===true&&s.ready===true,()=>false);
  if (!ownReader(tab.url)) await readerAPI.show(tab,undefined,{overlay:true,allowEmpty:m.command==='captureArea',rediscover:m.command==='readSelection'});
  // The proven frame binding (checked by the status request below) identifies the document, not URL or title.
  const current=await api.tabs.get(tab.id).catch(()=>null);
  if(!current?.active)return {ok:false,code:'tab_changed'};
  const bound=await routeSession(current,undefined,undefined,'status');
  if(!bound?.ok||m.sourceGeneration!==undefined&&m.sourceGeneration!==bound.generation)return {ok:false,code:'document_changed'};
  const sourceGeneration=bound.generation;
  if (m.command === 'saveForLater') {
    const r = await routeSession(tab,undefined,undefined,'document',sourceGeneration);
    if (!r?.ok || !r.doc?.text) return {ok:false,code:'document_unavailable'};
    const item = await saveItem({...r.doc,url:/^https?:/.test(tab.url || '') ? tab.url : ''});
    return {ok:true,saved:true,id:item?.id || item};
  }
  if (m.command === 'cancelNextChapter') { await api.storage.session.remove(chapterKey(tab.id)); return {ok:true}; }
  const request=routeSession(tab,m.command,START_WORKFLOWS.has(m.command)?{play:wasOpen}:m.value,'control',sourceGeneration);
  if(!START_WORKFLOWS.has(m.command))return await request;
  // Starting may wait for a voice confirmation or download in the page; its progress shows in the session status.
  const answer=await readerAPI.acknowledged(request);
  return answer===readerAPI.PENDING?{ok:true,pending:true}:answer;
}
export async function handleWorkflowMessage(m,sender) {
  if (m.t === 'claimAudio') {
    const own=ownReader(sender.tab.url),result=await stopOtherReaders(sender.tab.id,own?undefined:m.generation);
    if(result.ok&&!own)await protectPlayback(sender.tab.id);
    return result;
  }
  if (m.t === 'saveChapter') {
    const r=m.recipe, url=new URL(sender.tab.url);
    if (!r || r.origin !== url.origin || typeof r.selector !== 'string' || r.selector.length>1000) return {ok:false};
    await api.storage.session.set({[chapterKey(sender.tab.id)]:{selector:r.selector,origin:r.origin,left:100,at:Date.now()}}); return {ok:true};
  }
  if (m.t === 'cancelChapter') { await api.storage.session.remove(chapterKey(sender.tab.id)); return {ok:true}; }
  if (m.t === 'getChapter') {const key=chapterKey(sender.tab.id),recipe=(await api.storage.session.get(key))[key]||null;return {ok:true,recipe};}
  if (m.t === 'continueChapter') {
    const key=chapterKey(sender.tab.id), recipe=(await api.storage.session.get(key))[key];
    if (!recipe || !m.url) return {ok:false};
    const target=new URL(m.url), current=new URL(sender.tab.url);
    if (!recipe.left || target.origin!==recipe.origin || current.origin!==recipe.origin || target.href===current.href || target.username || target.password || Date.now()-recipe.at>24*3600000) { await api.storage.session.remove(key); return {ok:false}; }
    await api.storage.session.set({[key]:{...recipe,left:recipe.left-1,pending:target.href}});
    await api.tabs.update(sender.tab.id,{url:target.href}); return {ok:true};
  }
  if (m.t === 'captureArea') {
    if(sender.tab.incognito)return {ok:false,code:'private_window'};   // the screenshot would be kept in normal storage
    const epoch=navigationEpochs.get(sender.tab.id)||0,tab=await api.tabs.get(sender.tab.id),rect=m.rect;
    if(tab.url!==sender.tab.url)return {ok:false,code:'tab_changed'};
    if(m.generation){const source=await routeSession(tab,undefined,undefined,'status');if(source?.generation!==m.generation)return {ok:false,code:'document_changed'};}
    if (!tab.active || !/^https?:/.test(tab.url || '') || !rect || !['left','top','width','height','viewportWidth','viewportHeight'].every(k=>Number.isFinite(rect[k])) || rect.width<4 || rect.height<4 || rect.viewportWidth<1 || rect.viewportHeight<1) return {ok:false,code:'invalid'};
    const data=await api.tabs.captureVisibleTab(tab.windowId,{format:'png'});
    const current=await api.tabs.get(tab.id);const active=(await api.tabs.query({active:true,windowId:tab.windowId}))[0];
    if(current.url!==tab.url||active?.id!==tab.id||(navigationEpochs.get(tab.id)||0)!==epoch)return {ok:false,code:'tab_changed'};
    if(typeof data!=='string'||!data.startsWith('data:image/png;base64,')||data.length>45e6)return {ok:false,code:'invalid'};
    const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0)),image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    try {
      const scaleX=image.width/rect.viewportWidth,scaleY=image.height/rect.viewportHeight;
      const x=Math.max(0,Math.round(rect.left*scaleX)),y=Math.max(0,Math.round(rect.top*scaleY));
      const w=Math.min(image.width-x,Math.round(rect.width*scaleX)),h=Math.min(image.height-y,Math.round(rect.height*scaleY));
      if(w<1||h<1||w*h>30e6) return {ok:false,code:'invalid'};
      const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d').drawImage(image,x,y,w,h,0,0,w,h);
      const id=await saveCapture(await canvas.convertToBlob({type:'image/png'}));
      await api.tabs.create({url:READER+'#capture='+encodeURIComponent(id?.id||id)});return {ok:true};
    } finally {image.close();}
  }
  return {ok:false,code:'invalid'};
}
export function installWorkflowEvents() {
  api.tabs.onUpdated.addListener((tabId,changes,tab)=>{
    if(changes.status==='loading'||typeof changes.url==='string'){if(navigationEpochs.size>256&&!navigationEpochs.has(tabId))navigationEpochs.delete(navigationEpochs.keys().next().value);navigationEpochs.set(tabId,(navigationEpochs.get(tabId)||0)+1);}
    if(changes.status!=='complete')return;
    void (async()=>{
      const key=chapterKey(tabId), recipe=(await api.storage.session.get(key))[key];
      if(!recipe?.pending)return;
      if(tab.url!==recipe.pending){await api.storage.session.remove(key);return;}
      const epoch=navigationEpochs.get(tabId)||0,starting=crypto.randomUUID();
      await api.storage.session.set({[key]:{...recipe,pending:null,starting}});
      try {
        await readerAPI.show(tab,undefined,{overlay:true});
        const current=await api.tabs.get(tabId).catch(()=>null),latest=(await api.storage.session.get(key))[key];
        if(!current||current.url!==tab.url||(navigationEpochs.get(tabId)||0)!==epoch||latest?.starting!==starting){if(latest?.starting===starting)await api.storage.session.remove(key);return;}
        const source=await routeSession(current,undefined,undefined,'status');
        if(!source?.ok)return;
        await api.storage.session.set({[key]:{...latest,starting:null}});
        await routeSession(current,'readPage',{play:true},'control',source.generation);   // the automatic next chapter keeps reading (it is not an opening)
      } catch { const latest=(await api.storage.session.get(key))[key];if(latest?.starting===starting)await api.storage.session.remove(key); }
    })().catch(()=>{});
  });
  api.tabs.onRemoved.addListener(id=>{navigationEpochs.delete(id);void api.storage.session.remove(chapterKey(id)).catch(()=>{});void releasePlayback(id).catch(()=>{});});
}

/* Called only by our own top-frame session; never by external page messages.
 * A fresh bound-session check fences replacement documents and async captures. */
export async function handleReadingHistory(m,sender){
 const file=ownReader(sender.url);
 if(!sender.tab&&file&&Number.isSafeInteger(m.tabId)){const tab=await api.tabs.get(m.tabId).catch(()=>null);if(tab&&ownReader(tab.url))sender={...sender,tab};}
 if(sender.id!==api.runtime.id||!['record','restore','authorize','bookmark','toggleBookmark','bookmarkState'].includes(m.action))return {ok:false,code:'invalid'};
 if(sender.tab?.incognito||sender.incognito||api.extension?.inIncognitoContext)return {ok:true,private:true};
 if(typeof m.generation!=='string'||!/^[a-f0-9]{32}$/.test(m.generation)||typeof m.fingerprint!=='string'||m.fingerprint.length>160||typeof m.token!=='string'||!/^[a-f0-9-]{36}$/.test(m.token))return {ok:false,code:'invalid'};
 const authKey='reading-history-owner-'+m.token;
 if(m.action==='bookmarkState'){
  const auth=(await api.storage.session.get(authKey))[authKey];
  if(!auth||!sender.tab||auth.tabId!==sender.tab.id||(auth.frameId||0)!==(sender.frameId||0)||auth.generation!==m.generation||auth.fingerprint!==m.fingerprint||auth.documentId&&auth.documentId!==sender.documentId)return {ok:false,code:'document_changed'};
  const tab=await api.tabs.get(auth.tabId).catch(()=>null),bound=tab?await routeSession(tab,undefined,undefined,'status').catch(()=>null):null;
  if(!bound?.ok||bound.generation!==m.generation||bound.fingerprint!==m.fingerprint)return {ok:false,code:'document_changed'};
  try{return {ok:true,bookmarks:await bookmarkLocations(auth.id+':'+auth.contentHash)};}catch(error){return {ok:false,code:error.code||'library_storage_failed'};}
 }
 if(m.action==='record'){
  const auth=(await api.storage.session.get(authKey))[authKey];
  // This token was authorized while its source context was alive. Final writes
  // may arrive after tab close/navigation, but can update ONLY that old document.
  if(!auth||(auth.frameId||0)!==(sender.frameId||0)||auth.generation!==m.generation||auth.fingerprint!==m.fingerprint||auth.documentId&&auth.documentId!==sender.documentId||!auth.documentId&&new URL(auth.senderUrl).origin!==new URL(sender.url).origin||sender.tab&&sender.tab.id!==auth.tabId||!sender.tab&&m.tabId!==auth.tabId)return {ok:false,code:'document_changed'};
  if(!Number.isSafeInteger(m.sequence)||m.sequence<1||!Number.isFinite(m.readAt))return {ok:false,code:'invalid'};
  if(m.document){const doc=await historyDocument(m.document);if(doc.id!==auth.id||doc.contentHash!==auth.contentHash||(doc.semanticHash!==auth.semanticHash&&(auth.semanticHash!==undefined||doc.semanticRanges.length)))return {ok:false,code:'document_changed'};}
  else if(m.id!==auth.id)return {ok:false,code:'document_changed'};
  // Progress is the playback heartbeat.
  if(sender.tab&&!ownReader(sender.tab.url))void protectPlayback(sender.tab.id).catch(()=>{});
  try{const result=await recordHistory({...m,id:auth.id,startedAt:auth.startedAt});return {ok:true,...result};}catch(error){return {ok:false,code:['library_quota','library_storage_unavailable','library_storage_failed','history_document_missing'].includes(error.code)?error.code:'history_storage_failed'};}
 }
 if(sender.frameId>0&&!await authorizedFrame(sender,m.generation))return {ok:false,code:'document_changed'};
 if(!sender.tab)return {ok:false,code:'document_changed'};
 const tab=await api.tabs.get(sender.tab.id).catch(()=>null);
 if(!tab||file&&!ownReader(tab.url)||!file&&sender.frameId===0&&(!/^https?:\/\//.test(sender.url||'')||new URL(tab.url).origin!==new URL(sender.url).origin))return {ok:false,code:'document_changed'};
 if(!m.document||!file&&canonicalSource(m.document.url)!==canonicalSource(tab.url)||m.document.fingerprint!==m.fingerprint)return {ok:false,code:'document_changed'};
 // A hash or pushState change keeps the document; the generation/fingerprint check below proves its content.
 const moved=m.document.navigationURL&&canonicalSource(m.document.navigationURL)!==canonicalSource(tab.url);
 if(!file&&moved)return {ok:false,code:'document_changed'};
 const doc=await historyDocument(m.document),bound=await routeSession(tab,undefined,undefined,'status').catch(()=>null);
 if(!bound?.ok||bound.generation!==m.generation||bound.fingerprint!==m.fingerprint)return {ok:false,code:'document_changed'};
 if(m.action==='bookmark'||m.action==='toggleBookmark'){const auth=(await api.storage.session.get(authKey))[authKey];if(!auth||auth.id!==doc.id||auth.contentHash!==doc.contentHash||auth.semanticHash!==doc.semanticHash||auth.generation!==m.generation||auth.fingerprint!==m.fingerprint||auth.tabId!==tab.id||(auth.frameId||0)!==(sender.frameId||0)||auth.documentId&&auth.documentId!==sender.documentId)return {ok:false,code:'document_changed'};if(typeof m.name!=='string'||m.name.length>120||typeof m.chapter!=='string'||m.chapter.length>160||!Number.isSafeInteger(m.position?.char)||m.position.char<0||m.position.char>=doc.text.length)return {ok:false,code:'invalid'};try{const bookmark=await (m.action==='toggleBookmark'?toggleBookmark:saveBookmark)({document:m.document,position:m.position,name:m.name,chapter:m.chapter});return {ok:true,id:bookmark.id,position:bookmark.position,...(m.action==='toggleBookmark'?{saved:bookmark.saved}: {})};}catch(error){return {ok:false,code:error.code||'library_storage_failed'};}}
 if(m.action==='restore'){
  const entry=await findHistory(m.document);return {ok:true,entry:entry?.contentHash===doc.contentHash?{id:entry.id,position:entry.position,contentHash:entry.contentHash,completed:entry.completed,progress:entry.progress}:null};
 }
 await api.storage.session.set({[authKey]:{id:doc.id,contentHash:doc.contentHash,semanticHash:doc.semanticHash,startedAt:Date.now(),generation:m.generation,fingerprint:m.fingerprint,tabId:tab.id,frameId:sender.frameId||0,senderUrl:sender.url,...(sender.documentId?{documentId:sender.documentId}:{})}});
 return {ok:true,id:doc.id};
}
