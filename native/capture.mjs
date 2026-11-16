// Read the existing Brave tab without navigating, scrolling, or activating it.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,lstat,readFile,writeFile,rename,chmod,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPdfJsAdapter} from './pdfjs-adapter.mjs';
import {collectHtmlBlocks,artifactFrame,documentLanguage} from './html-content.mjs';
const cdpOrigin=process.env.READER_CDP_ENDPOINT||'http://127.0.0.1:9333';
const cdpPort=cdpOrigin.match(/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/)?.[1];
if(!cdpPort||Number(cdpPort)>65535)throw Error('Invalid loopback CDP endpoint');
const endpoint=cdpOrigin+'/json/list';
async function evaluate(target, expression, timeout=5000) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {ws.onopen=resolve; ws.onerror=reject;});
    return await new Promise((resolve, reject) => {
      const timer=setTimeout(()=>reject(new Error('Brave antwortet nicht.')),timeout);
      ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id!==1)return;
        clearTimeout(timer);
        if(m.error||m.result?.exceptionDetails)reject(new Error('Browserinhalt konnte nicht gelesen werden.'));
        else resolve(m.result.result.value);
      };
      ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
    });
  } finally {ws.close();}
}
// Chromium creates its viewport before asynchronous documentDimensions arrive.
// Keep this function self-contained: it runs in the existing native renderer.
async function nativePdfSnapshot({timeoutMs=3500,pollMs=40}={}) {
  const generation=performance.timeOrigin,deadline=performance.now()+timeoutMs;
  let owner=null,originalUrl=null,viewport=null;
  const failure=captureError=>({captureError});
  const identity=()=>{
    if(performance.timeOrigin!==generation)return false;
    const current=document.querySelector('pdf-viewer');
    if(owner&&current!==owner)return false;
    if(current&&!owner)owner=current;
    if(owner){
      if(originalUrl!==null&&owner.originalUrl!==originalUrl)return false;
      if(originalUrl===null&&typeof owner.originalUrl==='string'&&owner.originalUrl)originalUrl=owner.originalUrl;
    }
    return true;
  };
  const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
  const measure=()=>{
    if(owner?.showErrorDialog===true)return failure('load_failed');
    const dimensions=owner?.documentDimensions?.pageDimensions;
    if(!Array.isArray(dimensions)||!dimensions.length||originalUrl===null||
       !dimensions.every(page=>positive(page?.width)&&positive(page?.height)))return null;
    // After dimensions exist, genuine API failures must be surfaced immediately;
    // only absent/zero-size startup geometry is a retryable readiness condition.
    try{
      const p=owner.viewport;
      if(!p)return null;
      if(viewport&&p!==viewport)return failure('tab_changed');viewport=p;
      if(p.getClockwiseRotations()!==0||p.twoUpViewEnabled())return failure('unsupported');
      if(!positive(p.size?.width)||!positive(p.size?.height))return null;
      const current=p.getMostVisiblePage();
      if(!Number.isInteger(current)||current<0||current>=dimensions.length)return null;
      if(!positive(dimensions[current]?.width)||!positive(dimensions[current]?.height))return null;
      const rects=[];
      for(let index=Math.max(0,current-2);index<Math.min(dimensions.length,current+3);index++){
        const r=p.getPageScreenRect(index);
        if(!r||!Number.isFinite(r.y)||!positive(r.width)||!positive(r.height))continue;
        if(r.y+r.height>0&&r.y<p.size.height)rects.push({index,top:r.y,height:r.height});
      }
      return rects.some(rect=>rect.index===current)?{page:current,visible:rects}:null;
    }catch{return failure('capture_failed');}
  };
  for(;;){
    if(!identity())return failure('tab_changed');
    const snapshot=measure();if(snapshot?.captureError)return snapshot;
    const controller=owner?.currentController;
    if(snapshot&&typeof controller?.getSelectedText==='function'){
      const remaining=deadline-performance.now();if(remaining<=0)return failure('not_ready');
      let timer;
      const selected=await Promise.race([
        Promise.resolve().then(()=>controller.getSelectedText()).then(value=>({value}),()=>failure('selection_failed')),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(failure('selection_timeout')),remaining);})
      ]);clearTimeout(timer);
      if(!identity()||owner.currentController!==controller)return failure('tab_changed');
      if(selected.captureError)return selected;
      if(typeof selected.value?.selectedText!=='string')return failure('selection_failed');
      const final=measure();if(final?.captureError)return final;
      if(final)return {kind:'pdf',documentGeneration:generation,url:originalUrl,...final,selection:selected.value.selectedText};
    }
    const remaining=deadline-performance.now();if(remaining<=0)return failure('not_ready');
    await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,remaining)));
  }
}

