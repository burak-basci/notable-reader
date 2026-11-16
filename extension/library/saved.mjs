import * as store from './store.mjs';
/* "Saved" (Gemerkt): ONE list of the texts someone wants to hear again, at the spot they remembered.
 * It is a view over the two existing stores, never a data move: listening-list items (a whole text, kept from its start)
 * and bookmarks (a text with a remembered character position). Nothing is migrated, rewritten or deleted here, so every
 * existing entry shows up and nothing can be lost; adding to either store simply appears in the same list.
 * Spots of the same text (same canonical address, else the same document) form one entry: the most recently remembered
 * spot leads, the others are listed under it. The list keeps the order things were saved in (first saved first), like
 * the listening list it continues, so "Play all" plays in that order and new saves go to the end. Own code MIT. */
export const CHARS_PER_MINUTE=900;   // about 150 words a minute at normal speed
/* The order someone set with "move up / down" (full library): a list of entry keys in chrome.storage.local. Entries not
   in it follow in the order they were saved. Keys are the canonical address or the document key: local data only. */
const ORDER_KEY='notableSavedOrder',storage=()=>(globalThis.chrome?.storage?.local?globalThis.chrome:globalThis.browser)?.storage?.local;
async function savedOrder(){try{const value=(await storage()?.get(ORDER_KEY))?.[ORDER_KEY];return Array.isArray(value)?value.filter(k=>typeof k==='string'):[];}catch{return [];}}
export async function moveSaved(groups,key,direction){
 const keys=groups.map(group=>group.key),at=keys.indexOf(key),to=at+direction;if(at<0||to<0||to>=keys.length)return false;
 [keys[at],keys[to]]=[keys[to],keys[at]];await storage()?.set({[ORDER_KEY]:keys.slice(0,2000)});return true;
}
const keyOf=url=>store.canonicalSource(url||'');
/* The words at a bookmark: its stored context starts up to 45 characters before the spot (store.mjs writeBookmark). */
export function spotText(bookmark){
 const context=String(bookmark?.context||''),offset=Math.min(Number(bookmark?.position?.char)||0,45);let text=context.slice(offset);
 if(offset>0&&/\S/u.test(context[offset-1]||''))text=text.replace(/^\S*\s*/u,'');
 return text.replace(/\s+/gu,' ').trim();
}
/* A name someone gave the spot (renamed), not the default (the first words at the spot, store.mjs writeBookmark). */
function customName(bookmark){
 const name=String(bookmark?.name||'').trim();if(!name||name===bookmark.title)return '';
 // The default is the 72 characters from the spot; the context holds them, starting up to 45 characters earlier.
 const context=String(bookmark.context||''),offset=Math.min(Number(bookmark.position?.char)||0,45),fallback=context.slice(offset,offset+72).trim();
 const probe=Math.min(20,name.length,fallback.length);return fallback&&(fallback.slice(0,probe)===name.slice(0,probe))?'':name;
}
function itemSpot(item){
 return {store:'items',id:item.id,key:keyOf(item.url)||'item:'+item.id,title:item.title,url:item.url||'',char:0,percent:0,quote:'',
  remaining:Math.max(1,Math.ceil(String(item.text||'').length/CHARS_PER_MINUTE)),time:Number(item.created)||0,since:Number(item.created)||0,language:item.language||''};
}
function bookmarkSpot(bookmark,length){
 const char=Math.max(0,Number(bookmark.position?.char)||0),known=Number.isFinite(length)&&length>0;
 return {store:'bookmarks',id:bookmark.id,key:keyOf(bookmark.url)||bookmark.documentKey,title:bookmark.title||bookmark.name,url:bookmark.navigationURL||bookmark.url||'',
  fileName:bookmark.fileName||'',name:bookmark.name||'',custom:customName(bookmark),chapter:bookmark.chapter||'',char,percent:known?Math.min(1,char/length):null,quote:char>0?spotText(bookmark):'',
  remaining:known?Math.max(1,Math.ceil((length-char)/CHARS_PER_MINUTE)):null,time:Number(bookmark.updated||bookmark.created)||0,since:Number(bookmark.created||bookmark.updated)||0,language:bookmark.language||''};
}
/* All saved texts in the set or first-saved order; `query` filters through the stores' own search. */
export async function listSaved({query=''}={}){
 // The stores' own search (title, text, address; name and context of bookmarks) decides what matches `query`.
 const [items,bookmarks,order]=await Promise.all([store.listItems({query}),store.listBookmarks({query}),savedOrder()]);
 const lengths=await store.bookmarkTextLengths(bookmarks.map(b=>b.documentKey)).catch(()=>new Map());
 const groups=new Map();
 for(const spot of [...items.map(itemSpot),...bookmarks.map(b=>bookmarkSpot(b,lengths.get(b.documentKey)))]){
  const group=groups.get(spot.key)||{key:spot.key,spots:[]};group.spots.push(spot);groups.set(spot.key,group);
 }
 return [...groups.values()].map(group=>{group.spots.sort((a,b)=>b.time-a.time);const [head,...others]=group.spots;return {key:group.key,head,others,title:head.title,url:head.url||group.spots.find(s=>s.url)?.url||'',time:head.time,since:Math.min(...group.spots.map(s=>s.since))};})
  .sort((a,b)=>{const x=order.indexOf(a.key),y=order.indexOf(b.key);return x>=0&&y>=0?x-y:x>=0?-1:y>=0?1:a.since-b.since;});
}
export const openPath=spot=>'tools/reader/reader.html#'+(spot.store==='items'?'library':'bookmark')+'='+spot.id;
/* "Play all": the leading spot of every saved text, in list order (the file view's queue accepts both kinds). */
export const queueIds=groups=>groups.map(group=>group.head.id).slice(0,100);
/* Remove spots now and return an exact undo (the records read just before removing them). */
export async function removeSpots(spots){
 const snapshots=[];
 for(const spot of spots){const record=spot.store==='items'?await store.getItem(spot.id):await store.getBookmark(spot.id);if(record)snapshots.push([spot.store,record]);}
 for(const spot of spots){if(spot.store==='items')await store.removeItem(spot.id);else await store.removeBookmark(spot.id);}
 return async()=>{for(const [kind,record] of snapshots){if(kind==='items')await store.restoreItem(record);else await store.restoreBookmark(record);}};
}
/* Is this address already saved from its start? (Saving it again would only add a second identical entry.) */
export async function savedFromStart(url){
 const key=keyOf(url);if(!key)return false;
 return (await listSaved()).some(group=>group.key===key&&[group.head,...group.others].some(spot=>spot.char===0));
}
/* Load one queue/open id from either store, with the text: used by the file view's "play all" queue. */
export async function getSaved(id){
 const item=await store.getItem(id);if(item)return {...item,startChar:0};
 const bookmark=await store.getBookmark(id);return bookmark?{...bookmark,startChar:Math.max(0,Number(bookmark.position?.char)||0)}:null;
}
const ICON={
 saved:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
 remove:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
};
/* One saved text as a list entry: title, source, spot ("at 42 %" and the quoted words when not at the start), time left;
   main action "Listen" (opens at the spot), remove (the whole text; Undo is the caller's toast), further spots below. */
