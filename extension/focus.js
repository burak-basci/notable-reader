import {createAppearanceController} from './appearance.mjs';
import {cleanAppearance} from './reader-api.js';
import {mountBoundPlayer} from './player-adapter.mjs';
import {createFormatting} from './formatting.mjs';
import {t,errorText,setUiLanguage,getUiLanguage,translateDOM,catalogReady,formatLocales} from './i18n.js';
await catalogReady;
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const formatting=createFormatting({formatLocales}),sessionId=crypto.randomUUID(),sectionAnchors=new WeakMap();
const appearance=createAppearanceController({document,kind:'html',contentRoot:$('#focus-document'),uiHost:$('#focus-header'),flow:true});
let status=null,source=null,loading=false,loadSerial=0,transferId=null,closed=false,loadFailed=false,lastLanguage=null,lastSection=-1;
const preferences=()=>formatting.preferences(status?.settings||{}),number=(value,options={})=>formatting.number(value,preferences(),options);
async function send(value){try{return await chrome.runtime.sendMessage(value)||{ok:false,code:'closed'};}catch{return {ok:false,code:'closed'};}}
function setError(code){const text=errorText(code);if($('#focus-error').textContent!==text)$('#focus-error').textContent=text;$('#focus-error').hidden=false;}
function visibleSourceSection(){
 const candidates=$$('.focus-document-section').filter(node=>(sectionAnchors.get(node)||[]).length&&node.getBoundingClientRect().bottom>0&&node.getBoundingClientRect().top<innerHeight-170);
 const node=candidates[0];return node?sectionAnchors.get(node)[0]:null;
}
const player=await mountBoundPlayer({mount:$('#focus-player'),variant:'overlay',view:'focus',appearanceController:appearance,
 getContext:()=>({sourceGeneration:source?.generation||null,contentReady:!!source&&!loading&&!loadFailed}),getVisibleSourceSection:visibleSourceSection,
 onStatus:value=>{status=value;render();},onFailure:setError,onOpenFocus:()=>$('#focus-document').focus({preventScroll:true}),
 onClose:()=>setSurfaceVisible(false)});
