/* Bounded one-time article handoff. No server, URL storage or text/image logging. */
'use strict';
const HANDOFF_MAX=8*1024*1024,FIGURE_MAX=4*1024*1024,FIGURE_COUNT=64,PIXEL_MAX=16000000,PIXEL_TOTAL=100000000,TTL=300000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HANDOFF_WARNINGS=new Set(['Einige Abbildungen konnten nicht sicher übernommen werden. Der Text bleibt vollständig verfügbar.','Große Abbildungen wurden für die sichere Übergabe verkleinert.','Die Bildgrenze der lokalen Übergabe wurde erreicht. Nicht alle Abbildungen sind enthalten.','Die Textauswahl enthält getrennte Bereiche. Abbildungen wurden dafür nicht übernommen.']);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const fields=(value,allowed)=>plain(value)&&Object.keys(value).every(key=>allowed.includes(key));
const fail=code=>{throw Error(code);};
const budget=value=>{const json=JSON.stringify(value);return Math.max(json.length*2,new TextEncoder().encode(json).byteLength);};
function validateAppearance(value){
 const ranges={brightness:[50,150],contrast:[50,150],sepia:[0,100],grayscale:[0,100],imageBrightness:[25,150],fontSize:[12,32],lineHeight:[1.2,2.4],contentWidth:[480,1200]},enums={mode:['off','dark','light','auto'],imageMode:['preserve','dim','invert','smart'],fontFamily:['system','sans','serif','mono'],pdfDpi:[96,144,192]},colors=['background','text','link','lightBackground','lightText','lightLink'],booleans=['focus','hidePageNumbers'],keys=[...Object.keys(ranges),...Object.keys(enums),...colors,...booleans];
 if(!fields(value,keys)||Object.keys(value).length!==keys.length)fail('handoff_invalid');const result={};for(const key of keys){const v=value[key];if(key in ranges){if(typeof v!=='number'||!Number.isFinite(v)||v<ranges[key][0]||v>ranges[key][1])fail('handoff_invalid');}else if(key in enums){if(!enums[key].includes(v))fail('handoff_invalid');}else if(colors.includes(key)){if(typeof v!=='string'||!/^#[a-f0-9]{6}$/i.test(v))fail('handoff_invalid');}else if(typeof v!=='boolean')fail('handoff_invalid');result[key]=v;}return result;
}
function validateHandoff(message){
 if(!fields(message,['action','text','title','language','mode','figures','warnings','source','appearance'])||message.action!=='open-local-reader'||typeof message.text!=='string'||!message.text.trim()||message.text.length>HANDOFF_MAX/2)fail('handoff_invalid');
 if(typeof message.title!=='string'||message.title.length>300||/[\x00-\x1f\x7f]/.test(message.title)||typeof message.language!=='string'||message.language.length>64||message.language&&!/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(message.language)||!['files','audiobook'].includes(message.mode))fail('handoff_invalid');
 if(!fields(message.source,['instanceId','generation'])||typeof message.source.instanceId!=='string'||typeof message.source.generation!=='string'||!UUID.test(message.source.instanceId)||!UUID.test(message.source.generation))fail('handoff_invalid');
 const appearance=message.appearance===undefined?null:validateAppearance(message.appearance);
 const figures=message.figures??[],warnings=message.warnings??[];if(!Array.isArray(figures)||figures.length>FIGURE_COUNT||!Array.isArray(warnings)||warnings.length>4||warnings.some(w=>!HANDOFF_WARNINGS.has(w))||new Set(warnings).size!==warnings.length)fail('handoff_invalid');
 let imageBytes=0,totalPixels=0;const copied=[];
 for(const figure of figures){
  if(!fields(figure,['charStart','src','alt','kind'])||!Number.isSafeInteger(figure.charStart)||figure.charStart<0||figure.charStart>message.text.length||typeof figure.src!=='string'||figure.src.length>FIGURE_MAX||typeof figure.alt!=='string'||figure.alt.length>280||/[\x00-\x1f\x7f]/.test(figure.alt)||!['image','diagram'].includes(figure.kind))fail('handoff_invalid');
  if(figure.charStart>0&&/[\uD800-\uDBFF]/.test(message.text[figure.charStart-1])&&/[\uDC00-\uDFFF]/.test(message.text[figure.charStart]||''))fail('handoff_invalid');
  imageBytes+=figure.src.length;if(imageBytes>FIGURE_MAX)fail('handoff_too_large');
  const prefix='data:image/png;base64,';if(!figure.src.startsWith(prefix))fail('handoff_invalid');const data=figure.src.slice(prefix.length);if(data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length<44)fail('handoff_invalid');
  let header;try{header=Uint8Array.from(atob(data.slice(0,44)),c=>c.charCodeAt(0));}catch{fail('handoff_invalid');}
  const view=new DataView(header.buffer);if(header.length<24||view.getUint32(0)!==0x89504e47||view.getUint32(4)!==0x0d0a1a0a||view.getUint32(8)!==13||view.getUint32(12)!==0x49484452)fail('handoff_invalid');
  const width=view.getUint32(16),height=view.getUint32(20);if(!width||!height||width>32768||height>32768||width*height>PIXEL_MAX)fail('handoff_invalid');totalPixels+=width*height;if(totalPixels>PIXEL_TOTAL)fail('handoff_too_large');
  copied.push({charStart:figure.charStart,src:figure.src,alt:figure.alt,kind:figure.kind});
 }
 const result={text:message.text,title:message.title||'Artikel',language:message.language,figures:copied,warnings:[...warnings],...(appearance?{appearance}:{}),created:Date.now()};if(budget(result)>HANDOFF_MAX)fail('handoff_too_large');return result;
}
function senderSource(sender){
 if(sender?.id!==chrome.runtime.id||!Number.isSafeInteger(sender.tab?.id)||sender.tab.id<0||sender.frameId!==0||sender.documentLifecycle&&sender.documentLifecycle!=='active')fail('handoff_sender_invalid');
 let source,tab;try{source=new URL(sender.url);tab=new URL(sender.tab.url);}catch{fail('handoff_sender_invalid');}
 // Chrome keeps sender.url at the document's original URL after pushState,
 // while sender.tab.url follows the current entry. Only the same origin plus
 // Chrome's own document identity may bridge that legitimate SPA difference.
 const documentBound=typeof sender.documentId==='string'&&sender.documentId.length>0&&sender.documentId.length<=128;
 if(!/^https?:$/.test(source.protocol)||source.username||source.password||source.origin!==tab.origin||source.href!==tab.href&&!documentBound)fail('handoff_sender_invalid');return tab.href;
}
async function checkSource(sender,identity){
 const expected=senderSource(sender);let tab,answer;try{tab=await chrome.tabs.get(sender.tab.id);if(tab.url!==expected||tab.discarded)fail('handoff_source_changed');const options=sender.documentId?{documentId:sender.documentId}:{frameId:0};answer=await chrome.tabs.sendMessage(sender.tab.id,{channel:'notable-public-player',action:'snapshot'},options);}catch{fail('handoff_source_changed');}
 if(answer?.ok!==true||answer.instanceId!==identity.instanceId||answer.snapshot?.generation!==identity.generation||answer.snapshot?.ready!==true)fail('handoff_source_changed');
}
async function openArticleReader(message,sender){
 senderSource(sender);const document=validateHandoff(message);await checkSource(sender,message.source);
 const existing=await chrome.storage.session.get(null),expired=Object.entries(existing).filter(([key,value])=>key.startsWith('notable-incoming-')&&(!Number.isFinite(value?.created)||Date.now()-value.created>=TTL)).map(([key])=>key);if(expired.length)await chrome.storage.session.remove(expired);
 if(chrome.storage.session.getBytesInUse){const used=await chrome.storage.session.getBytesInUse(null);if(!Number.isFinite(used)||used+budget(document)>10*1024*1024)fail('handoff_storage_full');}
 const id=crypto.randomUUID(),key='notable-incoming-'+id;
 try{await chrome.storage.session.set({[key]:document});}catch{try{await chrome.storage.session.remove(key);}catch{}fail('handoff_storage_full');}
 try{await checkSource(sender,message.source);const tab=await chrome.tabs.create({url:chrome.runtime.getURL('reader.html')+(message.mode==='audiobook'?'?mode=audiobook':'')+'#incoming='+id});return{ok:true,tabId:tab.id};}catch(error){try{await chrome.storage.session.remove(key);}catch{}fail(error.message==='handoff_source_changed'?'handoff_source_changed':'handoff_open_failed');}
}
let handoffQueue=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message?.action!=='open-local-reader')return false;
 try{senderSource(sender);}catch{respond({ok:false,code:'handoff_sender_invalid'});return false;}
 const operation=handoffQueue.then(()=>openArticleReader(message,sender));handoffQueue=operation.catch(()=>{});operation.then(respond,error=>respond({ok:false,code:['handoff_invalid','handoff_too_large','handoff_storage_full','handoff_source_changed','handoff_open_failed'].includes(error?.message)?error.message:'handoff_open_failed'}));return true;
});
