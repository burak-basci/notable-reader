/* Ephemeral article handoff. No server, URL storage, telemetry or text logging. */
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||message?.action!=='open-local-reader')return false;
 if(typeof message.text!=='string'||!message.text.trim()){respond({ok:false});return false;}
 (async()=>{
  const existing=await chrome.storage.session.get(null),expired=Object.entries(existing).filter(([key,value])=>key.startsWith('notable-incoming-')&&Date.now()-Number(value?.created||0)>300000).map(([key])=>key);
  if(expired.length)await chrome.storage.session.remove(expired);
  const id=crypto.randomUUID(),key='notable-incoming-'+id;
  await chrome.storage.session.set({[key]:{text:message.text,title:typeof message.title==='string'?message.title:'Artikel',language:typeof message.language==='string'?message.language:'',created:Date.now()}});
  try{const tab=await chrome.tabs.create({url:chrome.runtime.getURL('reader.html')+'#incoming='+id});respond({ok:true,tabId:tab.id});}catch{await chrome.storage.session.remove(key);respond({ok:false});}
 })().catch(()=>respond({ok:false}));return true;
});
