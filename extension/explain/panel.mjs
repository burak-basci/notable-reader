import {explainText,EXPLAIN_LANGUAGES} from './locales.mjs';
import {runtimePortAdapter} from './transport.mjs';
import {installed,downloadModel,removeModel} from './model-store.mjs';
let uiLanguage='en';const tr=(k,p)=>explainText(uiLanguage,k,p);function setLanguage(lang){if(!EXPLAIN_LANGUAGES.includes(lang))return;uiLanguage=lang;document.documentElement.lang=lang;document.title=tr('title');document.querySelectorAll('[data-t]').forEach(el=>{if(el.id!=='modelStatus')el.textContent=tr(el.dataset.t);});$('close').setAttribute('aria-label',tr('close'));if($('modelStatus').dataset.installed)$('modelStatus').textContent=tr(hasModel?'ready':'missing');}
const $=id=>document.getElementById(id);let port,worker,abort,id=0,running=false,hasModel=false,allAnnotations=[],epoch=null;
// Inference starts only for the source this panel asked for after a real click on "run".
let sourceRequested=false;
function send(type,data={}){port?.postMessage({type,...data});}
function cancel(){id++;worker?.terminate();worker=null;abort?.abort();abort=null;running=false;$('cancel').hidden=true;$('progress').hidden=true;$('run').disabled=!hasModel;$('download').disabled=false;$('remove').disabled=false;}
async function refresh(){hasModel=await installed();$('modelStatus').textContent=tr(hasModel?'ready':'missing');$('modelStatus').dataset.installed=String(hasModel);$('download').hidden=hasModel;$('remove').hidden=!hasModel;$('run').disabled=!hasModel||running;}
/* Coded failures (model download) name their cause through the shared table of all surfaces (engine/error-keys.mjs,
   ui-locales.json): its short label next to this panel's own text, or the full text where no short one exists. */
function report(error){
 const status=$('status');status.dataset.state='error';
 if(error?.name==='AbortError'){status.textContent=tr('aborted');return;}
 status.textContent=tr('failed');if(!error?.code)return;
 // loaded only for a coded failure: the panel itself stays a small self-contained page
 void Promise.all([import('../engine/error-keys.mjs'),import('../i18n.js')]).then(async([{errorKey},{catalogReady,t}])=>{
  const key=errorKey(error.code);if(!key)return;await catalogReady;if(status.dataset.state!=='error')return;
  const short='err_short_'+key,lead=t(short,{},uiLanguage);
  status.textContent=lead!==short?lead+' · '+tr('failed'):t(key,{mb:''},uiLanguage).replace(/\s*\(\s*(MB|Mo)\)/u,'');},()=>{});
}
function addPart(part,index){const a=document.createElement('article'),h=document.createElement('h2'),p=document.createElement('p'),b=document.createElement('button');h.textContent=tr('part',{n:index+1});p.textContent=part.text;b.textContent=tr('source');b.addEventListener('click',()=>send('focusBlock',{blockId:part.blockId}));a.append(h,p,b);$('result').append(a);}
function marks(){send('annotations',{epoch,annotations:allAnnotations.map(a=>({...a,style:$('style').value==='model'?a.style:$('style').value}))});}
$('close').onclick=()=>{cancel();send('close');};$('cancel').onclick=()=>{cancel();$('status').textContent=tr('aborted');$('status').dataset.state='cancelled';send('clear');};
$('download').onclick=async()=>{cancel();const mine=++id;abort=new AbortController();$('download').disabled=true;$('cancel').hidden=false;$('progress').hidden=false;$('status').textContent=tr('loading');try{await downloadModel({signal:abort.signal,onProgress:p=>{$('progress').value=p.loaded/p.total;$('modelStatus').textContent=`${Math.round(p.loaded/1e6)} / ${Math.round(p.total/1e6)} MB`;}});if(mine!==id)return;$('status').textContent=tr('downloaded');}catch(e){if(mine===id)report(e);}finally{if(mine===id){abort=null;$('cancel').hidden=true;$('progress').hidden=true;$('download').disabled=false;await refresh();}}};
$('remove').onclick=async()=>{cancel();await removeModel();$('result').replaceChildren();allAnnotations=[];send('clear');$('status').textContent=tr('removed');await refresh();};
$('run').onclick=event=>{if(!event.isTrusted)return;cancel();$('result').replaceChildren();allAnnotations=[];send('clear');$('status').textContent=tr('preparing');$('status').dataset.state='preparing';sourceRequested=true;send('requestSource');};
$('clear').onclick=()=>{allAnnotations=[];send('clear');};$('style').onchange=marks;
function attachPort(next){if(port)return;port=next;port.onmessage=({data:d})=>{
 if(d.type==='cancel'){cancel();$('status').textContent=uiLanguage==='de'&&d.message?d.message:tr('changed');$('result').replaceChildren();allAnnotations=[];return;}
 if(d.type==='connected'){setLanguage(d.language);return;}if(d.type!=='source'||!sourceRequested)return;sourceRequested=false;setLanguage(d.language);cancel();const mine=++id;epoch=d.source.epoch;running=true;$('run').disabled=true;$('remove').disabled=true;$('cancel').hidden=false;$('status').textContent=tr('initializing');worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
 worker.onerror=()=>{if(mine!==id)return;cancel();report(Error('Das lokale Modell konnte nicht gestartet werden. Browser benötigt WebAssembly und ausreichend freien Speicher.'));};worker.onmessage=({data:r})=>{if(mine!==id||r.id!==mine)return;if(r.type==='timing')send('timing',{phase:r.phase,ms:r.ms,device:r.device});if(r.type==='progress')$('status').textContent=r.phase==='generate'?tr('tokens',{n:r.tokens}):tr(r.phase==='reduce'?'reduce':'chunk',{n:r.current,total:r.total});if(r.type==='part'&&r.epoch===epoch){addPart(r.part,r.index);allAnnotations.push(...r.annotations);marks();send('activeBlock',{blockId:r.part.blockId});}if(r.type==='done'&&r.epoch===epoch){const a=document.createElement('article'),h=document.createElement('h2'),p=document.createElement('p');h.textContent=tr('overview');p.textContent=r.overview;a.append(h,p);$('result').prepend(a);$('status').textContent=tr('complete',{n:r.coverage.chunks,chars:r.coverage.characters});$('status').dataset.state='done';cancel();}if(r.type==='error'){cancel();report(Error(r.message));}};worker.postMessage({type:'explain',id:mine,source:d.source,language:d.language});
 };port.start();send('ready');if(sourceRequested)send('requestSource');}   // a click before the channel was confirmed

