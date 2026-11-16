/* One browser-verified source document per tab. URL strings from page messages never authorize a frame. */
const api=globalThis.chrome?.runtime?.id?chrome:browser;
const KEY='notableFrameSources';
const firefox=()=>api.runtime.getURL('').startsWith('moz-extension:');
const error=(code,extra={})=>Object.assign(new Error(code),{code},extra);
const httpOrigin=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.origin:null;}catch{return null;}};
const permissionPattern=origin=>{const u=new URL(origin);return u.protocol+'//'+u.hostname+'/*';};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Script injection into a hung, frozen or never-idle frame would otherwise stall every caller without limit.
export const INJECT_TIMEOUT=4000,PREPARE_LIMIT=30000;
export function withTimeout(promise,ms,code='timeout'){
 let timer;
 const expired=new Promise((_,reject)=>{timer=setTimeout(()=>reject(error(code)),ms);});
 return Promise.race([promise,expired]).finally(()=>clearTimeout(timer));
}
// Synchronous API throws become rejections, so every caller sees one failure path.
const inject=(options,ms=INJECT_TIMEOUT)=>
 withTimeout(Promise.resolve().then(()=>api.scripting.executeScript(options)),ms);
// One storage key per tab: concurrent writes for different tabs can never overwrite each other's binding.
const keyOf=tabId=>KEY+':'+tabId;
const sameDocument=(a,b)=>!!a&&!!b&&a.token===b.token&&(a.documentId||null)===(b.documentId||null);
export async function frameBinding(tabId){
 const key=keyOf(tabId);
 return (await api.storage.session.get(key))[key]||null;
}
export async function saveFrameBinding(tabId,value){await api.storage.session.set({[keyOf(tabId)]:value});}
/* With `expected`, only that exact binding is removed, never a newer one saved concurrently. */
export async function clearFrameBinding(tabId,expected){
 if(expected&&!sameDocument(await frameBinding(tabId),expected))return false;
 await api.storage.session.remove(keyOf(tabId));return true;
}
const sanitizedURL=value=>{
 try{
  const u=new URL(value);if(!['http:','https:','file:'].includes(u.protocol))return '';
  u.username='';u.password='';return u.href.slice(0,2000);
 }
 catch{return '';}
};
const looksLikePdf=value=>{try{return /\.pdf$/i.test(new URL(value).pathname);}catch{return false;}};
const pdfError=tab=>error('pdf_viewer',{pdf:{url:sanitizedURL(tab.url)}});
const fileAccessDenied=async()=>
 await Promise.resolve().then(()=>api.extension?.isAllowedFileSchemeAccess?.()).catch(()=>true)===false;
/* The top document cannot be scripted: name the reason where it is known, otherwise keep the original failure. */
async function accessError(cause,tab){
 // Already classified: keep the code, never the raw text.
 if(typeof cause?.code==='string'&&/^[a-z_]{2,40}$/.test(cause.code))return error(cause.code);
 let protocol='';try{protocol=new URL(tab.url).protocol;}catch{}
 // Chromium only: Firefox has no per-extension file switch and reports false here regardless.
 if(protocol==='file:'&&!firefox()&&await fileAccessDenied())return error('file_access_required');
 if(looksLikePdf(tab.url))return pdfError(tab);
 // Without an activeTab grant (e.g. a side-panel click) Chromium reports a missing host permission.
 const denied=/permission|cannot access contents/i.test(String(cause?.message||''));
 if(['http:','https:','file:'].includes(protocol)&&denied)return error('page_access_required');
 return cause||error('browser_unavailable');
}
const targetOf=(tabId,source)=>({tabId,...(!firefox()&&source.documentId?{documentIds:[source.documentId]}:{frameIds:[source.frameId]})});
function readProof(){
 const generation=globalThis.__notableSession?.generation||null;
 return {url:location.href,origin:globalThis.origin,token:globalThis.__notableDocumentToken,generation};
}
/* Returns the live proof row of the bound document, or null when that document no longer exists. */
async function prove(tabId,source){
 let rows;
 try{rows=await inject({target:targetOf(tabId,source),injectImmediately:true,func:readProof});}
 catch(e){if(e.code==='timeout')throw e;return null;}
 return rows?.find(r=>r.frameId===source.frameId)||null;
}
const proves=(proof,source,{generation=true}={})=>!!proof?.result
 &&proof.result.origin===source.origin&&proof.result.token===source.token
 &&!(source.documentId&&proof.documentId!==source.documentId)
 &&!(generation&&source.generation&&proof.result.generation!==source.generation);
/* Identity is the browser document (documentId where available) plus its private isolated-world token.
   Same-document navigations (hash, pushState) keep both, so they never invalidate a binding. */
