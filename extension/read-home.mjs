import * as store from './library/store.mjs';
/* Read tab: where reading last stopped, shown concretely (title, source, progress and the words at that position).
 * Local data only; nothing here starts playback. Texts come from the shared catalog (t). */
const QUOTE_CHARS=150;
function quoteAt(text,char){
 if(typeof text!=='string'||!Number.isSafeInteger(char)||char<0||char>=text.length)return '';
 // Start at the beginning of the word that holds the position, end on a word boundary.
 let start=char;while(start>0&&!/\s/u.test(text[start-1])&&char-start<40)start--;
 const slice=text.slice(start,start+QUOTE_CHARS).replace(/\s+/gu,' ').trim(),cut=slice.length<text.length-start?slice.replace(/\s+\S*$/u,''):slice;
 return cut?cut+(start+QUOTE_CHARS<text.length?' …':''):'';
}
export function mountReadHome(host,{t,language=()=> 'en',skipUrl=()=>null,onResume=()=>{},onLibrary=()=>{}}={}){
 if(!host)return null;const doc=host.ownerDocument,$=s=>host.querySelector(s);
 let disposed=false,busy=false,again=false,last=0,entry=null,quote='',quoteFor='';
 const percent=value=>new Intl.NumberFormat(language(),{style:'percent',maximumFractionDigits:0}).format(Math.max(0,Math.min(1,value||0)));
 const day=value=>{try{return new Date(value).toLocaleDateString(language(),{day:'numeric',month:'short'});}catch{return '';}};
 const source=item=>{if(item.kind==='file')return item.fileName||'';try{return new URL(item.url).hostname.replace(/^www\./,'');}catch{return '';}};
 function paint(){
  const card=$('#read-recent'),empty=$('#read-empty');if(card)card.hidden=!entry;if(empty)empty.hidden=!!entry;if(!entry)return;
  $('#read-recent-title').textContent=entry.title;
  $('#read-recent-detail').textContent=[source(entry),entry.completed?t('popupFinished'):t('popupProgressRead',{percent:percent(entry.progress)}),day(entry.lastRead)].filter(Boolean).join(' · ');
  const q=$('#read-recent-quote');q.hidden=!quote;q.textContent=quote;
  const p=$('#read-recent-progress');p.value=entry.completed?1:entry.progress;p.setAttribute('aria-label',entry.completed?t('popupFinished'):t('popupProgressRead',{percent:percent(entry.progress)}));
  $('#read-resume').setAttribute('aria-label',t(entry.completed?'popupListenAgain':'popupResume')+': '+entry.title);
  const go=$('#read-resume .read-recent-go>span');if(go)go.textContent=t(entry.completed?'popupListenAgain':'popupResume');
 }
 $('#read-resume')?.addEventListener('click',()=>{if(entry)onResume(entry.id);});
 $('#entry-library')?.addEventListener('click',()=>onLibrary('history'));
 async function refresh(force=false){
  if(disposed)return;paint();if(busy){again=again||force;return;}if(!force&&Date.now()-last<2000)return;busy=true;last=Date.now();
  try{
   const skip=skipUrl(),history=await store.listHistory();if(disposed)return;
   entry=history.find(item=>!(skip&&item.url&&store.canonicalSource(skip)===item.url))||null;
   const key=entry?entry.id+':'+entry.lastRead:'';
   if(key!==quoteFor){quoteFor=key;quote='';if(entry&&!entry.completed&&Number.isSafeInteger(entry.position?.char)){const full=await store.getHistory(entry.id).catch(()=>null);quote=quoteAt(full?.text,entry.position.char);}}
   paint();
  }catch{entry=null;paint();}
  finally{busy=false;if(again&&!disposed){again=false;void refresh(true);}}
 }
 const onTab=event=>{if(event.detail?.name==='read')void refresh(true);};doc.defaultView.addEventListener('notable-popup-tab',onTab);
 void refresh(true);
 return {refresh,localize:paint,destroy(){disposed=true;doc.defaultView.removeEventListener('notable-popup-tab',onTab);}};
}