/* A website can frame this page itself. Accept a parent channel only after our own controller confirms the nonce
   through an extension-only route: content scripts get tab messages, extension pages get runtime messages. */
async function embeddedByReader(nonce){
 const api=globalThis.chrome,asks=[];
 try{
  const tab=await api.tabs.getCurrent();
  if(Number.isSafeInteger(tab?.id))asks.push(api.tabs.sendMessage(tab.id,{type:'readerExplainVerify',nonce}));
 }catch{}
 try{asks.push(api.runtime.sendMessage({type:'readerExplainVerify',nonce}));}catch{}
 return (await Promise.allSettled(asks)).some(r=>r.status==='fulfilled'&&r.value?.ok===true);
}
let connecting=false;
window.addEventListener('message',event=>{
 if(event.source!==window.parent||event.data?.type!=='reader-explain-connect')return;
 if(event.data.nonce!==location.hash.slice(1)||!event.ports[0]||port||connecting)return;
 const channel=event.ports[0],language=event.data.language;connecting=true;
 const accept=ok=>{if(!ok||port){channel.close();return;}setLanguage(language);attachPort(channel);};
 void embeddedByReader(event.data.nonce).then(accept,()=>channel.close()).finally(()=>{connecting=false;});
});
const capability=new URLSearchParams(location.hash.slice(1)).get('fallback');let heartbeat=null;
if(capability&&globalThis.chrome?.runtime){const raw=chrome.runtime.connect({name:'reader-explain-panel:'+capability});attachPort(runtimePortAdapter(raw,()=>{cancel();$('status').textContent=tr('disconnected');if(heartbeat)clearInterval(heartbeat);}));heartbeat=setInterval(()=>{try{send('ping');}catch{}},20000);}

/* Opened on its own (no reader channel yet): the interface language of the settings, else the browser's, English
   when neither is offered. A channel that connects later brings the reader's language. */
void (async()=>{
 // 'pageSettings' = CONFIG_KEY of config.mjs (not imported: the panel loads no settings modules)
 let lang='';try{lang=(await globalThis.chrome?.storage?.local.get('pageSettings'))?.pageSettings?.uiLanguage||'';}catch{}
 const browser=String(navigator.language||'').split('-')[0];
 if(!port)setLanguage(EXPLAIN_LANGUAGES.includes(lang)?lang:EXPLAIN_LANGUAGES.includes(browser)?browser:'en');
})();
refresh().catch(report);
window.addEventListener('pagehide',()=>{cancel();if(heartbeat)clearInterval(heartbeat);});
