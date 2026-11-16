import {createSourceAnnotations} from './annotations.mjs';
import {snapshotSource} from './protocol.mjs';
import {runtimePortAdapter} from './transport.mjs';
export {createSourceAnnotations} from './annotations.mjs';
export function mountExplainPanel({document:doc=globalThis.document,extensionBase=globalThis.chrome?.runtime?.getURL('')||new URL('../',import.meta.url).href,getSource,onClose=()=>{},language='de'}={}){
 if(typeof getSource!=='function')throw Error('getSource fehlt.');let host,iframe,port,source=null,serial='',openedURL='',disposed=false,focusEnabled=false,timer=null,ready=false,fallback=false,opening=0;const annotations=createSourceAnnotations({document:doc});
 // The panel is web-accessible, so any website could frame it. It only connects after this controller confirms,
 // over an extension-only channel, that it created exactly this panel nonce (single use).
 const runtime=globalThis.chrome?.runtime,panelURL=new URL('explain/panel.html',extensionBase).href;
 let pendingNonce=null;
 const confirmPanel=(m,sender,reply)=>{
  if(m?.type!=='readerExplainVerify'||!pendingNonce||m.nonce!==pendingNonce)return false;
  if(sender?.id!==runtime?.id||sender?.url!==panelURL+'#'+pendingNonce)return false;
  pendingNonce=null;reply({ok:true});return false;
 };
 runtime?.onMessage?.addListener(confirmPanel);
 function current(){try{const s=getSource(),snap=snapshotSource(s);return {s,snap,key:JSON.stringify(snap)};}catch{return null;}}
 function valid(){const c=current();return c&&c.key===serial&&doc.location.href===openedURL;}
 function send(data){try{port?.postMessage(data);}catch{}}
 function sourceChanged(message){source=null;serial='';annotations.setSource(null);send({type:'cancel',message});if(fallback){port?.close();port=null;fallback=false;host?.remove();host=iframe=null;opening++;}}
 function close(){opening++;if(timer)clearTimeout(timer);timer=null;sourceChanged('Erklärung geschlossen.');port?.close();port=null;host?.remove();host=iframe=null;doc.removeEventListener('securitypolicyviolation',csp);onClose();}
 function receive({data:d}){
  if(d.type==='close'){close();return;}
  if(d.type==='ready'||d.type==='connected'){ready=true;if(timer)clearTimeout(timer);timer=null;return;}
  if(d.type==='requestSource'){const c=current();if(!c){send({type:'cancel',message:'Keine lesbaren Textstellen auf dieser Seite.'});return;}source=c.s;serial=c.key;openedURL=doc.location.href;annotations.setSource(source);annotations.setFocusEnabled(focusEnabled);send({type:'source',source:c.snap,language});return;}
  if(d.type==='clear'){annotations.clear();return;}
  if(!valid()){sourceChanged();return;}
  if(d.type==='annotations')annotations.setAnnotations(d.annotations,d.epoch);
  if(d.type==='activeBlock')annotations.setActiveBlock(d.blockId);
  if(d.type==='focusBlock'){const b=source.blocks.find(b=>b.id===d.blockId);if(b?.element?.isConnected){b.element.scrollIntoView({block:'center',behavior:doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});annotations.setActiveBlock(d.blockId);}}
 }
 function error(text){if(!host)return;const shadow=host.shadowRoot||privateShadow;shadow.replaceChildren();const box=doc.createElement('div'),p=doc.createElement('p'),b=doc.createElement('button');box.style.cssText='padding:20px;background:#f8f5ed;color:#20382e;border:1px solid #a9b9a5;border-radius:12px;font:14px system-ui';p.textContent=text;b.textContent='Schließen';b.onclick=close;box.append(p,b);shadow.append(box);}
 let privateShadow=null;
 async function openFallback(){if(ready||fallback||!host)return;fallback=true;ready=true;if(timer)clearTimeout(timer);timer=null;iframe?.remove();port?.close();port=null;
  const runtime=globalThis.chrome?.runtime,c=current(),mine=opening;if(!runtime?.sendMessage||!c){error('Diese Seite blockiert das eingebettete Fenster. Die lokale Erklärung benötigt eine Browser-Erweiterung und lesbaren Seitentext.');return;}
  const nonce=crypto.randomUUID();try{const result=await runtime.sendMessage({type:'readerExplainFallbackOpen',nonce,epoch:c.snap.epoch,language});if(mine!==opening||!host){runtime.sendMessage({type:'readerExplainFallbackCancel',nonce}).catch(()=>{});return;}if(!result?.ok)throw Error('Die lokale Erklärung konnte nicht geöffnet werden.');const raw=runtime.connect({name:'reader-explain-source:'+nonce});port=runtimePortAdapter(raw,()=>{if(!fallback)return;fallback=false;port=null;annotations.clear();host?.remove();host=iframe=null;onClose();});port.onmessage=receive;port.start();host.remove();host=null;}catch(e){fallback=false;error(e.message||'Die lokale Erklärung konnte nicht geöffnet werden.');}
 }
 const csp=e=>{if(!ready&&e.effectiveDirective==='frame-src'&&String(e.blockedURI).startsWith('chrome-extension'))openFallback();};
 function open(){if(disposed||host||fallback)return;ready=false;opening++;const nonce=crypto.randomUUID();pendingNonce=nonce;host=doc.createElement('div');host.setAttribute('data-reader-explain-panel','');host.style.cssText='position:fixed;right:16px;top:16px;width:min(440px,calc(100vw - 32px));height:min(720px,calc(100vh - 32px));z-index:2147483646;';privateShadow=host.attachShadow({mode:'closed'});iframe=doc.createElement('iframe');iframe.title='beNotable! · Lokale Seitenerklärung';iframe.style.cssText='width:100%;height:100%;border:1px solid #b5c2af;border-radius:16px;box-shadow:0 12px 48px #0004;background:#f8f5ed;';iframe.src=panelURL+'#'+nonce;iframe.addEventListener('load',()=>{if(ready||!iframe)return;const channel=new MessageChannel();port?.close();port=channel.port1;port.onmessage=receive;port.start();iframe.contentWindow.postMessage({type:'reader-explain-connect',nonce,language},'*',[channel.port2]);});doc.addEventListener('securitypolicyviolation',csp);privateShadow.append(iframe);doc.documentElement.append(host);timer=setTimeout(openFallback,1800);}
 const nav=()=>sourceChanged();doc.defaultView.addEventListener('popstate',nav);doc.defaultView.addEventListener('hashchange',nav);doc.defaultView.addEventListener('pagehide',close);
 return {open,close,sourceChanged,setActiveBlock(id){if(!source){const c=current();if(c){source=c.s;serial=c.key;openedURL=doc.location.href;annotations.setSource(source);}}annotations.setActiveBlock(id);},setFocusEnabled(v){focusEnabled=v===true;annotations.setFocusEnabled(focusEnabled);},dispose(){disposed=true;close();annotations.dispose();pendingNonce=null;runtime?.onMessage?.removeListener(confirmPanel);doc.defaultView.removeEventListener('popstate',nav);doc.defaultView.removeEventListener('hashchange',nav);doc.defaultView.removeEventListener('pagehide',close);}};
}