export async function captureNativePdf(target,run=evaluate,options={}) {
  // The3500ms browser budget includes selection retrieval. Leave1500ms for CDP
  // transport under evaluate's existing5000ms deadline; never wait indefinitely.
  const timeoutMs=Number.isFinite(options.timeoutMs)?Math.max(50,Math.min(3500,options.timeoutMs)):3500;
  const pollMs=Number.isFinite(options.pollMs)?Math.max(5,Math.min(100,options.pollMs)):40;
  const data=await run(target,`(${nativePdfSnapshot.toString()})(${JSON.stringify({timeoutMs,pollMs})})`);
  if(data?.captureError){
    const reason=data.captureError;
    const error=selectorError(reason==='tab_changed'?'tab_changed':reason==='unsupported'?'unsupported':'prepare_failed',
      reason==='tab_changed'?'Das PDF wurde während des Einlesens gewechselt.':
      reason==='unsupported'?'Bitte PDF ohne Drehung und mit einer Seite anzeigen.':
      reason==='not_ready'?'Das PDF ist noch nicht bereit. Bitte kurz warten und erneut starten.':
      reason==='selection_timeout'||reason==='selection_failed'?'Die PDF-Textauswahl konnte nicht gelesen werden. Bitte erneut starten.':
      'Das PDF konnte nicht vollständig eingelesen werden. Bitte erneut starten.');
    error.reason=reason;throw error;
  }
  if(data?.kind!=='pdf'||typeof data.url!=='string'||!Array.isArray(data.visible)||!data.visible.length||typeof data.selection!=='string')throw Error('PDF konnte nicht gelesen werden.');
  return data;
}

