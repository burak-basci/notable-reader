/* Library integration for the existing file reader, never a second player. MIT. */
import * as store from './store.mjs';
import {createReadingQueue} from './queue.mjs';
import {getSaved} from './saved.mjs';
import {libraryText} from './i18n.mjs';
export async function installFileLibrary({app,getText,getTitle,onStatus}){
 const lang=()=>app.settings.uiLanguage||navigator.language,t=(key,vars)=>libraryText(lang(),key,vars),nav=document.querySelector('.app-header nav');
 const link=document.createElement('a');link.href=new URL('./library.html',import.meta.url).href;link.textContent=t('title');nav?.prepend(link);
 const save=document.createElement('button');save.type='button';save.textContent=t('save');nav?.prepend(save);
 save.addEventListener('click',async()=>{try{await store.saveItem({title:getTitle(),text:getText(),language:app.session.lang});onStatus(t('saved'));}catch{onStatus(t('failed'),true);}});
 const banner=document.createElement('div');banner.id='library-queue';banner.hidden=true;banner.style.cssText='display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 0';const label=document.createElement('span'),cancel=document.createElement('button');cancel.type='button';banner.append(label,cancel);document.querySelector('main')?.prepend(banner);
 // "Play all" of the Saved list: items start at the beginning, bookmarks at their remembered spot (library/saved.mjs).
 const queue=createReadingQueue({getItem:getSaved,load:async item=>{await app.loadDocument(item.text,item.title,item.language,item);if(item.startChar>0)await app.session.command('seekChar',item.startChar);},play:()=>app.session.play(),stop:()=>app.session.stop(),onChange:s=>{banner.hidden=!s.active;label.textContent=t('queueStatus',{n:s.index+1,total:s.ids.length});cancel.textContent=t('queueStop');},onError:()=>onStatus(t('failed'),true)});
 cancel.addEventListener('click',()=>queue.cancel());
 const incoming=location.hash,match=incoming.match(/^#(library|queue|capture|history|document|bookmark)=([a-f0-9,-]+)$/i);
 async function loadIncoming(){if(match){history.replaceState(null,'',location.pathname+location.search);try{
  if(match[1]==='queue')await queue.start(match[2].split(','));
  else if(match[1]==='library'){const item=await store.getItem(match[2]);if(!item)throw Error('missing');await app.loadDocument(item.text,item.title,item.language,item);}
  else if(match[1]==='document'){const item=await store.getDocument(match[2]);if(!item)throw Error('missing');if(item.format==='pdf'&&item.source?.text)await app.loadDocument(item.source.text,item.title,item.source.language,{...item.source,fileName:item.filename,mimeType:item.mimeType||'application/pdf'});else await app.loadFile(new File([item.blob],item.filename,{type:item.mimeType||item.blob.type}));}
  else if(match[1]==='bookmark'){const item=await store.getBookmark(match[2]);if(!item)throw Error('missing');await app.loadDocument(item.text,item.title,item.language,item);await app.session.command('seekChar',item.position.char);}
  else if(match[1]==='history'){const item=await store.getHistory(match[2]);if(!item)throw Error('missing');await app.loadDocument(item.text,item.title,item.language,item);if(!item.completed){const pos=item.position;if(Number.isSafeInteger(pos.char))await app.session.command('seekChar',pos.char);else{app.session.position={chunk:Math.max(0,Math.min(pos.chunk,app.session.chunks.length-1)),word:pos.word};app.session.markAt(app.session.position.chunk,app.session.position.word);app.session.changed();}}}
  else{const blob=await store.takeCapture(match[2]);if(!blob)throw Error('missing');await app.loadImage(new File([blob],'beNotable-screenshot.png',{type:blob.type}));}
 }catch{onStatus(t('failed'),true);}}}
 return {loadIncoming,state:value=>queue.state(app.session.lastError?'error':value),cancel:()=>queue.cancel(),snapshot:()=>queue.snapshot(),start:ids=>queue.start(ids),refresh(){link.textContent=t('title');save.textContent=t('save');const s=queue.snapshot();label.textContent=t('queueStatus',{n:s.index+1,total:s.ids.length});cancel.textContent=t('queueStop');}};
}