function setSurfaceVisible(visible){player.surface.setVisibility?.(visible);player.surface.host.style.display=visible?'':'none';$('#focus-reopen').hidden=visible;return player.surface.getActualVisible?.()??(player.surface.host.getBoundingClientRect().width>0);}
window.notableFocusSurface=Object.freeze({getState:()=>({generation:source?.generation||null,visible:player.surface.getActualVisible?.()??(player.surface.host.getBoundingClientRect().width>0)}),setVisible:(visible,generation)=>typeof visible==='boolean'&&source?.generation===generation?setSurfaceVisible(visible):null});
function localize(){setUiLanguage(status?.uiLanguage||status?.settings?.uiLanguage);if(lastLanguage!==getUiLanguage()){lastLanguage=getUiLanguage();translateDOM();document.title='Notable Reader · '+t('extFocusTitle');}}
function render(){
 localize();const settings=cleanAppearance(status?.settings?.appearance||status?.appearance);
 document.documentElement.style.setProperty('--focus-content-width',settings.contentWidth+'px');document.documentElement.dataset.readerTheme=['dark','light'].includes(settings.mode)?settings.mode:'';appearance.update(settings);
 for(const marker of $$('.focus-page-reference')){marker.hidden=settings.hidePageNumbers;marker.textContent=t('focusPageReference',{page:number(Number(marker.dataset.page))});}
 $('#focus-retry').disabled=loading;$('#focus-reload').disabled=loading;
 for(const node of $$('.focus-document-section'))node.classList.toggle('is-current',(sectionAnchors.get(node)||[]).includes(status?.sectionIndex));
 if(source){$('#focus-title').textContent=source.title||t('extFocusUntitled');$('#focus-meta').textContent=t('extFocusContents',{sections:number(source.sections.length),images:number(source.sections.reduce((sum,item)=>sum+item.images.length,0))});}
 else{$('#focus-title').textContent=t('extFocusTitle');$('#focus-meta').textContent='';$('#focus-raster-hint').hidden=true;}
 const current=status?.sourceContext?.generation||status?.documentState?.generation;
 const changed=!!source&&source.generation!==current;
 if(changed)setError('document_changed');
 player.update(status,{connected:!!status,errorCode:changed?'document_changed':null});
 if(source&&!changed&&!loading&&settings&&status?.settings?.follow&&lastSection!==status?.sectionIndex){const current=$('.focus-document-section.is-current');if(current&&(status?.playback?.playing||status?.playback?.paused))current.scrollIntoView({block:'nearest',behavior:'auto'});}
 lastSection=status?.sectionIndex;
}
async function refresh(){if(closed)return;const result=await send({type:'snapshot'});if(closed)return;status=result.ok?result.status:null;if(!result.ok)setError(result.code||'unavailable');render();}
function renderDocument(value){
 const fragment=document.createDocumentFragment();let lastPage=null;
 for(const section of value.sections){
  const node=document.createElement('section');node.className='focus-document-section';node.dataset.focusIndex=String(section.index);sectionAnchors.set(node,section.sourceSections||[]);node.dataset.nativeSections=JSON.stringify(section.sourceSections||[]);
  if(value.sourceKind==='pdf'&&section.page&&section.page!==lastPage){const marker=document.createElement('span');marker.className='focus-page-reference';marker.dataset.page=String(section.page);marker.textContent=t('focusPageReference',{page:number(section.page)});marker.hidden=cleanAppearance(status?.appearance).hidePageNumbers;node.append(marker);lastPage=section.page;}
  if(section.heading){const heading=document.createElement('h'+Math.max(2,Math.min(6,section.level||2)));heading.textContent=section.heading;node.append(heading);}
  if(section.text&&section.text!==section.heading){const paragraph=document.createElement('p');paragraph.textContent=section.text;node.append(paragraph);}
  for(const image of section.images){const figure=document.createElement('figure'),img=document.createElement('img');img.alt=image.alt||'';img.loading='lazy';img.decoding='async';if(image.kind)img.dataset.readerFigureKind=image.kind;img.addEventListener('error',()=>{loadFailed=true;setError('document_images_unavailable');render();},{once:true});img.src=image.src;figure.append(img);if(image.caption){const caption=document.createElement('figcaption');caption.textContent=image.caption;figure.append(caption);}node.append(figure);}
  fragment.append(node);
 }
 $('#focus-document').replaceChildren(fragment);$('#focus-document').dataset.generation=value.generation;$('#focus-document').lang=value.language||document.documentElement.lang;
 history.replaceState(null,'',location.pathname+'#doc='+value.generation);
 $('#focus-raster-hint').hidden=!value.presentation.rasterized;appearance.refresh();
}
async function loadDocument(force=false){
 if(loading||closed)return;loading=true;loadFailed=false;const serial=++loadSerial;
 $('#focus-error').hidden=true;$('#focus-notice').hidden=false;$('#focus-message').textContent=t('extFocusLoading');$('#focus-hint').textContent=t('extFocusEmptyHint');$('#focus-document').setAttribute('aria-busy','true');render();
 try{
  const transfer=await send({type:'document',sessionId,...(force?{refresh:true}:{})});if(!transfer.ok)throw {code:transfer.code};transferId=transfer.transferId;
  if(typeof transferId!=='string'||!Number.isSafeInteger(transfer.length)||transfer.length<1||transfer.length>320*1024*1024)throw {code:'document_too_large'};
  const parts=[];let offset=0;
  while(offset<transfer.length){if(serial!==loadSerial||closed)return;const reply=await send({type:'documentChunk',sessionId,transferId,offset});if(!reply.ok)throw {code:reply.code};if(reply.offset!==offset||typeof reply.chunk!=='string'||!reply.chunk.length||reply.chunk.length>1024*1024)throw {code:'protocol'};parts.push(reply.chunk);offset+=reply.chunk.length;if(reply.done!==(offset===transfer.length))throw {code:'protocol'};}
  transferId=null;const loaded=JSON.parse(parts.join('')),fresh=await send({type:'snapshot'});if(fresh.ok)status=fresh.status;
  if(!fresh.ok||!loaded.complete||loaded.generation!==(status?.sourceContext?.generation||status?.documentState?.generation))throw {code:'document_changed'};
  source=loaded;renderDocument(loaded);$('#focus-notice').hidden=true;
 }catch(error){if(serial===loadSerial&&!closed){loadFailed=true;source=null;$('#focus-document').replaceChildren();delete $('#focus-document').dataset.generation;history.replaceState(null,'',location.pathname);$('#focus-message').textContent=t('extFocusFailed');$('#focus-notice').hidden=false;setError(typeof error?.code==='string'?error.code:'protocol');}}
 finally{if(transferId){void send({type:'documentRelease',sessionId,transferId});transferId=null;}if(serial===loadSerial){loading=false;$('#focus-document').setAttribute('aria-busy','false');render();}}
}
for(const id of ['focus-retry','focus-reload'])$('#'+id).addEventListener('click',()=>loadDocument(true));
$('#focus-reopen').addEventListener('click',()=>{setSurfaceVisible(true);player.surface.refreshLayout();});
const manualScroll=event=>{if(!event.isTrusted||event.composedPath().includes(player.surface.host)||!status?.settings?.follow)return;if(event.type==='keydown'&&!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))return;void player.command('follow',false);};
window.addEventListener('wheel',manualScroll,{passive:true});window.addEventListener('touchmove',manualScroll,{passive:true});window.addEventListener('keydown',manualScroll);
await refresh();void loadDocument();const poll=setInterval(()=>{if(!document.hidden)void refresh();},1500);
window.addEventListener('pagehide',()=>{closed=true;loadSerial++;clearInterval(poll);player.destroy();appearance.destroy();window.removeEventListener('wheel',manualScroll);window.removeEventListener('touchmove',manualScroll);window.removeEventListener('keydown',manualScroll);if(transferId)void send({type:'documentRelease',sessionId,transferId});},{once:true});