export function renderSavedGroup(group,{doc=document,t=key=>key,lang='en',onOpen=()=>{},onRemove=()=>{},onRename=null,onMove=null,first=false,last=false}={}){
 const el=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const percent=value=>new Intl.NumberFormat(lang,{style:'percent',maximumFractionDigits:0}).format(Math.max(0,Math.min(1,value||0)));
 const host=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}};
 const meta=(spot,withSource)=>{const p=el('p','saved-meta'),parts=[];
  if(withSource){const h=host(spot.url||group.url);if(h){const a=el('a','',h);a.href=spot.url||group.url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';parts.push(a);}else if(spot.fileName)parts.push(doc.createTextNode(spot.fileName));}
  if(spot.char>0&&spot.percent!==null)parts.push(doc.createTextNode(t('popupLibAtPercent',{percent:percent(spot.percent)})));
  if(spot.remaining)parts.push(doc.createTextNode(t(spot.char>0?'popupLibRemaining':'popupLibMinutes',{minutes:spot.remaining})));
  if(spot.chapter)parts.push(doc.createTextNode(spot.chapter));
  parts.forEach((part,i)=>{if(i)p.append(doc.createTextNode(' · '));p.append(part);});return p;};
 const actions=(spot,label,removeAll)=>{const box=el('div','item-actions plib-entry-actions'),go=el('button','plib-main',t('popupLibListen')),drop=el('button','plib-remove');
  go.type=drop.type='button';go.setAttribute('aria-label',t('popupLibListen')+': '+label);go.addEventListener('click',()=>onOpen(spot));
  drop.innerHTML=ICON.remove;const name=t('popupLibRemove',{title:label});drop.setAttribute('aria-label',name);drop.title=name;drop.addEventListener('click',()=>onRemove(removeAll?[group.head,...group.others]:[spot],label));
  box.append(go);if(onRename&&spot.store==='bookmarks'){const r=el('button','saved-rename',t('rename'));r.type='button';r.addEventListener('click',()=>onRename(spot));box.append(r);}
  if(onMove&&removeAll)for(const [key,direction] of [['up',-1],['down',1]]){const m=el('button','saved-move',t(key));m.type='button';m.disabled=direction<0?first:last;m.addEventListener('click',()=>onMove(group,direction));box.append(m);}
  box.append(drop);return box;};
 const li=el('li','plib-entry saved-entry'),lead=el('span','plib-lead'),copy=el('div','plib-entry-copy'),title=el('h4','',group.title);
 li.dataset.kind='saved';li.dataset[group.head.store==='items'?'itemId':'bookmarkId']=group.head.id;lead.innerHTML=ICON.saved;lead.setAttribute('aria-hidden','true');title.title=group.title;
 copy.append(title,meta(group.head,true));
 if(group.head.custom)copy.append(el('p','saved-name',group.head.custom));
 if(group.head.quote){const q=el('p','plib-quote');q.append(el('q','',group.head.quote));copy.append(q);}
 if(group.others.length){
  const more=el('details','saved-more'),summary=el('summary','',t('popupLibMoreSpots',{count:group.others.length})),list=el('ol','saved-spots');more.append(summary,list);
  for(const spot of group.others){const item=el('li','saved-spot'),body=el('div','plib-entry-copy');item.dataset[spot.store==='items'?'itemId':'bookmarkId']=spot.id;
   if(spot.custom)body.append(el('p','saved-name',spot.custom));
   if(spot.quote){const q=el('p','plib-quote');q.append(el('q','',spot.quote));body.append(q);}else body.append(el('p','saved-start',t('popupLibFromStart')));
   body.append(meta(spot,false));item.append(body,actions(spot,spot.quote||group.title,false));list.append(item);}
  copy.append(more);
 }
 li.append(lead,copy,actions(group.head,group.title,true));return li;
}