const MAX_PDF=100*1024*1024;
export async function capturePdfJs(target, run=evaluate, cacheRoot=join(homedir(),'.cache','brave-reader')) {
  const data=await run(target,`(()=>{
    const v=(${createPdfJsAdapter.toString()})(location.origin+location.pathname);if(!v)throw Error('PDF noch nicht geladen');
    const p=v.viewport,current=p.getMostVisiblePage();
    if(p.getClockwiseRotations()!==0||p.twoUpViewEnabled())throw Error('Bitte PDF ohne Drehung und mit einer Seite anzeigen');
    const rects=[];
    for(let i=0;i<v.documentDimensions.pageDimensions.length;i++){
      const r=p.getPageScreenRect(i);if(r.y+r.height>0&&r.y<p.size.height&&r.width>0)rects.push({index:i,top:r.y,height:r.height});
    }
    const selection=getSelection(),node=selection?.anchorNode;
    return {kind:'pdf',documentGeneration:performance.timeOrigin,renderer:'pdfjs',rendererInstance:v.rendererInstance,url:v.originalUrl,page:current,selection:node&&document.querySelector('ngx-extended-pdf-viewer #viewerContainer')?.contains(node)?String(selection):'',visible:rects};
  })()`);
  if(!data||data.kind!=='pdf'||data.renderer!=='pdfjs'||typeof data.url!=='string')throw Error('PDF konnte nicht gelesen werden.');
  const publicUrl=new URL(data.url);
  if(publicUrl.search||publicUrl.hash||!/^\/library\/\d+\/series\/\d+\/pdf\/\d+\/?$/.test(publicUrl.pathname))throw Error('Ungültige PDF-Identität.');
  await mkdir(cacheRoot,{recursive:true,mode:0o700});
  const dir=await lstat(cacheRoot);if(!dir.isDirectory()||dir.isSymbolicLink())throw Error('Unsicherer PDF-Zwischenspeicher.');
  await chmod(cacheRoot,0o700);
  const pdfPath=join(cacheRoot,createHash('sha256').update(data.url).digest('hex')+'.pdf');
  let cached=false;
  try {const st=await lstat(pdfPath);if(st.isFile()&&!st.isSymbolicLink()&&st.size<=MAX_PDF){const bytes=await readFile(pdfPath);cached=bytes.subarray(0,5).toString()==='%PDF-';if(cached)await chmod(pdfPath,0o600);}} catch {}
  if(!cached){
    // The authenticated URL remains exclusively in the existing browser session.
    // No cookies, query strings, credentials or response headers leave that tab.
    const base64=await run(target,`(async()=>{
      if(location.origin+location.pathname!==${JSON.stringify(data.url)}||performance.timeOrigin!==${JSON.stringify(data.documentGeneration)})throw Error('Dokument gewechselt');
      const chapter=location.pathname.split('/').filter(Boolean).at(-1);
      const sources=performance.getEntriesByType('resource').filter(e=>{try{const u=new URL(e.name);return u.origin===location.origin&&u.pathname==='/api/reader/pdf'&&u.searchParams.get('chapterId')===chapter;}catch{return false;}});
      const source=sources.at(-1);if(!source)throw Error('PDF-Quelle fehlt');
      const response=await fetch(source.name,{credentials:'same-origin',signal:AbortSignal.timeout(60000)});
      if(!response.ok||Number(response.headers.get('content-length'))>${MAX_PDF})throw Error('PDF konnte nicht geladen werden');
      const reader=response.body.getReader(),parts=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>${MAX_PDF}){await reader.cancel();throw Error('PDF zu groß');}parts.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
      if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw Error('Keine PDF-Datei');
      let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      return btoa(binary);
    })()`,75000);
    if(typeof base64!=='string'||base64.length>Math.ceil(MAX_PDF/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('Ungültige PDF-Daten.');
    const bytes=Buffer.from(base64,'base64');
    if(bytes.length>MAX_PDF||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Ungültige PDF-Daten.');
    const temporary=pdfPath+'.'+randomBytes(8).toString('hex')+'.tmp';
    try{await writeFile(temporary,bytes,{mode:0o600,flag:'wx'});await rename(temporary,pdfPath);}finally{await unlink(temporary).catch(()=>{});}
  }
  return {...data,pdfPath};
}

const publicPage=url=>{const u=new URL(url);return u.origin+u.pathname;};
function selectorError(code, message) {
  const error = new Error(message); error.code = code; return error;
}
export async function chooseExtensionTarget(pages, selector, run=evaluate) {
  let matches = pages.filter(page => page.url === selector.url);
  if (!matches.length) throw selectorError('tab_changed', 'Der angeklickte Tab ist nicht mehr geöffnet.');
  if (matches.length === 1) return matches[0];
  const titled = matches.filter(page => page.title === selector.title);
  if (titled.length) matches = titled;
  if (matches.length === 1) return matches[0];
  const states = await Promise.all(matches.map(async page => {
    try { return {page, ...await run(page, '({visible:document.visibilityState==="visible",focused:document.hasFocus()})')}; }
    catch { return {page, visible:false, focused:false}; }
  }));
  const focused = states.filter(item => item.visible && item.focused);
  if (focused.length === 1) return focused[0].page;
  const visible = states.filter(item => item.visible);
  if (visible.length === 1) return visible[0].page;
  throw selectorError('ambiguous', 'Mehrere gleiche Tabs sind nicht eindeutig zuzuordnen.');
}

export async function main() {
try {
  let selector = null;
  if (process.argv.includes('--selector-stdin')) {
    const input = readFileSync(0, 'utf8');
    if (Buffer.byteLength(input) > 12288) throw selectorError('unsupported', 'Ungültige Tab-Anfrage.');
    selector = JSON.parse(input);
    if (!selector || typeof selector.url !== 'string' || typeof selector.title !== 'string')
      throw selectorError('unsupported', 'Ungültige Tab-Anfrage.');
  }
  const ts=await(await fetch(endpoint,{signal:AbortSignal.timeout(4000)})).json();
  const pages=ts.filter(t=>t.type==='page'&&!t.url.startsWith('devtools:'));
  let titles=[];
  try {
    const clients=JSON.parse(execFileSync('hyprctl',['clients','-j'],{encoding:'utf8'}));
    titles=clients.filter(c=>c.class==='brave-browser').sort((a,b)=>a.focusHistoryID-b.focusHistoryID).map(c=>c.title.replace(/ - Brave$/,''));
  } catch {}
  const requested=process.argv.indexOf('--target');
  const matching=titles.map(title=>pages.filter(t=>t.title===title)).find(ts=>ts.length);
  const selectedPage = selector ? await chooseExtensionTarget(requested >= 0 ? pages.filter(t=>t.id===process.argv[requested+1]) : pages, selector) : null;
  const probe=selectedPage?[selectedPage]:requested>=0?pages.filter(t=>t.id===process.argv[requested+1]):matching||pages;
  const states=await Promise.all(probe.map(async t=>{
    try {return {t,...await evaluate(t,'({visible:document.visibilityState==="visible",focused:document.hasFocus()})')};}
    catch{return {t,visible:false,focused:false};}
  }));
  const candidates=states.filter(s=>s.visible);
  // An explicit target is also useful for isolated/background tests. It does not
  // activate that tab and therefore must not require document.visibilityState.
  const chosen=(selectedPage||requested>=0)?states[0]:candidates.find(s=>s.focused)||titles.map(title=>candidates.find(s=>s.t.title===title)).find(Boolean)||(candidates.length===1?candidates[0]:null);
  if(!chosen)throw new Error('Bitte das gewünschte Dokument in Brave nach vorn holen.');
  const page=selectedPage||(requested>=0?pages.find(t=>t.id===process.argv[requested+1]):chosen.t);
  if(!page)throw selectorError('tab_changed', 'Dokument ist nicht mehr geöffnet.');
  const verifySelector = async () => {
    if (selector && await evaluate(page, 'location.href') !== selector.url)
      throw selectorError('tab_changed', 'Der angeklickte Tab wurde inzwischen geändert.');
  };
  await verifySelector();
  const pdf=ts.find(t=>t.parentId===page.id&&t.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'));
  // Local files are supported by the native PDF renderer. HTML controls use
  // an HTTP(S) page identity; don't claim readiness for unsupported file or
  // browser-internal documents.
  if (!pdf && !/^https?:\/\//.test(page.url))
    throw selectorError('unsupported', 'Diese Dokumentansicht wird noch nicht unterstützt.');
  const frame=pdf?null:artifactFrame(page,ts);
  const doc=frame||page;
  if (process.argv.includes('--context-only')) {
    let context;
    if (pdf) {
      const state = await evaluate(pdf, `(()=>{const v=document.querySelector('pdf-viewer');if(!v?.viewport)throw Error('PDF noch nicht bereit');return {url:v.originalUrl,documentGeneration:performance.timeOrigin};})()`);
      context = {targetId:page.id, viewerTargetId:pdf.id, kind:'pdf', url:state.url, documentGeneration:state.documentGeneration};
    } else {
      const state = await evaluate(doc, `(()=>{
        const viewer=(${createPdfJsAdapter.toString()})(location.origin+location.pathname);
        if(viewer)return {kind:'pdf',url:viewer.originalUrl,rendererInstance:viewer.rendererInstance,documentGeneration:performance.timeOrigin};
        const blocks=(${collectHtmlBlocks.toString()})().blocks;
        return {kind:'html',url:location.origin+location.pathname,readable:blocks.length>0,documentGeneration:performance.timeOrigin};
      })()`);
      if (state.kind === 'pdf') context = {targetId:page.id, viewerTargetId:page.id, kind:'pdf', renderer:'pdfjs', rendererInstance:state.rendererInstance, url:state.url, documentGeneration:state.documentGeneration};
      else if (state.readable) context = frame ? {targetId:page.id, viewerTargetId:null, frameTargetId:frame.id, frameUrl:state.url, kind:'html', url:publicPage(page.url), documentGeneration:state.documentGeneration} : {targetId:page.id, viewerTargetId:null, kind:'html', url:state.url, documentGeneration:state.documentGeneration};
      else throw selectorError('unsupported', 'Keine lesbaren Textstellen in diesem Dokument.');
    }
    await verifySelector();
    console.log(JSON.stringify({context}));
    return;
  }
  if(pdf) {
    const data=await captureNativePdf(pdf);
    await verifySelector();
    if (await evaluate(pdf||page, 'performance.timeOrigin') !== data.documentGeneration)
      throw selectorError('tab_changed', 'Das Dokument wurde inzwischen neu geladen.');
    console.log(JSON.stringify({...data,title:page.title,context:{targetId:page.id,viewerTargetId:pdf.id,kind:'pdf',url:data.url,documentGeneration:data.documentGeneration}}));
  } else if(!frame&&await evaluate(page,`!!(${createPdfJsAdapter.toString()})(location.origin+location.pathname)`)) {
    const data=await capturePdfJs(page);
    await verifySelector();
    if (await evaluate(pdf||page, 'performance.timeOrigin') !== data.documentGeneration)
      throw selectorError('tab_changed', 'Das Dokument wurde inzwischen neu geladen.');
    console.log(JSON.stringify({...data,title:page.title,context:{targetId:page.id,viewerTargetId:page.id,kind:'pdf',renderer:'pdfjs',rendererInstance:data.rendererInstance,url:data.url,documentGeneration:data.documentGeneration}}));
  } else {
    const data=await evaluate(doc,`(()=>{
      const selection=String(getSelection()||'');
      const collected=(${collectHtmlBlocks.toString()})({cites:true});
      const lang=(${documentLanguage.toString()})(collected);
      return {kind:'html',documentGeneration:performance.timeOrigin,url:location.origin+location.pathname,selection,lang,blocks:collected.blocks};
    })()`);
    if(data?.kind==='html'){
      if (!data.blocks?.length) throw selectorError('unsupported', 'Keine lesbaren Textstellen in diesem Dokument.');
      const indexes=Array.from({length:data.blocks.length},(_,i)=>i);
      for(let offset=0;offset<indexes.length;offset+=5){
        const batch=indexes.slice(offset,offset+5);
        const geometry=await evaluate(doc,`((wanted)=>{
          if(location.origin+location.pathname!==${JSON.stringify(data.url)}||performance.timeOrigin!==${JSON.stringify(data.documentGeneration)})throw Error('Dokument gewechselt');
          const collected=(${collectHtmlBlocks.toString()})(),nodes=collected.nodes;
          return wanted.map(i=>{const e=nodes[i];if(!e)throw Error('Dokument gewechselt');const r=e.getBoundingClientRect(),out=[];
            const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
            while(walker.nextNode()){const node=walker.currentNode;for(const source of node.textContent.matchAll(/\\S+/gu)){
              const token=source[0].normalize('NFKC').replace(/\\u00ad/g,'').trim();
              const range=document.createRange();range.setStart(node,source.index);range.setEnd(node,source.index+source[0].length);
              const rects=[...range.getClientRects()];out.push({text:token,bbox:rects.length?[Math.min(...rects.map(x=>x.left))-r.left,Math.min(...rects.map(x=>x.top))-r.top,Math.max(...rects.map(x=>x.right))-r.left,Math.max(...rects.map(x=>x.bottom))-r.top]:null});
            }}return out;
          });
        })(${JSON.stringify(batch)})`);
        batch.forEach((index,i)=>{data.blocks[index].wordBoxes=geometry?.[i]||[];});
      }
    }
    await verifySelector();
    if (await evaluate(doc, 'performance.timeOrigin') !== data.documentGeneration)
      throw selectorError('tab_changed', 'Das Dokument wurde inzwischen neu geladen.');
    if (frame) console.log(JSON.stringify({...data,url:publicPage(page.url),title:page.title,context:{targetId:page.id,viewerTargetId:null,frameTargetId:frame.id,frameUrl:data.url,kind:'html',url:publicPage(page.url),documentGeneration:data.documentGeneration}}));
    else console.log(JSON.stringify({...data,title:page.title,context:{targetId:page.id,viewerTargetId:null,kind:'html',url:data.url,documentGeneration:data.documentGeneration}}));
  }
} catch(e) {
  if (process.argv.includes('--selector-stdin')) console.error(JSON.stringify({code:e.code||'browser_unavailable'}));
  else console.error(e.message);
  process.exitCode=1;
}

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
