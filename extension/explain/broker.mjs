// The service worker relays ephemeral extension ports only. No page text is stored.
export function registerExplainBroker({chrome:api=globalThis.chrome,authorize=()=>true,authorizeFrame=async()=>false}={}){
 const records=new Map(),sourceKeys=new Map(),panelURL=api.runtime.getURL('explain/panel.html'),firefox=panelURL.startsWith('moz-extension://');
 function drop(r,remove=true){if(!r||r.closed)return;r.closed=true;records.delete(r.nonce);if(sourceKeys.get(r.key)===r)sourceKeys.delete(r.key);for(const p of [r.source,r.panel]){try{p?.disconnect();}catch{}}if(remove&&r.panelTabId!=null)api.tabs.remove(r.panelTabId).catch(()=>{});}
 const open=(m,sender,reply)=>{if(m?.type==='readerExplainFallbackCancel'){const r=records.get(m.nonce);const own=r&&sender.id===api.runtime.id&&sender.tab?.id===r.sourceTabId&&sender.frameId===r.frameId&&sender.url===r.url&&(r.documentId!==null?sender.documentId===r.documentId:firefox&&sender.documentId==null);if(own)drop(r);reply({ok:!!own});return false;}if(m?.type!=='readerExplainFallbackOpen')return false;(async()=>{
  if(sender.id!==api.runtime.id||!Number.isInteger(sender.tab?.id)||(!Number.isSafeInteger(sender.frameId)||sender.frameId<0||sender.frameId>0&&!await authorizeFrame({sender,epoch:m.epoch}))||!(typeof sender.documentId==='string'||firefox&&sender.documentId==null)||!/^https?:\/\//u.test(sender.url||'')||typeof m.nonce!=='string'||!/^[a-zA-Z0-9-]{32,80}$/u.test(m.nonce)||!['number','string'].includes(typeof m.epoch)||!await authorize({sender,epoch:m.epoch}))throw Error('Erklärquelle nicht autorisiert.');
  if(records.has(m.nonce))throw Error('Capability bereits verwendet.');const key=sender.tab.id+':'+sender.frameId+':'+(sender.documentId||'firefox-live-port')+':'+sender.url+':'+String(m.epoch);drop(sourceKeys.get(key));const r={nonce:m.nonce,key,sourceTabId:sender.tab.id,frameId:sender.frameId,tabUrl:sender.tab.url||sender.url,documentId:typeof sender.documentId==='string'?sender.documentId:null,url:sender.url,epoch:m.epoch,language:['de','en','fr','es','it','pt'].includes(m.language)?m.language:'en',source:null,panel:null,panelTabId:null,closed:false};records.set(r.nonce,r);sourceKeys.set(key,r);
  try{const tab=await api.tabs.create({url:panelURL+'#fallback='+encodeURIComponent(r.nonce),active:true});if(r.closed){api.tabs.remove(tab.id).catch(()=>{});reply({ok:false,error:'Erklärung wurde ersetzt.'});return;}r.panelTabId=tab.id;reply({ok:true});}catch(e){drop(r);throw e;}
 })().catch(()=>reply({ok:false,error:'Die lokale Erklärung konnte nicht geöffnet werden.'}));return true;};
 const connect=(port,approved=false)=>{const match=/^reader-explain-(source|panel):([a-zA-Z0-9-]{32,80})$/u.exec(port.name||'');if(!match)return;const r=records.get(match[2]),role=match[1],s=port.sender;const allowed=r&&!r.closed&&s?.id===api.runtime.id&&(role==='source'?s.tab?.id===r.sourceTabId&&s.frameId===r.frameId&&(r.documentId!==null?s.documentId===r.documentId:firefox&&s.documentId==null)&&s.url===r.url:s.tab?.id===r.panelTabId&&s.frameId===0&&s.url===panelURL+'#fallback='+encodeURIComponent(r.nonce));
  if(!allowed||r[role]){port.disconnect();return;}if(role==='source'&&r.frameId>0&&!approved){void Promise.resolve(authorizeFrame({sender:s,epoch:r.epoch})).then(ok=>{if(ok)connect(port,true);else port.disconnect();},()=>port.disconnect());return;}r[role]=port;
  if(r.source&&r.panel){r.source.postMessage({type:'connected'});r.panel.postMessage({type:'connected',language:r.language});}
  port.onMessage.addListener(d=>{if(r.closed||!d||typeof d.type!=='string')return;if(d.type==='ping')return;
   if(role==='source'){
    if(d.type==='cancel'){r.panel?.postMessage({type:'cancel',message:'Die Quelle hat sich geändert.'});drop(r);return;}
    if(d.type!=='source'||d.source?.epoch!==r.epoch)return;r.panel?.postMessage({type:'source',source:d.source,language:['de','en','fr','es','it','pt'].includes(d.language)?d.language:'en'});
   }else{
    if(!['ready','requestSource','annotations','activeBlock','focusBlock','focusEnabled','clear','close','timing'].includes(d.type))return;r.source?.postMessage(d);
   }
  });port.onDisconnect.addListener(()=>drop(r));
 };
 const removed=id=>{for(const r of records.values())if(r.sourceTabId===id||r.panelTabId===id)drop(r,r.panelTabId!==id);};
 /* Only a new document ends the fallback: a reload or another address. A hash change (#lesson-2) keeps the source
    document, its port and epoch; the source itself cancels when its text changes. */
 const page=url=>{try{const u=new URL(url);u.hash='';return u.href;}catch{return String(url);}};
 const updated=(id,change)=>{for(const r of records.values()){if(r.sourceTabId!==id)continue;
  if(typeof change.url==='string'){if(page(change.url)!==page(r.tabUrl))drop(r);else r.tabUrl=change.url;}
  else if(change.status==='loading')drop(r);}};
 api.tabs.onUpdated?.addListener(updated);api.runtime.onMessage.addListener(open);api.runtime.onConnect.addListener(connect);api.tabs.onRemoved.addListener(removed);
 return {dispose(){api.tabs.onUpdated?.removeListener(updated);api.runtime.onMessage.removeListener(open);api.runtime.onConnect.removeListener(connect);api.tabs.onRemoved.removeListener(removed);for(const r of records.values())drop(r);},get size(){return records.size;}};
}