export async function assertSource(tabId,source,{capture=false}={}){
 const tab=await api.tabs.get(tabId).catch(()=>null);
 if(!tab||capture&&!tab.active)throw error('document_changed');
 if(!proves(await prove(tabId,source),source))throw error('document_changed');
 // A subframe source is only valid inside the exact top document it was discovered in.
 if(capture&&source.frameId!==0&&source.top){
  const top=await prove(tabId,{frameId:0,...source.top});
  if(!proves(top,source.top,{generation:false}))throw error('document_changed');
 }
 return tab;
}
export async function authorizedFrame(sender,generation,{pending=false}={}){
 if(sender?.id!==api.runtime.id||!Number.isSafeInteger(sender.tab?.id)||!Number.isSafeInteger(sender.frameId)||sender.frameId<1)return false;
 const source=await frameBinding(sender.tab.id);
 if(!source||source.frameId!==sender.frameId||sender.origin!==undefined&&sender.origin!==source.origin||source.documentId&&source.documentId!==sender.documentId||!pending&&(!source.generation||generation!==source.generation))return false;
 try{await assertSource(sender.tab.id,source);return true;}catch{return false;}
}
export async function askFrame(tabId,message,timeout=4000,{source,unbound=false}={}){
 const deadline=Date.now()+timeout,bound=source||await frameBinding(tabId),frame=bound?.frameId||0;
 if(bound&&!unbound){
  try{await withTimeout(assertSource(tabId,bound),timeout);}
  catch(e){if(e.code==='document_changed'&&!source)await clearFrameBinding(tabId,bound).catch(()=>{});throw e;}
 }
 const options={frameId:frame,...(!firefox()&&bound?.documentId?{documentId:bound.documentId}:{})};
 const sent=Promise.resolve().then(()=>api.tabs.sendMessage(tabId,{target:'session',...message},options));
 return withTimeout(sent,Math.max(1,deadline-Date.now()));
}
/* Keeps a binding across same-document navigations and drops it once its document is provably gone. */
export async function revalidateFrameBinding(tabId){
 const source=await frameBinding(tabId);if(!source)return null;
 let proof;try{proof=await prove(tabId,source);}catch{return source;}
 if(!proves(proof,source)){await clearFrameBinding(tabId,source);return null;}
 const tab=await api.tabs.get(tabId).catch(()=>null);
 if(tab&&(proof.result.url!==source.url||tab.url!==source.tabUrl)){
  const current=await frameBinding(tabId);
  if(sameDocument(current,source))await saveFrameBinding(tabId,{...current,url:proof.result.url,tabUrl:tab.url});
 }
 return source;
}
export function installFrameEvents(){
 api.tabs.onUpdated.addListener((id,change)=>{
  if(!['loading','complete'].includes(change.status)&&typeof change.url!=='string')return;
  void revalidateFrameBinding(id).catch(()=>{});
 });
 api.tabs.onRemoved.addListener(id=>{void clearFrameBinding(id).catch(()=>{});});
}
/* The probe file stays installed per document; later rounds only call its cached runner. */
async function probe(tabId,target){
 const where={tabId,...target};
 const runner=async()=>await globalThis.__notableFrameProbeRun?.()??null;
 const run=()=>inject({target:where,injectImmediately:true,func:runner});
 let rows=await run();
 if(!rows.length||rows.some(r=>r.result==null)){
  await inject({target:where,injectImmediately:true,files:['frame-probe.js']});rows=await run();
 }
 return rows;
}
const fragmentless=value=>{try{const u=new URL(value);u.hash='';return u.href;}catch{return null;}};
export async function discoverFrames(tab,{onlyTop=false}={}){
 let topRows;
 try{topRows=await probe(tab.id,{frameIds:[0]});}catch(e){throw await accessError(e,tab);}
 const top=topRows.find(r=>r.frameId===0);
 if(!top?.result)throw await accessError(null,tab);
 if(top.result.contentType==='application/pdf')throw pdfError(tab);
 const initial={tabUrl:tab.url,frameId:0,documentId:top.documentId,url:top.result.url,origin:top.result.origin,token:top.result.token};
 if(fragmentless(top.result.url)!==fragmentless(tab.url))throw error('document_changed');
 let rows=topRows,allFailed=false,navigationGranted=false;
 if(top.result.frames.length&&!onlyTop){
  try{rows=await probe(tab.id,{allFrames:true});}catch(e){if(e.code==='timeout')throw e;allFailed=true;}
  if(allFailed&&(navigationGranted=await api.permissions.contains({permissions:['webNavigation']}))){
   const browserFrames=await api.webNavigation.getAllFrames({tabId:tab.id});rows=[];
   for(const frame of browserFrames||[]){if(frame.errorOccurred)continue;try{const found=await probe(tab.id,{frameIds:[frame.frameId]});for(const row of found){if(row.result?.url!==frame.url||frame.documentId&&row.documentId!==frame.documentId)throw error('document_changed');rows.push(row);}}catch(e){if(e.code==='document_changed')throw e;}}
  }
 }
 await assertSource(tab.id,initial,{capture:true});
 const origins=[...new Set(rows.flatMap(r=>r.result?.frames?.map(f=>f.origin).filter(Boolean)||[]))],missing=[];
 for(const origin of origins)if(origin!==httpOrigin(tab.url)&&!await api.permissions.contains({origins:[permissionPattern(origin)]}))missing.push(permissionPattern(origin));
 const access=(missing.length||allFailed&&!navigationGranted)?{origins:missing,needsNavigation:!navigationGranted&&missing.length===0,tabId:tab.id,tabUrl:tab.url}:null;
 const choices=rows.filter(r=>r.result?.visible&&r.result.chars>0&&r.result.ready).sort((a,b)=>Number(b.result.selected)-Number(a.result.selected)||b.result.chars-a.result.chars||a.frameId-b.frameId);
 const best=choices[0]||top;
 return {source:{...initial,frameId:best.frameId,documentId:best.documentId,url:best.result.url,origin:best.result.origin,token:best.result.token,top:{documentId:initial.documentId,origin:initial.origin,token:initial.token}},topSource:initial,ready:choices.length>0,access};
}
export async function prepareFrame(tab,{overlay=true,allowEmpty=false,onPending}={}){
 // One overall deadline: the caller's busy marker must always be released.
 const deadline=Date.now()+PREPARE_LIMIT;
 const left=()=>{const ms=deadline-Date.now();if(ms<=0)throw error('timeout');return ms;};
 let selected=await discoverFrames(tab,{onlyTop:allowEmpty});const settleBy=Date.now()+6000;
 // Back off while a page settles: each round probes every frame.
 for(let pause=150;!selected.ready&&!selected.access&&!allowEmpty&&Date.now()<settleBy;pause=Math.min(600,pause*2)){
  onPending?.();await sleep(pause);left();selected=await discoverFrames(tab);
 }
 const source=selected.source;
 if(!selected.ready&&selected.access){throw Object.assign(error('embedded_permission_required'),{access:selected.access});}
 await assertSource(tab.id,source,{capture:true});
 const prior=await frameBinding(tab.id);
 if(prior&&prior.frameId!==source.frameId){try{await askFrame(tab.id,{t:'control',command:'stop',sourceGeneration:prior.generation},4000,{source:prior});await askFrame(tab.id,{t:'hide'},4000,{source:prior});}catch{}}
 if(source.frameId!==0)await inject({target:{tabId:tab.id,frameIds:[0]},func:()=>{const s=globalThis.__notableSession;if(s&&!s.chunks.length&&!s.busy&&!['playing','loading','paused'].includes(s.state))s.destroy();else if(!s)for(const e of document.querySelectorAll('[data-notable-reader-surface="overlay"]'))if(!e.dataset.notableReaderOwner||e.dataset.notableReaderOwner===(globalThis.chrome||globalThis.browser).runtime.id)e.remove();}}).catch(()=>{});
 // Record a pending, exact browser document before it starts; only read-only entitlement is admitted until its real generation is acknowledged.
 await saveFrameBinding(tab.id,source);
 try{
  const gated=await inject({target:targetOf(tab.id,source),func:(token,hidden)=>{if(globalThis.__notableDocumentToken!==token)return false;globalThis.__notablePendingFrameLoad={token,hidden};return true;},args:[source.token,!overlay]});
  if(!gated.some(r=>r.frameId===source.frameId&&r.result===true))throw error('document_changed');
  await inject({target:targetOf(tab.id,source),files:['frame-loader.js']});
  await assertSource(tab.id,source,{capture:true});
  const settle=Date.now()+6000,statusBy=Math.min(deadline,Date.now()+20000);
  for(;;){onPending?.();let answer;try{answer=await askFrame(tab.id,{t:'status'},Math.min(1500,left()),{source,unbound:true});}catch{}
   if(answer?.ok){if(!allowEmpty&&!answer.ready&&Date.now()<settle){await sleep(150);continue;}
    // A session that collected the page and found nothing to read says so; anything else did not finish.
    if(!allowEmpty&&!answer.ready)throw error(answer.chunkCount===0&&!answer.busy?'no_readable_text':'prepare_failed');
    await assertSource(tab.id,source,{capture:true});source.generation=answer.generation;await assertSource(tab.id,source,{capture:true});await saveFrameBinding(tab.id,source);
    await askFrame(tab.id,{t:'sourceContext',sourceURL:tab.url},4000,{source});
    if(overlay)await askFrame(tab.id,{t:'show'},4000,{source});return {ok:true,code:'ready',access:selected.access};
   }
   if(Date.now()>statusBy)throw error('timeout');left();await sleep(150);
  }
 }catch(e){
  // A failed start must not leave a pending binding behind that later requests would trust.
  if(!source.generation)await clearFrameBinding(tab.id,source).catch(()=>{});
  throw e;
 }
}
export async function frameAccess(tab){const found=await discoverFrames(tab);return found.ready?null:found.access;}
