/* Isolated-world metadata only. Visibility messages carry no document token, URL or prose and never authorize a source. */
(()=>{
 const nonce=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
 globalThis.__notableDocumentToken??=nonce();
 const elements=()=>{const out=[];const walk=root=>{for(const e of root.querySelectorAll('*')){if(e.shadowRoot)walk(e.shadowRoot);if(e.tagName==='IFRAME'||e.tagName==='FRAME')out.push(e);}};walk(document);return out;};
 const shown=e=>{for(let n=e;n;n=n.parentElement||n.getRootNode?.().host){const s=getComputedStyle(n);if(n.hidden||n.hasAttribute('inert')||s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||s.opacity==='0')return false;}return true;};
 if(!globalThis.__notableFrameVisibilityHook){globalThis.__notableFrameVisibilityHook=true;addEventListener('message',event=>{
  if(event.data?.type!=='notable-frame-visibility-request'||typeof event.data.nonce!=='string'||!/^[a-f0-9]{32}$/.test(event.data.nonce))return;
  const frame=elements().find(e=>e.contentWindow===event.source);if(!frame)return;const r=frame.getBoundingClientRect(),area=Math.max(0,Math.min(innerWidth,r.right)-Math.max(0,r.left))*Math.max(0,Math.min(innerHeight,r.bottom)-Math.max(0,r.top)),visible=shown(frame)&&area>0;
  void Promise.resolve(globalThis.__notableFrameExposure).then(parent=>event.source?.postMessage({type:'notable-frame-visibility-result',nonce:event.data.nonce,visible:visible&&parent?.visible===true,area:Math.min(area,parent?.area||0)},'*'));
 });}
 const exposure=()=>window===window.parent?Promise.resolve({visible:true,area:innerWidth*innerHeight}):new Promise(resolve=>{
  const id=nonce();let timer;const done=value=>{clearTimeout(timer);removeEventListener('message',receive);resolve(value);};const receive=e=>{if(e.source===window.parent&&e.data?.type==='notable-frame-visibility-result'&&e.data.nonce===id)done({visible:e.data.visible===true,area:Math.max(0,Number(e.data.area)||0)});};addEventListener('message',receive);timer=setTimeout(()=>done({visible:false,area:0}),1000);window.parent.postMessage({type:'notable-frame-visibility-request',nonce:id},'*');
 });
 if(globalThis.__notableFrameProbeRun)return;
 globalThis.__notableFrameExposure=exposure();
 // Discovery polls while a page settles: reuse the text metadata until the DOM or the reading filters change.
 // The observer stops shortly after the last poll, so an idle page carries no extra work.
 let metadata=null,metadataFilters='',observer=null,idle=0;
 const keepFresh=()=>{
  if(!observer){
   observer=new MutationObserver(()=>{metadata=null;});
   observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
  }
  clearTimeout(idle);idle=setTimeout(()=>{observer?.disconnect();observer=null;metadata=null;},10000);
 };
 globalThis.__notableFrameProbeRun=async()=>{
  const api=globalThis.chrome?.runtime?.id?chrome:browser;
  const {collectHtmlBlocks}=await import(api.runtime.getURL('session/html-content.mjs'));
  const {loadConfig}=await import(api.runtime.getURL('config.mjs'));
  keepFresh();
  const reading=(await loadConfig(api.storage.local)).reading,filters=JSON.stringify(reading??null);
  if(!metadata||metadataFilters!==filters){
   metadata=collectHtmlBlocks({metadataOnly:true,reading});metadataFilters=filters;
  }
  const meta=metadata,frames=[];
  for(const e of elements()){const r=e.getBoundingClientRect();if(!r.width||!r.height||!shown(e))continue;try{const u=new URL(e.src,location.href);if(!u.username&&!u.password)frames.push({origin:['http:','https:'].includes(u.protocol)?u.origin:null});}catch{}}
  globalThis.__notableFrameExposure=exposure();
  const seen=await globalThis.__notableFrameExposure;
  const selection=document.getSelection();
  const own='[data-notable-reader-ui],[data-notable-reader-surface],input,textarea,[contenteditable]';
  const selected=!!selection&&!selection.isCollapsed&&selection.rangeCount>0&&!!selection.anchorNode
   &&!selection.anchorNode.parentElement?.closest(own);
  return {url:location.href,origin:globalThis.origin,token:globalThis.__notableDocumentToken,title:document.title,
   contentType:document.contentType,ready:meta.ready,chars:meta.chars||0,selected,
   visible:seen.visible&&innerWidth>0&&innerHeight>0,visibleArea:seen.area,frames};
 };
})()
