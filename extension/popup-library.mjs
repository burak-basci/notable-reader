import * as store from './library/store.mjs';
import {listSaved,renderSavedGroup,openPath,queueIds,removeSpots} from './library/saved.mjs';
/* beNotable! Reader · Library tab of the toolbar popup: two areas.
 *  - Saved (Gemerkt): texts to hear again, each at the spot remembered (library/saved.mjs merges the listening-list
 *    and bookmark stores into this one list; nothing is moved). "Play all" plays them one after another.
 *  - History: what was read, with the last position.
 * One main action per entry; removing offers Undo instead of a confirmation. Audio exports and documents stay in the
 * full library page. Local IndexedDB only; nothing here plays audio. */
const AREAS=['saved','history'];
const LIMIT=30;
const ICON={
 play:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/></svg>',
 history:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/></svg>',
 saved:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
 savedAdd:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4zM12 7v6M9 10h6"/></svg>',
 remove:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
};
const TAB_ICON={saved:ICON.saved,history:ICON.history};
export async function mountPopupLibrary(host,{t,language=()=> 'en',onOpen=()=>{},onAction=async()=>false,canAct=()=>true,notify=()=>{},area='saved'}={}){
 if(!host)throw new Error('Library host missing');
 const doc=host.ownerDocument,api=globalThis.chrome?.runtime?.id?globalThis.chrome:globalThis.browser;
 let current=AREAS.includes(area)?area:'saved',serial=0,data={saved:[],history:[]},destroyed=false;
 const el=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const lang=()=>String(language()||'en');
 const percent=value=>new Intl.NumberFormat(lang(),{style:'percent',maximumFractionDigits:0}).format(Math.max(0,Math.min(1,value||0)));
 const day=value=>{try{return new Date(value).toLocaleDateString(lang(),{day:'numeric',month:'short'});}catch{return '';}};
 const host_=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}};
 const button=(cls,label,html='')=>{const b=el('button',cls);b.type='button';b.innerHTML=html;b.append(doc.createTextNode(label));return b;};

 const root=el('div','plib'),tabs=el('div','plib-tabs'),message=el('p','plib-message'),foot=el('div','plib-foot'),full=el('button','read-text-link');
 tabs.setAttribute('role','tablist');message.setAttribute('role','status');full.type='button';full.id='plib-full';foot.append(full);
 const parts={};
 for(const name of AREAS){
  const tab=el('button');tab.type='button';tab.id=name+'-tab';tab.setAttribute('role','tab');tab.setAttribute('aria-controls',name);tab.dataset.plib=name;
  const icon=el('span','plib-tab-icon');icon.innerHTML=TAB_ICON[name];const label=el('span'),count=el('span','plib-count','0');count.setAttribute('aria-hidden','true');tab.append(icon,label,count);tabs.append(tab);
  const panel=el('section','plib-panel');panel.id=name;panel.dataset.area=name;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);panel.tabIndex=-1;
  const head=el('div','plib-head'),intro=el('p'),actions=el('div','plib-actions'),list=el('ol','plib-list'),empty=el('div','plib-empty'),emptyText=el('p'),more=el('p','plib-more');
  list.id=name==='saved'?'items':'history-items';head.append(intro,actions);empty.append(emptyText);panel.append(head,list,empty,more);
  parts[name]={tab,label,count,panel,head,intro,actions,list,empty,emptyText,more};
 }
 // Saved: "play all" and "save this page" (the popup saves from the start, or at the spot when this page is being read).
 const playAll=button('plib-button primary','',ICON.play);playAll.id='play-queue';
 const savePage=button('plib-button','',ICON.savedAdd);savePage.dataset.plibAdd='savePage';savePage.id='entry-save-page';
 parts.saved.actions.append(playAll,savePage);
 const emptyAction={saved:button('plib-button primary','',ICON.savedAdd),history:button('plib-button primary','',ICON.play)};
 emptyAction.saved.dataset.plibAdd='savePage';emptyAction.history.dataset.plibAdd='readPage';
 for(const name of AREAS)parts[name].empty.append(emptyAction[name]);
 root.append(tabs,...AREAS.map(name=>parts[name].panel),message,foot);host.replaceChildren(root);

 const say=(text='')=>{message.textContent=text;};
 const setText=(node,text)=>{const last=node.lastChild;if(last?.nodeType===3)last.textContent=text;else node.append(doc.createTextNode(text));};
 const NAMES={saved:'popupLibSaved',history:'popupLibHistory'};
 function localize(){
  tabs.setAttribute('aria-label',t('popupTabLibrary'));
  for(const name of AREAS)parts[name].label.textContent=t(NAMES[name]);
  parts.saved.intro.textContent=t('popupLibSavedIntro');parts.history.intro.textContent=t('popupLibHistoryIntro');
  parts.saved.emptyText.textContent=t('popupLibSavedEmpty');parts.history.emptyText.textContent=t('popupLibHistoryEmpty');
  setText(playAll,t('popupLibPlayAll'));setText(savePage,t('popupLibSavePage'));setText(emptyAction.saved,t('popupLibSavePage'));setText(emptyAction.history,t('popupReadPage'));
  setText(full,t('popupLibFull'));paintCounts();availability();
 }
 function availability(){
  const page=canAct();
  for(const b of [savePage,emptyAction.saved,emptyAction.history]){b.disabled=!page;if(page)b.removeAttribute('title');else b.title=t('popupUnsupported');}
 }
 function paintCounts(){for(const name of AREAS){const n=data[name].length;parts[name].count.textContent=String(n);parts[name].tab.setAttribute('aria-label',t(NAMES[name])+' ('+n+')');}}
 function select(name,focus=false){
  if(!AREAS.includes(name))return;current=name;
  for(const key of AREAS){const on=key===name,p=parts[key];p.tab.setAttribute('aria-selected',String(on));p.tab.tabIndex=on?0:-1;p.panel.hidden=!on;}
  if(focus)parts[name].tab.focus();
 }
 function metaParts(values,url){
  const out=[],host=url?host_(url):'';
  if(host){const a=el('a','',host);a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';out.push(a);}
  for(const v of values.filter(Boolean)){if(out.length)out.push(doc.createTextNode(' · '));out.push(doc.createTextNode(v));}
  return out;
 }
 function historyEntry(item){
  const li=el('li','plib-entry'),lead=el('span','plib-lead'),copy=el('div','plib-entry-copy'),title=el('h4','',item.title),meta=el('p');li.dataset.kind='history';li.dataset.historyId=item.id;
  lead.innerHTML=ICON.history;lead.setAttribute('aria-hidden','true');
  meta.append(...metaParts([item.kind==='file'?item.fileName:null,item.completed?t('popupFinished'):t('popupProgressRead',{percent:percent(item.progress)}),day(item.lastRead)],item.navigationURL||item.url));
  const p=el('progress');p.max=1;p.value=item.completed?1:item.progress||0;p.setAttribute('aria-label',item.completed?t('popupFinished'):t('popupProgressRead',{percent:percent(item.progress)}));copy.append(title,meta,p);
  const main=item.completed?'popupListenAgain':'popupResume',actions=el('div','item-actions plib-entry-actions'),go=el('button','plib-main',t(main)),drop=el('button','plib-remove');
  go.type=drop.type='button';go.setAttribute('aria-label',t(main)+': '+item.title);drop.innerHTML=ICON.remove;const removeLabel=t('popupLibRemove',{title:item.title});drop.setAttribute('aria-label',removeLabel);drop.title=removeLabel;
  go.addEventListener('click',()=>void Promise.resolve(onOpen('tools/reader/reader.html#history='+item.id)).catch(()=>say(t('popupLibFailed'))));
  drop.addEventListener('click',()=>void removeHistory(item,li));
  actions.append(go,drop);li.append(lead,copy,actions);return li;
 }
 const focusAfter=(kind,li)=>{const next=li.nextElementSibling||li.previousElementSibling,ids=n=>[n.dataset.itemId,n.dataset.historyId,n.dataset.bookmarkId],nextId=next?ids(next).find(Boolean):'';return ()=>{const target=nextId?[...parts[kind].list.children].find(n=>ids(n).includes(nextId))?.querySelector('.plib-main'):null;(target||parts[kind].tab).focus();};};
 async function removeHistory(item,li){
  say();try{const refocus=focusAfter('history',li),snapshot=await store.getHistory(item.id);await store.removeHistory(item.id);await refresh();refocus();
   if(snapshot)notify(t('popupLibRemoved',{title:item.title}),{undo:async()=>{try{await store.restoreHistory(snapshot);await refresh();select('history');}catch{say(t('popupLibFailed'));}}});}
  catch{say(t('popupLibFailed'));await refresh().catch(()=>{});}
 }
 async function removeSaved(spots,label,li){
  say();try{const refocus=focusAfter('saved',li),undo=await removeSpots(spots);await refresh();refocus();
   notify(t('popupLibRemoved',{title:label}),{undo:async()=>{try{await undo();await refresh();select('saved');}catch{say(t('popupLibFailed'));}}});}
  catch{say(t('popupLibFailed'));await refresh().catch(()=>{});}
 }
 async function refresh(){
  if(destroyed)return;const run=++serial;
  const [saved,history]=await Promise.all([listSaved(),store.listHistory()]);
  if(run!==serial||destroyed)return;data={saved,history};
  parts.saved.list.replaceChildren(...saved.slice(0,LIMIT).map(group=>{const li=renderSavedGroup(group,{doc,t,lang:lang(),onOpen:spot=>void Promise.resolve(onOpen(openPath(spot))).catch(()=>say(t('popupLibFailed'))),onRemove:(spots,label)=>void removeSaved(spots,label,li)});return li;}));
  parts.history.list.replaceChildren(...history.slice(0,LIMIT).map(historyEntry));
  for(const name of AREAS){const p=parts[name],list=data[name],none=!list.length;p.list.hidden=none;p.head.hidden=none;p.empty.hidden=!none;
   p.more.hidden=list.length<=LIMIT;p.more.textContent=list.length>LIMIT?t('popupLibMore',{count:list.length-LIMIT}):'';}
  playAll.disabled=!saved.length;paintCounts();availability();
 }
 // Area tabs: arrow keys move between the areas (roving tabindex), like the main tabs.
 for(const name of AREAS){const tab=parts[name].tab;tab.addEventListener('click',()=>select(name));tab.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
  const at=AREAS.indexOf(name),next=event.key==='Home'?0:event.key==='End'?AREAS.length-1:(at+(event.key==='ArrowRight'?1:AREAS.length-1))%AREAS.length;select(AREAS[next],true);});}
 playAll.addEventListener('click',()=>{if(data.saved.length)void Promise.resolve(onOpen('tools/reader/reader.html#queue='+queueIds(data.saved).join(','))).catch(()=>say(t('popupLibFailed')));});
 root.addEventListener('click',event=>{const b=event.target.closest('[data-plib-add]');if(!b||b.disabled)return;void (async()=>{say();const ok=await onAction(b.dataset.plibAdd);if(ok)await refresh();})();});
 full.addEventListener('click',()=>void Promise.resolve(onOpen('library/library.html')).catch(()=>say(t('popupLibFailed'))));
 const onStorage=(changes,area)=>{if(area==='local'&&changes[store.BOOKMARK_REVISION_KEY])void refresh().catch(()=>{});};api?.storage?.onChanged?.addListener(onStorage);
 const onFocus=()=>void refresh().catch(()=>{});doc.defaultView.addEventListener('focus',onFocus);
 localize();select(current);await refresh().catch(()=>say(t('popupLibFailed')));
 // Old names of the two merged areas still open the saved list.
 const alias=name=>['articles','bookmarks','documents','audio'].includes(name)?'saved':name;
 return {refresh,localize,availability,setLanguage(){localize();void refresh().catch(()=>{});},selectTab(name){select(alias(name));},stopAudio(){},
  destroy(){destroyed=true;api?.storage?.onChanged?.removeListener(onStorage);doc.defaultView.removeEventListener('focus',onFocus);host.replaceChildren();}};
}
