/* This is a remote control for the document, never a second audio owner. */
import {FilePlayerTransport,isOwnFileUrl} from './file-player-transport.mjs';
import {listSaved,openPath,savedFromStart} from './library/saved.mjs';
import {catalogReady,getUiLanguage,setUiLanguage,uiLanguages,t as text} from './i18n.js';
const api=globalThis.chrome?.runtime?.id?globalThis.chrome:globalThis.browser,$=s=>document.querySelector(s);
await catalogReady;let tabId=Number(new URL(location.href).searchParams.get('tabId'))||null,source=null,status=null,pending=false,noAccess=false;
// texts from the shared catalog (six languages): sidebarRead, sidebarQueue … and the common settings label
const t=key=>text(key==='settings'?key:'sidebar'+key[0].toUpperCase()+key.slice(1));
async function send(message){try{if(source&&isOwnFileUrl(source.url)&&!(message.type==='control'&&['readPage','readSelection','selectArea','captureArea','saveForLater','openSettings','pickNextChapter'].includes(message.command)))return await new FilePlayerTransport(source.id).send(message);return await api.runtime.sendMessage({...message,...(Number.isInteger(tabId)?{tabId}:{})})||{ok:false};}catch{return{ok:false};}}
function allowed(tab){try{const u=new URL(tab.url);return ['http:','https:','file:'].includes(u.protocol)||u.protocol===new URL(api.runtime.getURL('')).protocol&&u.host===new URL(api.runtime.getURL('')).host&&u.pathname==='/tools/reader/reader.html';}catch{return false;}}
function paint(){
 document.documentElement.lang=getUiLanguage();for(const e of document.querySelectorAll('[data-copy]'))e.textContent=t(e.dataset.copy);
 $('#source-title').textContent=source?(status?.sourceTitle||status?.title||source.title||'beNotable! Reader'):'beNotable! Reader';$('#source-hint').textContent=t(source?status?.playback?.playing&&!status?.playback?.paused?'playing':'ready':noAccess?'access':'none');
 $('#settings').setAttribute('aria-label',t('settings'));$('#read').textContent=t(status?.playback?.paused?'resume':status?.playback?.playing?'pause':status?.sourceContext?.overlayVisible===true?'read':'openBar');   // no bar open yet: the first press opens it (paused), the next readsfor(const id of ['read','stop','settings','save','show-document'])$('#'+id).disabled=!source||pending;
}
async function resolve(){
 if(pending)return;
 try{const s=(await api.storage.local.get('pageSettings')).pageSettings;if(uiLanguages.some(x=>x.code===s?.uiLanguage))setUiLanguage(s.uiLanguage);}catch{}
 // A hidden URL means the browser grants no access to this tab yet (no toolbar click on it).
 try{const [active]=await api.tabs.query({active:true,currentWindow:true});noAccess=!!active&&typeof active.url!=='string';if(active&&allowed(active)){source=active;tabId=active.id;}else if(Number.isInteger(tabId)){const known=await api.tabs.get(tabId).catch(()=>null);source=known&&allowed(known)?known:null;}}catch{source=null;}
 if(source){const result=await send({type:'snapshot'});status=result.ok&&result.targetContext?.bound===true?result.status:null;if(result.ok&&result.title)source={...source,title:result.title};}
 paint();await renderQueue();
}
async function command(name){if(pending||!source)return;pending=true;paint();$('#error').hidden=true;try{if(!source.active){source=await api.tabs.update(source.id,{active:true});tabId=source.id;}const result=await send({type:'control',command:name});if(!result.ok){$('#error').textContent=t(result.code==='page_access_required'?'access':'error');$('#error').hidden=false;}else if(name==='saveForLater'||name==='addBookmark')$('#source-hint').textContent=t('saved');}catch{$('#error').textContent=t('error');$('#error').hidden=false;}finally{pending=false;await resolve();}}
$('#read').addEventListener('click',()=>void command(status?.playback?.playing||status?.playback?.paused?'toggle':'readPage'));
$('#stop').addEventListener('click',()=>void command('stop'));$('#settings').addEventListener('click',()=>void command('openSettings'));$('#save').addEventListener('click',async()=>{const reading=status?.playback?.playing||status?.playback?.paused;if(!reading&&source?.url&&await savedFromStart(source.url).catch(()=>false)){$('#source-hint').textContent=t('saved');return;}void command(reading?'addBookmark':'saveForLater');});
$('#show-document').addEventListener('click',async()=>{if(source)await api.tabs.update(source.id,{active:true});});
$('#open-library').addEventListener('click',()=>api.tabs.create({url:api.runtime.getURL('library/library.html')}));
async function renderQueue(){
 // The Saved list (listening list and remembered spots, library/saved.mjs) is local-only. Nothing leaves the extension.
 let entries=[];try{entries=await listSaved();}catch{}
 const list=$('#queue-list');list.replaceChildren();$('#queue-empty').hidden=entries.length>0;
 for(const entry of entries.slice(0,30)){const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.textContent=String(entry.title||'—');button.addEventListener('click',()=>api.tabs.create({url:api.runtime.getURL(openPath(entry.head))}));li.append(button);list.append(li);}
}
await resolve();const tick=setInterval(()=>{if(!document.hidden)void resolve();},2000);window.addEventListener('pagehide',()=>clearInterval(tick),{once:true});api.tabs.onActivated?.addListener(()=>void resolve());api.storage.onChanged?.addListener((_,area)=>{if(area==='local')void resolve();});
