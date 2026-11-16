// Owned PDF controls and word overlay. JSONL only; never log document text.
import {createInterface} from 'node:readline';
import {createFormatting} from './extension/formatting.mjs';
import {createAppearanceController} from './extension/appearance.mjs';
import {mountPlayerSurface} from './extension/player-surface.mjs';
import {readFileSync} from 'node:fs';
const uiLocales=JSON.parse(readFileSync(new URL('./ui-locales.json',import.meta.url),'utf8'));
import {randomBytes,createHash} from 'node:crypto';
import {createPdfJsAdapter} from './pdfjs-adapter.mjs';
import {collectHtmlBlocks,artifactFrame} from './html-content.mjs';
const cdpOrigin=process.env.READER_CDP_ENDPOINT||'http://127.0.0.1:9333';
const cdpPort=cdpOrigin.match(/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/)?.[1];
if(!cdpPort||Number(cdpPort)>65535)throw Error('Invalid loopback CDP endpoint');
const endpoint=cdpOrigin+'/json/list';
const binding = '__braveReader_' + randomBytes(9).toString('hex');
const ownerKey = '__braveReaderInline';
const isolatedWorldName = 'Notable Reader controls';
const emit = message => process.stdout.write(JSON.stringify(message) + '\n');
let socket, sequence = 0, pending = new Map(), closed = false;
let currentContext, initialNavigationPages, executionContextId,initialAppearancePages,initialAppearanceSystem,appearanceTransfer;
let surfaceLost=false;
function reportSurfaceLost(){if(currentContext&&!surfaceLost){surfaceLost=true;emit({type:'surfaceLost',context:currentContext});}}

// Only bounded geometry leaves the process. Figure hints and multi-line word
// parts cannot transport text, arbitrary properties or coordinates outside
// the original page context.
function validPageSize(word) {
  return Number.isFinite(word?.pageWidth)&&word.pageWidth>0&&word.pageWidth<1e7&&
    Number.isFinite(word?.pageHeight)&&word.pageHeight>0&&word.pageHeight<1e7;
}
function validFocusBBox(word) {
  const f=word?.focusBBox,b=word?.bbox;
  return validPageSize(word)&&
    Array.isArray(f)&&f.length===4&&f.every(Number.isFinite)&&
    Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&
    f[0]>=0&&f[1]>=0&&f[2]<=word.pageWidth&&f[3]<=word.pageHeight&&
    f[2]>f[0]&&f[3]>f[1]&&b[2]>b[0]&&b[3]>b[1]&&
    f[0]<=b[0]&&f[1]<=b[1]&&f[2]>=b[2]&&f[3]>=b[3];
}
// A word split across a line break may carry up to 4 per-line rectangles.
// Drawing uses them instead of bbox; follow/scroll math never does.
function validParts(word) {
  const parts=word?.parts;
  if(!validPageSize(word)||!Array.isArray(parts)||parts.length===0||parts.length>4)return false;
  return parts.every(p=>Array.isArray(p)&&p.length===4&&p.every(Number.isFinite)&&
    p[0]>=0&&p[1]>=0&&p[2]<=word.pageWidth&&p[3]<=word.pageHeight&&p[2]>p[0]&&p[3]>p[1]);
}

function validAppearancePatch(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length)return false;
  const ranges={brightness:[50,150],contrast:[50,150],sepia:[0,100],grayscale:[0,100],imageBrightness:[25,150],fontSize:[12,32],lineHeight:[1.2,2.4],contentWidth:[480,1200]},enums={mode:['off','dark','light','auto'],imageMode:['preserve','dim','invert','smart'],fontFamily:['serif','sans','system','mono'],pdfDpi:[96,144,192]};
  return Object.entries(value).every(([key,v])=>key in ranges?Number.isFinite(v)&&v>=ranges[key][0]&&v<=ranges[key][1]:key in enums?enums[key].includes(v):['background','text','link','lightBackground','lightText','lightLink'].includes(key)?typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v):['focus','hidePageNumbers'].includes(key)?typeof v==='boolean':false);
}

function installInline(expectedUrl, bindingName, key, suppliedViewer=undefined,uiBundle=undefined) {
  let uiLocale='de',formatNumber=value=>String(value);
  const uiText=(key,args={})=>(uiBundle?.locales?.messages?.[uiLocale]?.[key]||uiBundle?.locales?.messages?.de?.[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(args[k]??''));
  const languageLabel=(code,fallback)=>{try{return new Intl.DisplayNames([uiLocale],{type:'language'}).of(code);}catch{return fallback||code;}};
  const voiceNote=note=>note.replace(/weiblich/g,uiText('female')).replace(/männlich/g,uiText('male')).replace(/hoch/g,uiText('high')).replace(/leise/g,uiText('quiet')).replace(/Brasilien/g,uiText('brazil'));

  const viewer = suppliedViewer===undefined ? document.querySelector('pdf-viewer') : suppliedViewer;
  if (!viewer?.viewport || !viewer.shadowRoot || viewer.originalUrl !== expectedUrl) return false;
  const viewport = viewer.viewport;
  if (viewport.getClockwiseRotations() !== 0 || viewport.twoUpViewEnabled()) return false;
  if(suppliedViewer!==undefined&&window.top!==window.self)return false;
  globalThis[key]?.destroy();
  const root = viewer.shadowRoot;
  const scroller = root.querySelector('#scroller');
  if (!scroller) return false;
  // DOM ownership survives isolated-world and companion process restarts.
  for(const scope of new Set([document,root].filter(scope=>typeof scope.querySelectorAll==='function')))for(const old of scope.querySelectorAll('#brave-reader-inline,#brave-reader-inline-html,[data-notable-reader-ui]')){old.dispatchEvent(new Event('notable-reader-dispose'));old.remove();}
  const host = document.createElement('div');
  host.id = 'brave-reader-inline';
  host.dataset.notableReaderUi=bindingName;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({mode:'open'});
  const surface=uiBundle.surface({mount:host,shadow,managed:false,locales:uiBundle.locales,formattingFactory:uiBundle.formattingFactory,onCommand:(...args)=>send(...args)});
  const {icon,voiceUi,volumeUi}=surface;
  const geometry=document.createElement('template');geometry.innerHTML='<style>.clip{position:fixed;overflow:hidden;pointer-events:none}.navigation{position:absolute;inset:0;pointer-events:none}.hit{position:absolute;background:transparent;pointer-events:none;cursor:pointer}.navigation[data-active] .hit{pointer-events:auto}.word{z-index:1;display:none;position:absolute;background:var(--reader-highlight-fill,rgba(255,215,35,.40));border:1px solid rgba(198,139,0,.65);border-radius:3px;pointer-events:none;mix-blend-mode:var(--reader-highlight-blend,multiply)}</style><div class="clip"><div class="navigation" aria-hidden="true"></div><div class="word"></div></div>';shadow.prepend(geometry.content);
  root.append(host);
  const bar=shadow.querySelector('.bar'), clip=shadow.querySelector('.clip'), wordBox=shadow.querySelector('.word');
  const handle=shadow.querySelector('.handle');
  const toggle=shadow.querySelector('[data-command="toggle"]'), speed=shadow.querySelector('.speed'), follow=shadow.querySelector('.follow'), clickSeek=shadow.querySelector('.click-seek'), navigation=shadow.querySelector('.navigation');
  const status=shadow.querySelector('.status'),remaining=shadow.querySelector('.remaining');
  const settingsToggle=shadow.querySelector('.settingsToggle'),settingsPanel=shadow.querySelector('.settings-panel');
  let followsText=true;
  Object.defineProperty(follow,'checked',{get:()=>followsText,set:value=>{followsText=value===true;follow.setAttribute('aria-pressed',String(followsText));follow.title=uiText(followsText?'followOn':'followOff');follow.setAttribute('aria-label',follow.title);}});
  follow.checked=true;follow.addEventListener('click',()=>{follow.checked=!follow.checked;follow.dispatchEvent(new Event('change'));});
  const closeSettings=()=>{settingsPanel.removeAttribute('data-open');settingsToggle.setAttribute('aria-expanded','false');};
  settingsToggle.addEventListener('click',()=>{const open=!settingsPanel.hasAttribute('data-open');settingsPanel.toggleAttribute('data-open',open);settingsToggle.setAttribute('aria-expanded',String(open));layout();});
  settingsPanel.addEventListener('click',event=>{if(event.target.closest('button[data-command]'))closeSettings();});
  settingsPanel.querySelector('.jump').addEventListener('pointerdown',event=>event.preventDefault());
  bar.addEventListener('keydown',event=>{if(event.key==='Escape'){closeSettings();settingsToggle.focus();}});

  // Up to 4 highlight rectangles for a word split across a line break; index 0
  // doubles as the plain single-rectangle box used for the common case.
  const wordBoxes=[wordBox];
  for(let i=0;i<3;i++){const clone=wordBox.cloneNode(true);clip.append(clone);wordBoxes.push(clone);}
  status.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
  let lastWord=null, frame=0, isPlaying=false, navigationSignature='', lastRequested='', navigationDirty=true;
  const navigationPages=new Map();
  const send=(command,value)=>globalThis[bindingName](JSON.stringify({command,...(value === undefined ? {} : {value})}));
  const hasExplicitSelection=async()=>{
    let timer;
    try{
      if(viewer.currentController?.getSelectedText){
        // The native plugin is asynchronous. A missing answer must not leave
        // the Start button waiting indefinitely or transport selected prose.
        const selected=await Promise.race([
          Promise.resolve().then(()=>viewer.currentController.getSelectedText()),
          new Promise(resolve=>{timer=setTimeout(()=>resolve(null),350);}),
        ]);
        return typeof selected?.selectedText==='string'&&selected.selectedText.trim().length>0;
      }
      const selected=window.getSelection();
      return !!selected?.anchorNode&&scroller.contains(selected.anchorNode)&&String(selected).trim().length>0;
    }catch{return false;}finally{clearTimeout(timer);}
  };
  for (const button of shadow.querySelectorAll('button')) button.addEventListener('click',async()=>{
    const command=button.dataset.command;
    if(!command)return;
    if(command==='toggle'&&!isPlaying){
      const explicitSelection=await hasExplicitSelection();
      if(host.isConnected)send(command,explicitSelection?{explicitSelection:true}:undefined);
    }else if(command==='selection'){
      if(await hasExplicitSelection()){if(host.isConnected)send('selection');}
      else{status.textContent=uiText('selectionRequired');status.setAttribute('aria-label',status.textContent);}
    }else send(command);
  });
  speed.addEventListener('change',()=>{speedChoice=Number(speed.value);send('speed',speedChoice);});
  // Local choices beat queued states until a newer confirmed preference revision.
  let followChoice=null,clickSeekChoice=null,speedChoice=null,lastPreferenceVersion=-1;
  follow.addEventListener('change',()=>{followChoice=follow.checked;send('follow',follow.checked);if(follow.checked)layout(true);});
  const disableFollow=()=>{
    if(followChoice===false&&!follow.checked)return;
    followChoice=false;follow.checked=false;send('follow',false);
  };
  const listeners=[];
  const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
  listen(document,'pointerdown',event=>{if(!event.composedPath().includes(bar))closeSettings();},true);

  const excluded=event=>event.composedPath().some(node=>
    node===bar||node===status||node?.isContentEditable||
    /^(INPUT|TEXTAREA|SELECT|BUTTON|AUDIO|VIDEO)$/.test(node?.tagName||'')||
    node?.getAttribute?.('role')==='slider');
  const inDocument=event=>{
    if(excluded(event))return false;
    const path=event.composedPath();
    if(path.includes(scroller)||path.includes(navigation)||path.includes(clip))return true;
    const s=scroller.getBoundingClientRect();
    return Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)&&event.clientX>=s.left&&event.clientX<=s.right&&event.clientY>=s.top&&event.clientY<=s.bottom;
  };
  listen(window,'wheel',event=>{if(inDocument(event)&&!event.ctrlKey&&!event.metaKey&&(event.deltaX||event.deltaY))disableFollow();},{capture:true,passive:true});
  listen(window,'keydown',event=>{
    if(excluded(event)||event.ctrlKey||event.metaKey||event.altKey)return;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' ','Spacebar'].includes(event.key))disableFollow();
  },true);
  let pan=null;const touchPointers=new Set();
  listen(window,'pointerdown',event=>{
    if(!inDocument(event)||event.ctrlKey||event.metaKey||event.altKey)return;
    const s=scroller.getBoundingClientRect();
    // Native PDF scrollbars may belong to the plugin rather than the DOM.
    // Recognize their edge affordance; ordinary document clicks still seek.
    if(event.button===1||(event.button===0&&(event.clientX>=s.right-16||event.clientY>=s.bottom-16)))disableFollow();
    if(event.pointerType==='touch'){touchPointers.add(event.pointerId);pan=touchPointers.size===1?{id:event.pointerId,x:event.clientX,y:event.clientY}:null;}
  },true);
  listen(window,'pointermove',event=>{if(pan&&event.pointerId===pan.id&&Math.hypot(event.clientX-pan.x,event.clientY-pan.y)>5)disableFollow();},{capture:true,passive:true});
  const endPan=event=>{touchPointers.delete(event.pointerId);pan=null;};
  listen(window,'pointerup',endPan,true);listen(window,'pointercancel',endPan,true);
  let touch=null;
  listen(window,'touchstart',event=>{if(inDocument(event)&&event.touches.length===1){const p=event.touches[0];touch={x:p.clientX,y:p.clientY};}else touch=null;},{capture:true,passive:true});
  listen(window,'touchmove',event=>{const p=event.touches[0];if(touch&&event.touches.length===1&&p&&Math.hypot(p.clientX-touch.x,p.clientY-touch.y)>5)disableFollow();},{capture:true,passive:true});
  listen(window,'touchend',()=>{touch=null;},true);listen(window,'touchcancel',()=>{touch=null;},true);
  // Navigation arrives independently of audio preparation. Choosing a starting
  // word must work before the first Play and again after Stop.
  const updateClickState=()=>navigation.toggleAttribute('data-active',clickSeek.checked);
  clickSeek.addEventListener('change',()=>{clickSeekChoice=clickSeek.checked;updateClickState();send('clickseek',clickSeek.checked);});
  bar.addEventListener('keydown',event=>event.stopPropagation());
  bar.addEventListener('pointerdown',event=>event.stopPropagation());
  // Bar position is a fraction of the free space inside the visible scroller
  // rect: x=(left-visibleLeft)/max(1,visibleWidth-barWidth), y analogous.
  // {x:0,y:0} is flush top-left, {x:1,y:1} flush bottom-right, {x:.5,y:1} is
  // the previous fixed bottom-centered placement and remains the default.
  // MARGIN below is unrelated to this formula: it only caps the bar's own
  // width, same as before this change.
  const MARGIN=12;
  const clamp01=n=>Math.min(1,Math.max(0,n));
  const round4=n=>Math.round(n*10000)/10000;
  const freeSpace=()=>{
    const s=scroller.getBoundingClientRect();
    return {visibleLeft:Math.max(0,s.left),visibleRight:Math.min(innerWidth,s.right),
      visibleTop:Math.max(0,s.top),visibleBottom:Math.min(innerHeight,s.bottom)};
  };
  let positionFraction={x:.5,y:1}, userPosition=null, saveTimer=null,deferredPosition=null;
  const schedulePositionSave=()=>{
    clearTimeout(saveTimer);
    const saved={x:round4(userPosition.x),y:round4(userPosition.y)};
    saveTimer=setTimeout(()=>{saveTimer=null;send('barPosition',saved);},250);
  };
  const setUserPosition=frac=>{userPosition={x:clamp01(frac.x),y:clamp01(frac.y)};positionFraction=userPosition;layout();schedulePositionSave();};
  const resetPosition=()=>setUserPosition({x:.5,y:1});
  // Dragging starts on the handle or on otherwise-empty bar background, never
  // on a button/select/checkbox/status text — those stay normally operable.
  const dragSource=event=>event.target===bar||event.target===handle||handle.contains(event.target);
  let drag=null;
  listen(bar,'pointerdown',event=>{
    if(event.button!==0||event.ctrlKey||event.metaKey||event.altKey||!dragSource(event))return;
    const r=bar.getBoundingClientRect();
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left,top:r.top,moved:false};
    try{bar.setPointerCapture(event.pointerId);}catch{}
    bar.toggleAttribute('data-dragging',true);
    event.preventDefault();
  });
  listen(bar,'pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moved&&Math.hypot(dx,dy)>3)drag.moved=true;
    if(!drag.moved)return;
    const {visibleLeft,visibleRight,visibleTop,visibleBottom}=freeSpace();
    const r=bar.getBoundingClientRect();
    const freeW=Math.max(1,(visibleRight-visibleLeft)-r.width);
    const freeH=Math.max(1,(visibleBottom-visibleTop)-r.height);
    positionFraction={x:clamp01((drag.left+dx-visibleLeft)/freeW),y:clamp01((drag.top+dy-visibleTop)/freeH)};
    refresh();
  });
  const endDrag=event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const moved=drag.moved;
    try{bar.releasePointerCapture(event.pointerId);}catch{}
    drag=null;bar.toggleAttribute('data-dragging',false);
    if(moved){userPosition={...positionFraction};schedulePositionSave();}
    else if(deferredPosition){positionFraction=deferredPosition;userPosition=null;layout();}
    deferredPosition=null;
  };
  listen(bar,'pointerup',endDrag);listen(bar,'pointercancel',endDrag);
  handle.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();resetPosition();});
  handle.addEventListener('keydown',event=>{
    if(event.key==='Home'){event.preventDefault();event.stopPropagation();resetPosition();return;}
    const step=16;let dx=0,dy=0;
    if(event.key==='ArrowLeft')dx=-step;else if(event.key==='ArrowRight')dx=step;
    else if(event.key==='ArrowUp')dy=-step;else if(event.key==='ArrowDown')dy=step;
    else return;
    event.preventDefault();event.stopPropagation();
    const {visibleLeft,visibleRight,visibleTop,visibleBottom}=freeSpace();
    const r=bar.getBoundingClientRect();
    const freeW=Math.max(1,(visibleRight-visibleLeft)-r.width);
    const freeH=Math.max(1,(visibleBottom-visibleTop)-r.height);
    setUserPosition({x:(r.left+dx-visibleLeft)/freeW,y:(r.top+dy-visibleTop)/freeH});
  });
  function layoutNavigation(s,vw,vh) {
    const pos=viewport.position;
    const signature=[pos.x,pos.y,viewport.getZoom(),s.x,s.y,s.width,s.height,vw,vh,viewport.getClockwiseRotations(),viewport.twoUpViewEnabled()].join('|');
    if(signature===navigationSignature&&!navigationDirty)return;
    navigationSignature=signature;navigationDirty=false;
    const count=viewer.documentDimensions?.pageDimensions?.length || 0;
    if(!count||viewport.getClockwiseRotations()!==0||viewport.twoUpViewEnabled()){navigation.replaceChildren();return;}
    let start=viewport.getMostVisiblePage();
    while(start>0){const r=viewport.getPageScreenRect(start-1);if(r.y+r.height<=0)break;start--;}
    const visible=[];
    for(let page=start;page<count;page++){
      const r=viewport.getPageScreenRect(page);
      if(r.y>=vh)break;
      if(r.y+r.height>0)visible.push(page+1);
    }
    const requested=visible.join(',');
    if(requested!==lastRequested){lastRequested=requested;globalThis[bindingName](JSON.stringify({type:'navigationRequest',pages:visible}));}
    const nodes=document.createDocumentFragment();
    for(const page of visible){
      const r=viewport.getPageScreenRect(page-1);
      for(const source of navigationPages.get(page)||[]){
        const [chunkIndex,charStart,x0,y0,x1,y1,pageWidth,pageHeight]=source;
        const left=r.x+x0/pageWidth*r.width, top=r.y+y0/pageHeight*r.height;
        const width=(x1-x0)/pageWidth*r.width, height=(y1-y0)/pageHeight*r.height;
        if(top+height<=0||top>=vh||left+width<=0||left>=vw)continue;
        const hit=document.createElement('div');hit.className='hit';
        hit.dataset.chunkIndex=String(chunkIndex);hit.dataset.charStart=String(charStart);hit.dataset.page=String(page);
        Object.assign(hit.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`});
        let down=null;
        hit.addEventListener('pointerdown',event=>{
          if(!clickSeek.checked||event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
          down={x:event.clientX,y:event.clientY,id:event.pointerId,moved:false};
          try{hit.setPointerCapture(event.pointerId);}catch{}
          event.preventDefault();event.stopPropagation();
        });
        hit.addEventListener('pointermove',event=>{if(down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)down.moved=true;});
        hit.addEventListener('pointercancel',()=>{down=null;});
        hit.addEventListener('pointerup',event=>{
          const press=down;down=null;
          if(!press)return;
          event.preventDefault();event.stopPropagation();
          if(clickSeek.checked&&event.button===0&&event.pointerId===press.id&&!press.moved&&Math.hypot(event.clientX-press.x,event.clientY-press.y)<=5&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey)send('seek',{chunkIndex,charStart});
        });
        hit.addEventListener('wheel',event=>{
          if(event.ctrlKey||event.metaKey)return;
          const unit=event.deltaMode===1?16:event.deltaMode===2?vh:1;
          const x=(event.deltaX||(event.shiftKey?event.deltaY:0))*unit;
          const y=(event.shiftKey?0:event.deltaY)*unit;
          viewport.scrollBy({x,y});event.preventDefault();event.stopPropagation();refresh();
        },{passive:false});
        nodes.append(hit);
      }
    }
    navigation.replaceChildren(nodes);updateClickState();
  }
  function layout(allowFollow=false,restorePosition=false) {
    const vw=viewport.size.width, vh=viewport.size.height;
    const {visibleLeft,visibleRight,visibleTop,visibleBottom}=freeSpace();
    const s=scroller.getBoundingClientRect();
    // MARGIN here only caps the bar's own width; the position fraction below
    // follows x=(left-visibleLeft)/max(1,visibleWidth-barWidth) exactly, with
    // no extra inset — {x:0,y:0}/{x:1,y:1} sit flush against the edges.
    const width=Math.min(520,Math.max(0,visibleRight-visibleLeft-2*MARGIN));
    bar.toggleAttribute('data-narrow',width<560);
    bar.style.width=`${width}px`;
    let barRect=bar.getBoundingClientRect();
    const freeW=Math.max(1,(visibleRight-visibleLeft)-width);
    const freeH=Math.max(1,(visibleBottom-visibleTop)-barRect.height);
    Object.assign(bar.style,{left:`${visibleLeft+positionFraction.x*freeW}px`,top:`${visibleTop+positionFraction.y*freeH}px`});
    barRect=bar.getBoundingClientRect();
    // The expanded status panel hangs below the bar while the bar sits in the
    // upper half of the visible area, otherwise it is placed above it.
    const visibleMidY=(visibleTop+visibleBottom)/2;
    bar.toggleAttribute('data-expand-above',(barRect.top+barRect.bottom)/2>=visibleMidY);
    Object.assign(clip.style,{left:`${s.left}px`,top:`${s.top}px`,width:`${Math.min(s.width,vw)}px`,height:`${Math.min(s.height,vh)}px`});
    layoutNavigation(s,vw,vh);
    // The word must stay clear of the bar, and of the status panel attached
    // to it while expanded, wherever on screen the user has parked the bar.
    const expandedRect=settingsPanel.hasAttribute('data-open')?settingsPanel.getBoundingClientRect():null;
    const obstruct=expandedRect?{
      top:Math.min(barRect.top,expandedRect.top),bottom:Math.max(barRect.bottom,expandedRect.bottom),
      left:Math.min(barRect.left,expandedRect.left),right:Math.max(barRect.right,expandedRect.right),
    }:barRect;
    const safe={left:visibleLeft-s.left+12,right:visibleRight-s.left-12,top:visibleTop-s.top+12,bottom:visibleBottom-s.top-12};
    if((obstruct.top+obstruct.bottom)/2>=visibleMidY)safe.bottom=Math.min(safe.bottom,obstruct.top-s.top-8);
    else safe.top=Math.max(safe.top,obstruct.bottom-s.top+8);
    const EDGE=2;
    if(obstruct.left<=visibleLeft+EDGE)safe.left=Math.max(safe.left,obstruct.right-s.left+8);
    if(obstruct.right>=visibleRight-EDGE)safe.right=Math.min(safe.right,obstruct.left-s.left-8);
    safe.right=Math.max(safe.left+1,safe.right);safe.bottom=Math.max(safe.top+1,safe.bottom);
    if(!lastWord){for(const box of wordBoxes)box.style.display='none';return;}
    const w=lastWord;
    wordBox.dataset.page=String(w.page);
    wordBox.dataset.bbox=JSON.stringify(w.bbox);
    if(viewport.getClockwiseRotations()!==0||viewport.twoUpViewEnabled()){for(const box of wordBoxes)box.style.display='none';return;}
    const count=viewer.documentDimensions?.pageDimensions?.length || 0;
    if(!Number.isInteger(w.page)||w.page<1||w.page>count||!(w.pageWidth>0&&w.pageHeight>0)||!Array.isArray(w.bbox)||w.bbox.length!==4||!w.bbox.every(Number.isFinite)){
      for(const box of wordBoxes)box.style.display='none';return;
    }
    let rect=viewport.getPageScreenRect(w.page-1);
    let x=rect.x+w.bbox[0]/w.pageWidth*rect.width;
    let y=rect.y+w.bbox[1]/w.pageHeight*rect.height;
    const h=(w.bbox[3]-w.bbox[1])/w.pageHeight*rect.height;
    const ww=(w.bbox[2]-w.bbox[0])/w.pageWidth*rect.width;
    // All coordinates below are local to the PDF viewport. Follow/scroll math
    // always uses bbox only, regardless of any drawn multi-rectangle parts.
    const validFocus=Array.isArray(w.focusBBox)&&w.focusBBox.length===4&&w.focusBBox.every(Number.isFinite)&&
      w.focusBBox[0]>=0&&w.focusBBox[1]>=0&&w.focusBBox[2]<=w.pageWidth&&w.focusBBox[3]<=w.pageHeight&&
      w.focusBBox[0]<=w.bbox[0]&&w.focusBBox[1]<=w.bbox[1]&&w.focusBBox[2]>=w.bbox[2]&&w.focusBBox[3]>=w.bbox[3];
    const f=validFocus?w.focusBBox:null;
    const context=f?{left:rect.x+f[0]/w.pageWidth*rect.width,right:rect.x+f[2]/w.pageWidth*rect.width,
      top:rect.y+f[1]/w.pageHeight*rect.height,bottom:rect.y+f[3]/w.pageHeight*rect.height}:null;
    const shiftAxis=(lo,hi,wordLo,wordHi,regionLo,regionHi)=>{
      if(regionLo!==undefined&&regionHi-regionLo<=hi-lo){
        // Minimal movement keeps a stable figure region motionless while its
        // caption is read. Fit each axis separately, without changing zoom.
        if(regionLo<lo)return regionLo-lo;
        if(regionHi>hi)return regionHi-hi;
        return 0;
      }
      const start=lo+(hi-lo)*.20,end=lo+(hi-lo)*.75;
      if(wordLo>=start&&wordHi<=end&&
        (regionLo===undefined||(regionLo<=lo&&regionHi>=hi)))return 0;
      if(regionLo!==undefined){
        // Oversized diagrams cannot fit at this zoom. Show the largest useful
        // context around their centre, constrained so the word stays visible.
        const ideal=(regionLo+regionHi-lo-hi)/2;
        return Math.max(wordHi-hi,Math.min(wordLo-lo,ideal));
      }
      return wordLo-(lo+(hi-lo)*.35);
    };
    const dy=shiftAxis(safe.top,safe.bottom,y,y+h,context?.top,context?.bottom);
    const dx=shiftAxis(safe.left,safe.right,x,x+ww,context?.left,context?.right);
    if(allowFollow && (follow.checked||restorePosition) && (Math.abs(dy)>.5||Math.abs(dx)>.5)) {
      const pos=viewport.position;
      const nextY=Math.max(0,pos.y+dy),nextX=Math.max(0,pos.x+dx);
      if(Math.abs(nextY-pos.y)>.5||Math.abs(nextX-pos.x)>.5)viewport.scrollTo({
        ...(Math.abs(nextY-pos.y)>.5?{y:nextY}:{}),
        ...(Math.abs(nextX-pos.x)>.5?{x:nextX}:{}),
        forceSmoothScroll:false
      });
      // Remote PDF scrolling is acknowledged asynchronously; the refresh timer
      // also recomputes after that acknowledgement without scrolling again.
      rect=viewport.getPageScreenRect(w.page-1);
      x=rect.x+w.bbox[0]/w.pageWidth*rect.width;
      y=rect.y+w.bbox[1]/w.pageHeight*rect.height;
    }
    // Draw one rectangle per part of a word split across a line break; the
    // common case (no parts) draws the single bbox rectangle as before. This
    // is purely visual — the follow/scroll decision above never used parts.
    // (Inlined like validFocus above: this function runs standalone in the
    // page, without access to the module-level validParts().)
    const partsValid=Array.isArray(w.parts)&&w.parts.length>0&&w.parts.length<=4&&w.parts.every(p=>
      Array.isArray(p)&&p.length===4&&p.every(Number.isFinite)&&
      p[0]>=0&&p[1]>=0&&p[2]<=w.pageWidth&&p[3]<=w.pageHeight&&p[2]>p[0]&&p[3]>p[1]);
    const sources=partsValid?w.parts:[w.bbox];
    for(let i=0;i<wordBoxes.length;i++){
      const box=wordBoxes[i], r=sources[i];
      if(!r){box.style.display='none';continue;}
      const bx=rect.x+r[0]/w.pageWidth*rect.width, by=rect.y+r[1]/w.pageHeight*rect.height;
      const bw=(r[2]-r[0])/w.pageWidth*rect.width, bh=(r[3]-r[1])/w.pageHeight*rect.height;
      Object.assign(box.style,{display:bw>0&&bh>0?'block':'none',left:`${bx-1}px`,top:`${by-1}px`,width:`${bw+2}px`,height:`${bh+2}px`});
    }
  }
  const refresh=()=>{if(document.hidden){layout();return;}if(!frame)frame=requestAnimationFrame(()=>{frame=0;layout();});};
  const observer=new ResizeObserver(refresh);observer.observe(scroller);
  window.addEventListener('resize',refresh);scroller.addEventListener('scroll',refresh,{passive:true});
  let destroyed=false;
  const timer=setInterval(refresh,120);
  let appearanceMode='off',lastAppearanceKey='',appearanceAttempts=0,lastAppearanceAt=0;
  const requestAppearance=()=>{if(appearanceMode==='off'||destroyed)return;let current,count;try{count=viewer.documentDimensions?.pageDimensions?.length||0;if(!count)return;current=viewport.getMostVisiblePage();}catch{return;}if(!Number.isInteger(current))return;const pages=[current+1];if(current+1<count){try{const next=viewport.getPageScreenRect(current+1);if(next.y<scroller.clientHeight)pages.push(current+2);}catch{}}let area=0;for(const page of pages){const dim=viewer.documentDimensions.pageDimensions[page-1];area+=(Number(dim.width)||800)*(Number(dim.height)||1100);}const maxDpi=96*Math.sqrt(16000000/Math.max(1,area)),dpi=Math.max(72,Math.floor(Math.min(384,maxDpi,Math.max(72,(viewport.getZoom?.()||1)*96*(devicePixelRatio||1)*1.5))/24)*24);const key=pages.join(',')+':'+dpi;if(key!==lastAppearanceKey){lastAppearanceKey=key;appearanceAttempts=0;}const now=performance.now();if(appearanceAttempts>=3||appearanceAttempts&&now-lastAppearanceAt<2000)return;lastAppearanceAt=now;appearanceAttempts++;if(typeof globalThis[bindingName]==='function')globalThis[bindingName](JSON.stringify({type:'appearanceRequest',pages,dpi}));};
  scroller.addEventListener('scroll',requestAppearance,{passive:true});
  let polish;const appearance=uiBundle?.appearanceFactory?.({kind:'pdf',viewer,uiHost:host,onStatus:info=>polish?.appearanceStatus?.(info),onSystem:dark=>{if(typeof globalThis[bindingName]==='function')globalThis[bindingName](JSON.stringify({type:'appearanceSystem',dark}));}});polish=surface.mountPolish({appearanceController:appearance,onFormats:format=>{formatNumber=format;},onLocale:code=>{uiLocale=code;voiceUi.refreshLocale();volumeUi.refreshLocale();},relayout:()=>layout()});
  const controller={owner:bindingName,setVisibility(visible){surface.setVisibility(visible);clip.style.visibility=visible?'':'hidden';layout();return surface.getActualVisible();},getActualVisible:surface.getActualVisible,
    update(message){
      if(destroyed||!host.isConnected)return;
      if(message.type==='appearanceFigures'){appearance?.setFigures(message.appearanceFigures,message.appearancePages,message.appearanceRasters,message.appearanceLinks);return;}
      if(message.type==='state'){const nextMode=message.appearance?.mode||'off';if(appearanceMode!==nextMode){lastAppearanceKey='';appearanceAttempts=0;}appearanceMode=nextMode;requestAppearance();}
      if(message.type==='navigation'){
        for(const [page,words] of Object.entries(message.pages||{})){
          const n=Number(page);if(!Number.isInteger(n)||n<1||!Array.isArray(words))continue;
          navigationPages.set(n,words.filter(w=>Array.isArray(w)&&w.length===8&&w.every(Number.isFinite)&&Number.isInteger(w[0])&&w[0]>=0&&Number.isInteger(w[1])&&w[1]>=0&&w[4]>w[2]&&w[5]>w[3]&&w[6]>0&&w[7]>0));
        }
        navigationDirty=true;layout();
      }else if(message.type==='state'){
        polish?.prepare(message);
        const version=Number.isSafeInteger(message.preferenceVersion)&&message.preferenceVersion>=0?message.preferenceVersion:null;
        const preferencesCurrent=version===null?lastPreferenceVersion<0:version>=lastPreferenceVersion;
        const serverPosition=message.barPosition&&Number.isFinite(message.barPosition.x)&&Number.isFinite(message.barPosition.y)&&message.barPosition.x>=0&&message.barPosition.x<=1&&message.barPosition.y>=0&&message.barPosition.y<=1?{x:message.barPosition.x,y:message.barPosition.y}:null;
        if(version!==null&&version>lastPreferenceVersion){
          const confirmedNewer=lastPreferenceVersion>=0;lastPreferenceVersion=version;
          if(confirmedNewer){
            followChoice=null;clickSeekChoice=null;speedChoice=null;
            clearTimeout(saveTimer);saveTimer=null;
            if(drag)deferredPosition=serverPosition;
            else userPosition=null;
          }
        }
        isPlaying=message.playing===true;
        if(Array.isArray(message.catalog))voiceUi.update(message);volumeUi.update(message);
        if(preferencesCurrent&&clickSeekChoice===null&&typeof message.clickSeek==='boolean')clickSeek.checked=message.clickSeek;
        updateClickState();
        toggle.innerHTML=icon(message.playing&&!message.paused?'pause':'play');
        toggle.setAttribute('aria-label',message.playing&&!message.paused?'Pause':message.paused?'Weiter vorlesen':'Vorlesen');
        if(preferencesCurrent&&speedChoice===null&&Number.isFinite(message.speed)&&message.speed>=.8&&message.speed<=4){
          const value=(Math.round(message.speed*100)/100).toFixed(2);
          if(![...speed.options].some(option=>option.value===value)){const option=document.createElement('option');option.value=value;option.textContent=value.replace('.',',')+'×';speed.append(option);}
          speed.value=value;speed.disabled=false;
        }
        if(preferencesCurrent&&followChoice===null&&typeof message.follow==='boolean')follow.checked=message.follow;
        if(Object.hasOwn(message,'remainingSeconds')){
          const n=message.remainingSeconds;
          const valid=typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<1e9;
          remaining.style.display=valid?'block':'none';
          if(valid){
            const seconds=Math.ceil(n),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60;
            const duration=hours?`${hours}:${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:`${minutes}:${String(seconds%60).padStart(2,'0')}`;
            remaining.textContent=`Rest${message.remainingEstimated===true?' ca.':''} ${duration}`;
            remaining.setAttribute('aria-label',remaining.textContent);
          }else{remaining.textContent='';remaining.setAttribute('aria-label','Restdauer unbekannt');}
        }
        const statusText=String(message.status || 'Bereit');
        status.textContent=statusText;status.setAttribute('aria-label',statusText);status.title=statusText;
        polish?.update(message);
        // A local drag/keyboard choice beats queued positions of the same revision.
        if(preferencesCurrent&&!drag&&userPosition===null&&message.barPosition&&typeof message.barPosition==='object'&&
          Number.isFinite(message.barPosition.x)&&Number.isFinite(message.barPosition.y)&&
          message.barPosition.x>=0&&message.barPosition.x<=1&&message.barPosition.y>=0&&message.barPosition.y<=1){
          positionFraction={x:message.barPosition.x,y:message.barPosition.y};
        }
      }else if(message.type==='word'){
        if(message.preview===true&&message.follow===true)polish?.closePopovers();
        lastWord=message.word;
        // Follow is owned by versioned state; an older audio word cannot change it.
        // Returning to a document reveals its saved word once. This does not
        // undo the user's Follow choice or start playback.
        layout(message.preview!==true||message.follow===true,message.restore===true||(message.preview===true&&message.follow===true));
      }else if(message.type==='clear'){lastWord=null;layout();}
      refresh();
    },
    destroy(){if(destroyed)return;destroyed=true;surface.destroy();appearance?.destroy();for(const remove of listeners)remove();clearInterval(timer);clearTimeout(saveTimer);cancelAnimationFrame(frame);observer.disconnect();ownershipObserver.disconnect();window.removeEventListener('resize',refresh);scroller.removeEventListener('scroll',refresh);scroller.removeEventListener('scroll',requestAppearance);host.removeEventListener('notable-reader-dispose',dispose);host.remove();if(globalThis[key]===controller)delete globalThis[key];}
  };
  const dispose=()=>controller.destroy();
  const ownershipObserver=new MutationObserver(()=>{if(!host.isConnected){if(!destroyed&&typeof globalThis[bindingName]==='function')globalThis[bindingName](JSON.stringify({type:'surfaceLost'}));dispose();}});
  ownershipObserver.observe(host.getRootNode(),{childList:true,subtree:true});
  host.addEventListener('notable-reader-dispose',dispose);
  shadow.querySelector('.closeReader').addEventListener('click',()=>send('setOverlayVisible',false));
  globalThis[key]=controller;
  layout();
  return true;
}

function installHtmlInline(expectedUrl,bindingName,key,collect,framed=false,uiBundle=undefined) {
  let uiLocale='de',formatNumber=value=>String(value);
  const uiText=(key,args={})=>(uiBundle?.locales?.messages?.[uiLocale]?.[key]||uiBundle?.locales?.messages?.de?.[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(args[k]??''));
  const languageLabel=(code,fallback)=>{try{return new Intl.DisplayNames([uiLocale],{type:'language'}).of(code);}catch{return fallback||code;}};
  const voiceNote=note=>note.replace(/weiblich/g,uiText('female')).replace(/männlich/g,uiText('male')).replace(/hoch/g,uiText('high')).replace(/leise/g,uiText('quiet')).replace(/Brasilien/g,uiText('brazil'));

  if((window.top!==window.self&&!framed)||location.origin+location.pathname!==expectedUrl||!document.body)return false;
  const {root:content,nodes:blocks}=collect();
  if(!blocks.length)return false;
  globalThis[key]?.destroy();
  for(const old of document.querySelectorAll('#brave-reader-inline,#brave-reader-inline-html,[data-notable-reader-ui]')){old.dispatchEvent(new Event('notable-reader-dispose'));old.remove();}
  const host=document.createElement('div');host.id='brave-reader-inline-html';host.dataset.notableReaderUi=bindingName;host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow=host.attachShadow({mode:'open'});
  const surface=uiBundle.surface({mount:host,shadow,managed:false,locales:uiBundle.locales,formattingFactory:uiBundle.formattingFactory,onCommand:(...args)=>send(...args)});
  const {icon,voiceUi,volumeUi}=surface;
  const geometry=document.createElement('template');geometry.innerHTML='<style>.layer{position:fixed;inset:0;pointer-events:none}.mark{position:absolute;background:rgba(255,215,35,.48);border:1px solid #c68b00;border-radius:3px;pointer-events:none}.hits{pointer-events:none}.hits[data-active] .hit{pointer-events:auto}.hit{position:absolute;background:transparent;cursor:pointer}</style><div class="layer"><div class="mark"></div><div class="hits"></div></div>';shadow.prepend(geometry.content);
  document.body.append(host);
  const bar=shadow.querySelector('.bar'),layer=shadow.querySelector('.layer'),mark=shadow.querySelector('.mark'),hits=shadow.querySelector('.hits'),toggle=shadow.querySelector('.primary'),restart=shadow.querySelector('.restart'),selectionButton=shadow.querySelector('.jump'),stop=shadow.querySelector('.stop'),speed=shadow.querySelector('.speed'),follow=shadow.querySelector('.follow'),clickseek=shadow.querySelector('.clickseek'),status=shadow.querySelector('.status'),remaining=shadow.querySelector('.remaining'),handle=shadow.querySelector('.handle');
  let playing=false,followChoice=null,clickSeekChoice=null,speedChoice=null,lastPreferenceVersion=-1,userPosition=null,position={x:.5,y:1},lastWord=null,lastRequest='',nav=new Map();
  const settingsToggle=shadow.querySelector('.settingsToggle'),settingsPanel=shadow.querySelector('.settings-panel');
  let followsText=true;
  Object.defineProperty(follow,'checked',{get:()=>followsText,set:value=>{followsText=value===true;follow.setAttribute('aria-pressed',String(followsText));follow.title=uiText(followsText?'followOn':'followOff');follow.setAttribute('aria-label',follow.title);}});
  follow.checked=true;follow.addEventListener('click',()=>{follow.checked=!follow.checked;follow.dispatchEvent(new Event('change'));});
  const closeSettings=()=>{settingsPanel.removeAttribute('data-open');settingsToggle.setAttribute('aria-expanded','false');};
  settingsToggle.addEventListener('click',()=>{const open=!settingsPanel.hasAttribute('data-open');settingsPanel.toggleAttribute('data-open',open);settingsToggle.setAttribute('aria-expanded',String(open));placeBar();});
  settingsPanel.addEventListener('click',event=>{if(event.target.closest('.jump,.restart,.stop'))closeSettings();});
  bar.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){closeSettings();settingsToggle.focus();}});
  bar.addEventListener('pointerdown',event=>event.stopPropagation());

  const send=(command,value)=>globalThis[bindingName](JSON.stringify({command,...(value===undefined?{}:{value})}));
  const selectedArticleText=()=>{const s=getSelection(),node=s?.anchorNode;return node&&content.contains(node)&&String(s).trim()?String(s).trim():'';};
  const updateSelectionButton=()=>{selectionButton.disabled=!selectedArticleText();};
  document.addEventListener('selectionchange',updateSelectionButton);
  selectionButton.addEventListener('pointerdown',e=>e.preventDefault());selectionButton.addEventListener('click',()=>{if(selectedArticleText())send('selection');});
  toggle.addEventListener('click',()=>{const selection=selectedArticleText();send('toggle',!playing&&selection?{explicitSelection:true}:undefined);});restart.addEventListener('click',()=>send('restart'));stop.addEventListener('click',()=>send('stop'));
  speed.addEventListener('change',()=>{speedChoice=Number(speed.value);send('speed',speedChoice);});
  follow.addEventListener('change',()=>{followChoice=follow.checked;send('follow',follow.checked);});
  clickseek.addEventListener('change',()=>{clickSeekChoice=clickseek.checked;hits.toggleAttribute('data-active',clickseek.checked);send('clickseek',clickseek.checked);});
  status.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
  const manualScroll=()=>{if(follow.checked){follow.checked=false;followChoice=false;send('follow',false);}};
  const excluded=e=>e.composedPath().some(n=>n===bar||/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(n?.tagName||''));
  const listeners=[];const listen=(t,n,f,o)=>{t.addEventListener(n,f,o);listeners.push(()=>t.removeEventListener(n,f,o));};
  listen(document,'pointerdown',event=>{if(!event.composedPath().includes(bar))closeSettings();},true);

  listen(window,'wheel',e=>{if(!excluded(e)&&!e.ctrlKey&&(e.deltaX||e.deltaY))manualScroll();},{capture:true,passive:true});
  listen(window,'keydown',e=>{if(!excluded(e)&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Spacebar'].includes(e.key))manualScroll();},true);
  let pan=null;listen(window,'pointerdown',e=>{if(!excluded(e)&&e.button===0)pan={x:e.clientX,y:e.clientY};},true);listen(window,'pointermove',e=>{if(pan&&Math.hypot(e.clientX-pan.x,e.clientY-pan.y)>5){manualScroll();pan=null;}},{capture:true,passive:true});listen(window,'pointerup',()=>pan=null,true);listen(window,'pointercancel',()=>pan=null,true);
  // Retain DOM ranges for the original source words. A responsive reflow must
  // move the actual word, rather than proportionally scaling an obsolete box.
  const layouts=blocks.map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height};});
  const ranges=new Map(),rangeIndexes=new Map(),invalidBlocks=new Set();let frame=0,destroyed=false;
  const boxKey=box=>box.map(n=>Math.round(n*100)/100).join(',');
  const sourceRanges=page=>{
    if(ranges.has(page))return ranges.get(page);
    const element=blocks[page-1],layout=layouts[page-1],out=[];
    if(!element||invalidBlocks.has(page))return out;
    const block=element.getBoundingClientRect();
    if(Math.abs(block.width-layout.width)>1||Math.abs(block.height-layout.height)>1)return out;
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;
      for(const token of node.textContent.matchAll(/\S+/gu)){
        const range=document.createRange();range.setStart(node,token.index);range.setEnd(node,token.index+token[0].length);
        const rects=[...range.getClientRects()];if(!rects.length)continue;
        out.push({range,box:[Math.min(...rects.map(r=>r.left))-block.left,Math.min(...rects.map(r=>r.top))-block.top,Math.max(...rects.map(r=>r.right))-block.left,Math.max(...rects.map(r=>r.bottom))-block.top]});
      }
    }
    ranges.set(page,out);
    const index=new Map();for(const item of out)index.set(boxKey(item.box),item);rangeIndexes.set(page,index);
    return out;
  };
  const wordRect=(page,box,pw,ph)=>{
    if(invalidBlocks.has(page)||!Array.isArray(box))return null;
    const layout=layouts[page-1];if(!layout||Math.abs(layout.width-pw)>1||Math.abs(layout.height-ph)>1)return null;
    const records=sourceRanges(page),index=rangeIndexes.get(page),id=boxKey(box);
    if(!index)return null;
    // Cache the rare tolerance match, including misses: scrolling performs
    // constant-time source lookup rather than scanning every source word.
    if(!index.has(id))index.set(id,records.find(item=>item.box.every((n,i)=>Math.abs(n-box[i])<1.25))||null);
    const found=index.get(id);
    if(!found||!found.range.startContainer.isConnected)return null;
    const rects=[...found.range.getClientRects()];if(!rects.length)return null;
    return {left:Math.min(...rects.map(r=>r.left)),top:Math.min(...rects.map(r=>r.top)),right:Math.max(...rects.map(r=>r.right)),bottom:Math.max(...rects.map(r=>r.bottom))};
  };
  const paintWord=()=>{
    const r=lastWord&&lastWord.geometryValid!==false?wordRect(lastWord.page,lastWord.bbox,lastWord.pageWidth,lastWord.pageHeight):null;
    if(!r){mark.style.display='none';return;}
    Object.assign(mark.style,{display:'block',left:`${r.left}px`,top:`${r.top}px`,width:`${r.right-r.left}px`,height:`${r.bottom-r.top}px`});
  };
  const revealSpacers=new Map();
  const reserveRevealSpace=(container,side,height)=>{
    const parent=container===window?document.body:container;
    // Empty UI spacing never changes document prose or a captured source block.
    if(blocks.includes(parent))return;
    let pair=revealSpacers.get(parent);if(!pair){pair={};revealSpacers.set(parent,pair);}let spacer=pair[side];if(!spacer){spacer=document.createElement('div');spacer.dataset.notableReaderSpacing=bindingName;spacer.dataset.notableReaderUi=bindingName;spacer.setAttribute('aria-hidden','true');spacer.style.cssText='display:block;clear:both;flex:0 0 auto;grid-column:1/-1;width:100%;min-width:0;margin:0;padding:0;border:0;line-height:0;pointer-events:none;';pair[side]=spacer;if(side==='top')parent.prepend(spacer);else parent.append(spacer);}spacer.style.height=Math.max(Number.parseFloat(spacer.style.height)||0,height)+'px';
  };
  const revealWord=()=>{
    if(!lastWord||lastWord.geometryValid===false)return;
    const containers=[];for(let node=blocks[lastWord.page-1]?.parentElement;node&&node!==document.body;node=node.parentElement){const style=getComputedStyle(node);if((/(auto|scroll)/.test(style.overflowY)&&node.scrollHeight>node.clientHeight)||(/(auto|scroll)/.test(style.overflowX)&&node.scrollWidth>node.clientWidth))containers.push(node);}containers.push(window);
    for(const container of containers){const r=wordRect(lastWord.page,lastWord.bbox,lastWord.pageWidth,lastWord.pageHeight);if(!r)return;const c=container===window?{top:0,left:0,right:innerWidth,bottom:innerHeight}:container.getBoundingClientRect();let top=Math.max(0,c.top)+12,bottom=Math.min(innerHeight,c.bottom)-12,left=Math.max(0,c.left)+12,right=Math.min(innerWidth,c.right)-12;const b=bar.getBoundingClientRect();if(b.left<r.right&&b.right>r.left){if((b.top+b.bottom)/2>innerHeight/2)bottom=Math.min(bottom,b.top-12);else top=Math.max(top,b.bottom+12);}const dy=r.top<top||r.bottom>bottom?r.top-(top+Math.max(30,bottom-top)*.35):0,dx=r.left<left||r.right>right?r.left-(left+Math.max(30,right-left)*.2):0;if(Math.abs(dy)>.5||Math.abs(dx)>.5)container.scrollBy({top:dy,left:dx,behavior:'instant'});const after=wordRect(lastWord.page,lastWord.bbox,lastWord.pageWidth,lastWord.pageHeight);if(after&&after.bottom>bottom+.5){reserveRevealSpace(container,'bottom',bar.offsetHeight+32);container.scrollBy({top:after.bottom-bottom+16,behavior:'instant'});}else if(after&&after.top<top-.5){reserveRevealSpace(container,'top',bar.offsetHeight+32);}}
    paintWord();
  };
  const refreshNavigation=()=>{
    const visible=[];for(let i=0;i<blocks.length;i++){const r=blocks[i].getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight&&!invalidBlocks.has(i+1))visible.push(i+1);}
    const signature=visible.join(',');if(signature!==lastRequest){lastRequest=signature;const all=Array.from({length:Math.min(blocks.length,100)},(_,i)=>i+1);globalThis[bindingName](JSON.stringify({type:'navigationRequest',pages:[...new Set([...visible,...all])]}));}
    const nodes=document.createDocumentFragment();
    for(const page of visible){for(const item of nav.get(page)||[]){
      const [chunkIndex,charStart,x0,y0,x1,y1,pw,ph]=item,r=wordRect(page,[x0,y0,x1,y1],pw,ph);
      if(!r||r.right<=0||r.left>=innerWidth||r.bottom<=0||r.top>=innerHeight)continue;
      const hit=document.createElement('div');hit.className='hit';Object.assign(hit.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.right-r.left}px`,height:`${r.bottom-r.top}px`});let down=null;
      hit.addEventListener('pointerdown',e=>{if(!clickseek.checked||e.button!==0||e.shiftKey||e.ctrlKey||e.metaKey||e.altKey)return;down={id:e.pointerId,x:e.clientX,y:e.clientY};try{hit.setPointerCapture(e.pointerId);}catch{}e.preventDefault();e.stopPropagation();});
      hit.addEventListener('pointerup',e=>{const press=down;down=null;if(!press)return;e.preventDefault();e.stopPropagation();if(e.pointerId===press.id&&Math.hypot(e.clientX-press.x,e.clientY-press.y)<=5&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey)send('seek',{chunkIndex,charStart});});hit.addEventListener('pointercancel',()=>down=null);nodes.append(hit);
    }}
    hits.replaceChildren(nodes);paintWord();
  };
  const scheduleGeometry=()=>{if(!frame&&!destroyed)frame=requestAnimationFrame(()=>{frame=0;if(!destroyed)refreshNavigation();});};
  // Capture ranges for every block before any later reflow, including blocks
  // outside the initial viewport. The ranges keep their logical DOM offsets.
  for(let page=1;page<=blocks.length;page++)sourceRanges(page);
  listen(window,'scroll',scheduleGeometry,{capture:true,passive:true});listen(window,'resize',scheduleGeometry,{passive:true});
  const resizeObserver=new ResizeObserver(scheduleGeometry);for(const block of blocks)resizeObserver.observe(block);
  // Text replacement invalidates source offsets. Suppress stale interactions
  // until the document is explicitly captured again instead of guessing a word.
  const mutationObserver=new MutationObserver(records=>{let changed=false;for(const record of records){if(host.contains(record.target))continue;if(record.type==='childList'){const touched=[...record.addedNodes,...record.removedNodes];if(touched.length&&touched.every(node=>node.nodeType===Node.ELEMENT_NODE&&node.dataset?.notableReaderSpacing===bindingName&&node.textContent===''))continue;}for(let i=0;i<blocks.length;i++){if(blocks[i]===record.target||blocks[i].contains(record.target)||(!blocks[i].isConnected)){invalidBlocks.add(i+1);ranges.delete(i+1);rangeIndexes.delete(i+1);changed=true;}}}if(changed)scheduleGeometry();});
  mutationObserver.observe(content,{subtree:true,childList:true,characterData:true});
  let dragging=null,deferredPosition=null;handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=bar.getBoundingClientRect();dragging={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,moved:false};handle.setPointerCapture(e.pointerId);e.preventDefault();});
  handle.addEventListener('pointermove',e=>{if(!dragging||e.pointerId!==dragging.id)return;if(Math.hypot(e.clientX-dragging.x,e.clientY-dragging.y)>3)dragging.moved=true;const r=bar.getBoundingClientRect();const left=Math.max(0,Math.min(innerWidth-r.width,dragging.left+e.clientX-dragging.x)),top=Math.max(0,Math.min(innerHeight-r.height,dragging.top+e.clientY-dragging.y));bar.style.left=left+'px';bar.style.top=top+'px';bar.style.bottom='auto';position={x:left/Math.max(1,innerWidth-r.width),y:top/Math.max(1,innerHeight-r.height)};bar.toggleAttribute('data-expand-above',top+r.height/2>=innerHeight/2);});
  const endDrag=e=>{if(!dragging||e.pointerId!==dragging.id)return;const moved=dragging.moved;try{handle.releasePointerCapture(e.pointerId);}catch{}dragging=null;if(!moved&&deferredPosition){position=deferredPosition;userPosition=null;}else{userPosition={...position};send('barPosition',position);}deferredPosition=null;placeBar();};
  handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',endDrag);
  handle.addEventListener('dblclick',e=>{e.preventDefault();position={x:.5,y:1};userPosition={...position};placeBar();send('barPosition',position);});
  handle.addEventListener('keydown',e=>{let dx=0,dy=0;if(e.key==='ArrowLeft')dx=-16;else if(e.key==='ArrowRight')dx=16;else if(e.key==='ArrowUp')dy=-16;else if(e.key==='ArrowDown')dy=16;else if(e.key==='Home'){position={x:.5,y:1};userPosition={...position};placeBar();send('barPosition',position);e.preventDefault();return;}else return;e.preventDefault();const r=bar.getBoundingClientRect();position={x:Math.max(0,Math.min(1,(r.left+dx)/Math.max(1,innerWidth-r.width))),y:Math.max(0,Math.min(1,(r.top+dy)/Math.max(1,innerHeight-r.height)))};userPosition={...position};placeBar();send('barPosition',position);});
  const placeBar=()=>{bar.style.left=`${position.x*Math.max(0,innerWidth-bar.offsetWidth)}px`;bar.style.top='auto';bar.style.bottom=`${(1-position.y)*Math.max(0,innerHeight-bar.offsetHeight)}px`;const r=bar.getBoundingClientRect();bar.toggleAttribute('data-expand-above',(r.top+r.bottom)/2>=innerHeight/2);};
  listen(window,'resize',placeBar,{passive:true});
  let polish;const appearance=uiBundle?.appearanceFactory?.({kind:'html',uiHost:host,onStatus:info=>polish?.appearanceStatus?.(info),onSystem:dark=>{if(typeof globalThis[bindingName]==='function')globalThis[bindingName](JSON.stringify({type:'appearanceSystem',dark}));}});polish=surface.mountPolish({appearanceController:appearance,onFormats:format=>{formatNumber=format;},onLocale:code=>{uiLocale=code;voiceUi.refreshLocale();volumeUi.refreshLocale();},relayout:()=>placeBar()});
  const controller={owner:bindingName,setVisibility(visible){surface.setVisibility(visible);layer.style.visibility=visible?'':'hidden';placeBar();return surface.getActualVisible();},getActualVisible:surface.getActualVisible,update(message){
    if(destroyed||!host.isConnected)return;
    if(message.type==='appearanceFigures'){appearance?.setFigures(message.appearanceFigures,message.appearancePages,message.appearanceRasters,message.appearanceLinks);return;}
    if(message.type==='state'){
      polish?.prepare(message);
      if(Array.isArray(message.catalog))voiceUi.update(message);volumeUi.update(message);
      const version=Number.isSafeInteger(message.preferenceVersion)&&message.preferenceVersion>=0?message.preferenceVersion:null;
      const preferencesCurrent=version===null?lastPreferenceVersion<0:version>=lastPreferenceVersion;
      const serverPosition=message.barPosition&&Number.isFinite(message.barPosition.x)&&Number.isFinite(message.barPosition.y)&&message.barPosition.x>=0&&message.barPosition.x<=1&&message.barPosition.y>=0&&message.barPosition.y<=1?{x:message.barPosition.x,y:message.barPosition.y}:null;
      if(version!==null&&version>lastPreferenceVersion){
        const confirmedNewer=lastPreferenceVersion>=0;lastPreferenceVersion=version;
        if(confirmedNewer){followChoice=null;clickSeekChoice=null;speedChoice=null;if(dragging)deferredPosition=serverPosition;else userPosition=null;}
      }
      if(preferencesCurrent&&clickSeekChoice===null&&typeof message.clickSeek==='boolean'){clickseek.checked=message.clickSeek;hits.toggleAttribute('data-active',clickseek.checked);}playing=message.playing===true;toggle.innerHTML=icon(playing&&!message.paused?'pause':'play');toggle.setAttribute('aria-label',playing&&!message.paused?'Pause':message.paused?'Weiter vorlesen':'Vorlesen');if(preferencesCurrent&&speedChoice===null&&Number.isFinite(message.speed)&&message.speed>=.8&&message.speed<=4){speed.value=(Math.round(message.speed*100)/100).toFixed(2);speed.disabled=false;}if(preferencesCurrent&&followChoice===null&&typeof message.follow==='boolean'){follow.checked=message.follow;}const text=String(message.status||'Bereit');status.textContent=text;status.title=text;status.setAttribute('aria-label',text);const n=message.remainingSeconds;if(Number.isFinite(n)&&n>=0){const s=Math.ceil(n),h=Math.floor(s/3600),m=Math.floor(s/60)%60;remaining.style.display='block';remaining.textContent=`Rest${message.remainingEstimated?' ca.':''} ${h?`${h}:${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${m}:${String(s%60).padStart(2,'0')}`}`;remaining.setAttribute('aria-label',remaining.textContent);}else{remaining.style.display='none';remaining.textContent='';remaining.setAttribute('aria-label','Restdauer unbekannt');}if(preferencesCurrent&&!dragging&&serverPosition&&userPosition===null){position=serverPosition;}polish?.update(message);if(!dragging)placeBar();}
    else if(message.type==='navigation'){for(const [page,items] of Object.entries(message.pages||{}))nav.set(Number(page),items);refreshNavigation();}
    else if(message.type==='word'&&message.word){if(message.preview===true&&message.follow===true)polish?.closePopovers();lastWord=message.word;if(message.preview===true?message.follow===true:follow.checked)revealWord();paintWord();}
    else if(message.type==='clear'){lastWord=null;mark.style.display='none';}
  },destroy(){if(destroyed)return;destroyed=true;surface.destroy();appearance?.destroy();if(frame)cancelAnimationFrame(frame);resizeObserver.disconnect();mutationObserver.disconnect();ownershipObserver.disconnect();for(const pair of revealSpacers.values())for(const spacer of Object.values(pair))spacer.remove();revealSpacers.clear();document.removeEventListener('selectionchange',updateSelectionButton);for(const remove of listeners)remove();host.removeEventListener('notable-reader-dispose',dispose);host.remove();ranges.clear();rangeIndexes.clear();nav.clear();if(globalThis[key]===controller)delete globalThis[key];}};
  const dispose=()=>controller.destroy();
  const ownershipObserver=new MutationObserver(()=>{if(!host.isConnected){if(!destroyed&&typeof globalThis[bindingName]==='function')globalThis[bindingName](JSON.stringify({type:'surfaceLost'}));dispose();}});
  ownershipObserver.observe(document.documentElement,{childList:true,subtree:true});
  host.addEventListener('notable-reader-dispose',dispose);
  shadow.querySelector('.closeReader').addEventListener('click',()=>send('setOverlayVisible',false));
  globalThis[key]=controller;
  updateSelectionButton();hits.toggleAttribute('data-active',clickseek.checked);placeBar();refreshNavigation();
  return true;
}


async function call(method, params={}) {
  if(!socket || socket.readyState!==WebSocket.OPEN)throw new Error('Die Verbindung zur PDF-Vorschau ist unterbrochen.');
  const id=++sequence;
  return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Die PDF-Vorschau antwortet nicht.'));},4000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,...(executionContextId===undefined?{}:{contextId:executionContextId})});
  if(result.exceptionDetails)throw new Error('Die Vorlesesteuerung konnte nicht in der PDF-Vorschau angezeigt werden.');
  return result.result?.value;
}
async function detach() {
  if(socket?.readyState===WebSocket.OPEN){
    try{await evaluate(`(()=>{const ui=globalThis[${JSON.stringify(ownerKey)}];if(ui?.owner===${JSON.stringify(binding)})ui.destroy();})()`);}catch{}
    try{await call('Runtime.removeBinding',{name:binding});}catch{}
    socket.close();
  }
  socket=undefined;currentContext=undefined;initialNavigationPages=undefined;executionContextId=undefined;surfaceLost=false;
}
async function attach(context) {
  await detach();
  if(!['pdf','html'].includes(context?.kind)||typeof context.targetId!=='string'||typeof context.url!=='string')return false;
  const targets=await(await fetch(endpoint,{signal:AbortSignal.timeout(4000)})).json();
  const publicUrl=url=>{try{const u=new URL(url);return /^https?:$/.test(u.protocol)?u.origin+u.pathname:null;}catch{return null;}};
  if(context.kind==='html'){
    if(context.viewerTargetId!==null)return false;
    // claude.ai artifacts: the text lives in the sandboxed iframe target, which
    // must be a child of the selected page and on a claudeusercontent.com host.
    const framed=typeof context.frameTargetId==='string';
    const owner=targets.find(t=>t.id===context.targetId&&t.type==='page'&&publicUrl(t.url)===context.url);
    const target=framed?(owner&&artifactFrame(owner,targets)?.id===context.frameTargetId&&publicUrl(targets.find(t=>t.id===context.frameTargetId)?.url)===context.frameUrl?targets.find(t=>t.id===context.frameTargetId):null):owner;
    if(!target?.webSocketDebuggerUrl)return false;
    const nextSocket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{nextSocket.close();reject(new Error('Die Artikelseite antwortet nicht.'));},4000);nextSocket.onopen=()=>{clearTimeout(timer);resolve();};nextSocket.onerror=()=>{clearTimeout(timer);reject(new Error('Die Verbindung zur Artikelseite ist fehlgeschlagen.'));};});
    socket=nextSocket;
    const readerWorlds=new Map();
    nextSocket.onmessage=event=>{
      if(socket!==nextSocket)return;
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(data.method==='Runtime.executionContextCreated'){
        const context=data.params?.context;
        if(context&&Number.isInteger(context.id)&&(context.name===isolatedWorldName||/^__braveReader_[a-f0-9]+$/.test(context.name||'')))readerWorlds.set(context.id,context.auxData?.frameId);
      }else if(data.method==='Runtime.executionContextDestroyed'){readerWorlds.delete(data.params?.executionContextId);if(data.params?.executionContextId===executionContextId)reportSurfaceLost();}
      else if(data.method==='Runtime.executionContextsCleared'){readerWorlds.clear();reportSurfaceLost();}
      if(data.id){const item=pending.get(data.id);if(!item)return;pending.delete(data.id);clearTimeout(item.timer);if(data.error)item.reject(new Error('Die Artikelseite hat die Steuerung abgelehnt.'));else item.resolve(data.result);return;}
      if(data.method==='Runtime.bindingCalled'&&data.params?.name===binding&&data.params.executionContextId===executionContextId){
        let command;try{command=JSON.parse(data.params.payload);}catch{return;}
        if(command.type==='surfaceLost'){reportSurfaceLost();return;}
        if(command.type==='appearanceSystem'){if(typeof command.dark!=='boolean')return;if(currentContext)emit({type:'appearanceSystem',dark:command.dark,context:currentContext});else initialAppearanceSystem=command.dark;return;}
      if(command.type==='appearanceRequest'){if(!Array.isArray(command.pages)||command.pages.length>2||!command.pages.every(n=>Number.isInteger(n)&&n>0)||!Number.isInteger(command.dpi)||command.dpi<72||command.dpi>384)return;const pages=[...new Set(command.pages)];if(currentContext)emit({type:'appearanceRequest',pages,dpi:command.dpi,context:currentContext});else initialAppearancePages={pages,dpi:command.dpi};return;}
      if(command.type==='navigationRequest'){
          if(!Array.isArray(command.pages)||command.pages.length>1000||!command.pages.every(n=>Number.isInteger(n)&&n>0))return;
          const pages=[...new Set(command.pages)];
          if(currentContext)emit({type:'navigationRequest',pages});else initialNavigationPages=pages;
          return;
        }
        if(!['toggle','selection','restart','stop','hide','speed','follow','clickseek','seek','barPosition','language','voice','volume','mute','uiLanguage','previousSection','nextSection','seekProgress','export','cancelExport','seekChapter','seekSection','formatLocale','timeFormat','appearance','toggleTheme','openFocus','exportDocument','playerTheme','autoShow','setOverlayVisible'].includes(command.command))return;
        if(command.command==='uiLanguage'&&!(typeof command.value==='string'&&/^(de|en|fr|es|it|pt)$/.test(command.value)))return;
        if(command.command==='formatLocale'&&!uiLocales.formatLocales.includes(command.value))return;
        if(command.command==='timeFormat'&&!['auto','12h','24h'].includes(command.value))return;
        if(command.command==='playerTheme'&&!['system','light','dark'].includes(command.value))return;
        if(['autoShow','setOverlayVisible'].includes(command.command)&&typeof command.value!=='boolean')return;
        if(command.command==='appearance'&&!validAppearancePatch(command.value))return;
        if(['toggleTheme','openFocus'].includes(command.command)&&command.value!==undefined)return;
        if(command.command==='exportDocument'&&!['pdf','html'].includes(command.value))return;
      if(['seekChapter','seekSection'].includes(command.command)&&(!Number.isSafeInteger(command.value)||command.value<0))return;
      if(command.command==='seekProgress'&&(!Number.isFinite(command.value)||command.value<0||command.value>1))return;
      if(command.command==='export'&&!['mp3','wav'].includes(command.value))return;
      if(['previousSection','nextSection','cancelExport'].includes(command.command)&&command.value!==undefined)return;
      if(command.command==='language'&&!(typeof command.value==='string'&&/^(auto|[a-z]{2}(-[a-z]{2})?)$/.test(command.value)))return;
        if(command.command==='voice'&&!(command.value&&typeof command.value==='object'&&!Array.isArray(command.value)&&Object.keys(command.value).length===2&&typeof command.value.language==='string'&&/^[a-z]{2}(-[a-z]{2})?$/.test(command.value.language)&&typeof command.value.id==='string'&&/^[a-z0-9_:.-]{1,64}$/.test(command.value.id)))return;
        if(command.command==='seek'&&(!Number.isInteger(command.value?.chunkIndex)||command.value.chunkIndex<0||!Number.isInteger(command.value?.charStart)||command.value.charStart<0))return;
        if(command.command==='speed'&&(!Number.isFinite(command.value)||command.value<.8||command.value>4||Math.abs(command.value*20-Math.round(command.value*20))>1e-6))return;
        if(command.command==='volume'&&(!Number.isFinite(command.value)||command.value<0||command.value>150||Math.abs(command.value/5-Math.round(command.value/5))>1e-6))return;
        if(command.command==='mute'&&typeof command.value!=='boolean')return;
        if(['follow','clickseek'].includes(command.command)&&typeof command.value!=='boolean')return;
        if(command.command==='barPosition'&&(!command.value||typeof command.value!=='object'||!Number.isFinite(command.value.x)||!Number.isFinite(command.value.y)||command.value.x<0||command.value.x>1||command.value.y<0||command.value.y>1))return;
        if(currentContext)emit({type:'command',command:command.command,context:currentContext,...(command.value===undefined?{}:{value:command.value})});
      }
    };
    nextSocket.onclose=()=>{if(socket!==nextSocket)return;reportSurfaceLost();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Die Verbindung zur Artikelseite ist unterbrochen.'));}pending.clear();socket=undefined;if(!closed)emit({type:'error',message:'Die Artikelseite wurde geschlossen. Vorlesen bitte neu starten.'});};
    await call('Runtime.enable');await call('Page.enable');
    const {frameTree}=await call('Page.getFrameTree');
    // Legacy companions used a different isolated world on every start. Dispose
    // their retained controller/listeners before removing any orphan DOM hosts.
    for(const [contextId,frameId] of readerWorlds){
      if(frameId!==frameTree.frame.id)continue;
      try{await call('Runtime.evaluate',{expression:`globalThis[${JSON.stringify(ownerKey)}]?.destroy()`,contextId,returnByValue:true});}catch{}
    }
    const world=await call('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:isolatedWorldName});
    if(!Number.isInteger(world.executionContextId))throw new Error('Die geschützte Artikelsteuerung konnte nicht gestartet werden.');
    executionContextId=world.executionContextId;
    await call('Runtime.addBinding',{name:binding,executionContextId});
    const attached=await evaluate(`(${Number.isFinite(context.documentGeneration)?'performance.timeOrigin==='+JSON.stringify(context.documentGeneration)+'&&':''}(${installHtmlInline.toString()})(${JSON.stringify(framed?context.frameUrl:context.url)},${JSON.stringify(binding)},${JSON.stringify(ownerKey)},(${collectHtmlBlocks.toString()}),${framed},{surface:(${mountPlayerSurface.toString()}),formattingFactory:(${createFormatting.toString()}),appearanceFactory:(${createAppearanceController.toString()}),locales:${JSON.stringify(uiLocales)}}))`);
    if(!attached){await detach();return false;}
    currentContext=context;return true;
  }
  if(typeof context.viewerTargetId!=='string')return false;
  const pdfjs=context.renderer==='pdfjs';
  // The adapter is only installed in the explicit parent page selected by capture;
  // native PDF extension targets retain their original parent/id validation.
  if(pdfjs&&context.viewerTargetId!==context.targetId)return false;
  const target=targets.find(t=>t.id===context.viewerTargetId&&(pdfjs?
    t.type==='page'&&t.id===context.targetId&&publicUrl(t.url)===context.url:
    t.parentId===context.targetId&&t.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')));
  if(!target?.webSocketDebuggerUrl)return false;
  const nextSocket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{nextSocket.close();reject(new Error('Die PDF-Vorschau antwortet nicht.'));},4000);nextSocket.onopen=()=>{clearTimeout(timer);resolve();};nextSocket.onerror=()=>{clearTimeout(timer);reject(new Error('Die Verbindung zur PDF-Vorschau ist fehlgeschlagen.'));};});
  socket=nextSocket;
  nextSocket.onmessage=event=>{
    if(socket!==nextSocket)return;
    let data;try{data=JSON.parse(event.data);}catch{return;}
    if(data.method==='Runtime.executionContextsCleared')reportSurfaceLost();
    if(data.id){const item=pending.get(data.id);if(!item)return;pending.delete(data.id);clearTimeout(item.timer);if(data.error)item.reject(new Error('Die PDF-Vorschau hat die Steuerung abgelehnt.'));else item.resolve(data.result);return;}
    if(data.method==='Runtime.bindingCalled'&&data.params?.name===binding){
      let command;try{command=JSON.parse(data.params.payload);}catch{return;}
      if(command.type==='surfaceLost'){reportSurfaceLost();return;}
      if(command.type==='appearanceSystem'){if(typeof command.dark!=='boolean')return;if(currentContext)emit({type:'appearanceSystem',dark:command.dark,context:currentContext});else initialAppearanceSystem=command.dark;return;}
      if(command.type==='appearanceRequest'){if(!Array.isArray(command.pages)||command.pages.length>2||!command.pages.every(n=>Number.isInteger(n)&&n>0)||!Number.isInteger(command.dpi)||command.dpi<72||command.dpi>384)return;const pages=[...new Set(command.pages)];if(currentContext)emit({type:'appearanceRequest',pages,dpi:command.dpi,context:currentContext});else initialAppearancePages={pages,dpi:command.dpi};return;}
      if(command.type==='navigationRequest'){
        if(!Array.isArray(command.pages)||command.pages.length>1000||!command.pages.every(n=>Number.isInteger(n)&&n>0))return;
        const pages=[...new Set(command.pages)];
        if(currentContext)emit({type:'navigationRequest',pages});else initialNavigationPages=pages;
        return;
      }
      if(!['toggle','selection','restart','stop','hide','speed','follow','clickseek','seek','barPosition','language','voice','volume','mute','uiLanguage','previousSection','nextSection','seekProgress','export','cancelExport','seekChapter','seekSection','formatLocale','timeFormat','appearance','toggleTheme','openFocus','exportDocument','playerTheme','autoShow','setOverlayVisible'].includes(command.command))return;
      if(command.command==='uiLanguage'&&!(typeof command.value==='string'&&/^(de|en|fr|es|it|pt)$/.test(command.value)))return;
        if(command.command==='formatLocale'&&!uiLocales.formatLocales.includes(command.value))return;
        if(command.command==='timeFormat'&&!['auto','12h','24h'].includes(command.value))return;
        if(command.command==='playerTheme'&&!['system','light','dark'].includes(command.value))return;
        if(['autoShow','setOverlayVisible'].includes(command.command)&&typeof command.value!=='boolean')return;
        if(command.command==='appearance'&&!validAppearancePatch(command.value))return;
        if(['toggleTheme','openFocus'].includes(command.command)&&command.value!==undefined)return;
        if(command.command==='exportDocument'&&!['pdf','html'].includes(command.value))return;
      if(['seekChapter','seekSection'].includes(command.command)&&(!Number.isSafeInteger(command.value)||command.value<0))return;
      if(command.command==='seekProgress'&&(!Number.isFinite(command.value)||command.value<0||command.value>1))return;
      if(command.command==='export'&&!['mp3','wav'].includes(command.value))return;
      if(['previousSection','nextSection','cancelExport'].includes(command.command)&&command.value!==undefined)return;
      if(command.command==='language'&&!(typeof command.value==='string'&&/^(auto|[a-z]{2}(-[a-z]{2})?)$/.test(command.value)))return;
      if(command.command==='voice'&&!(command.value&&typeof command.value==='object'&&!Array.isArray(command.value)&&Object.keys(command.value).length===2&&typeof command.value.language==='string'&&/^[a-z]{2}(-[a-z]{2})?$/.test(command.value.language)&&typeof command.value.id==='string'&&/^[a-z0-9_:.-]{1,64}$/.test(command.value.id)))return;
      if(command.command==='seek'&&(!Number.isInteger(command.value?.chunkIndex)||command.value.chunkIndex<0||!Number.isInteger(command.value?.charStart)||command.value.charStart<0))return;
      if(command.command==='speed'&&(!Number.isFinite(command.value)||command.value<.8||command.value>4||Math.abs(command.value*20-Math.round(command.value*20))>1e-6))return;
      if(command.command==='volume'&&(!Number.isFinite(command.value)||command.value<0||command.value>150||Math.abs(command.value/5-Math.round(command.value/5))>1e-6))return;
      if(command.command==='mute'&&typeof command.value!=='boolean')return;
      if(['follow','clickseek'].includes(command.command)&&typeof command.value!=='boolean')return;
      if(command.command==='barPosition'&&(!command.value||typeof command.value!=='object'||
        !Number.isFinite(command.value.x)||!Number.isFinite(command.value.y)||
        command.value.x<0||command.value.x>1||command.value.y<0||command.value.y>1))return;
      if(!currentContext)return;
      emit({type:'command',command:command.command,context:currentContext,...(command.value===undefined?{}:{value:command.value})});
    }
  };
  nextSocket.onclose=()=>{if(socket!==nextSocket)return;reportSurfaceLost();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Die Verbindung zur PDF-Vorschau ist unterbrochen.'));}pending.clear();socket=undefined;if(!closed)emit({type:'error',message:'Die PDF-Vorschau wurde geschlossen. Vorlesen bitte neu starten.'});};
  await call('Runtime.enable');await call('Runtime.addBinding',{name:binding});
  const suppliedViewer=pdfjs?`(${createPdfJsAdapter.toString()})(${JSON.stringify(context.url)})`:'undefined';
  const attached=await evaluate(`(${Number.isFinite(context.documentGeneration)?'performance.timeOrigin==='+JSON.stringify(context.documentGeneration)+'&&':''}(${installInline.toString()})(${JSON.stringify(context.url)},${JSON.stringify(binding)},${JSON.stringify(ownerKey)},${suppliedViewer},{surface:(${mountPlayerSurface.toString()}),formattingFactory:(${createFormatting.toString()}),appearanceFactory:(${createAppearanceController.toString()}),locales:${JSON.stringify(uiLocales)}}))`);
  if(!attached){await detach();return false;}
  currentContext=context;return true;
}

let queue=Promise.resolve();
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',line=>{
  queue=queue.then(async()=>{
    let message;try{message=JSON.parse(line);}catch{emit({type:'error',message:'Ungültiger Steuerbefehl für die PDF-Vorschau.'});return;}
    if(message.type==='appearanceChunk'){
      if(typeof message.transferId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(message.transferId)||!Number.isInteger(message.parts)||message.parts<1||message.parts>2048||!Number.isInteger(message.part)||message.part<0||message.part>=message.parts||typeof message.payload!=='string'||message.payload.length>65536)return;
      if(!appearanceTransfer||appearanceTransfer.id!==message.transferId){if(message.part!==0)return;appearanceTransfer={id:message.transferId,parts:message.parts,received:0,bytes:0,values:new Array(message.parts)};}
      if(appearanceTransfer.parts!==message.parts||appearanceTransfer.values[message.part]!==undefined)return;appearanceTransfer.bytes+=Buffer.byteLength(message.payload);if(appearanceTransfer.bytes>64*1024*1024){appearanceTransfer=undefined;return;}appearanceTransfer.values[message.part]=message.payload;appearanceTransfer.received++;if(appearanceTransfer.received!==appearanceTransfer.parts)return;
      const payload=appearanceTransfer.values.join('');appearanceTransfer=undefined;try{message=JSON.parse(payload);}catch{return;}if(message.type!=='appearanceFigures')return;
    }
    if(message.type==='attach'){
      try{const ok=await attach(message.context);const visible=ok?await evaluate(`(()=>{const ui=globalThis[${JSON.stringify(ownerKey)}];return ui?.owner===${JSON.stringify(binding)}&&ui.getActualVisible?.()===true;})()`):false;emit({type:'attached',ok,visible,context:message.context,requestId:message.requestId});if(ok&&initialNavigationPages){emit({type:'navigationRequest',pages:initialNavigationPages});initialNavigationPages=undefined;}if(ok&&initialAppearancePages){emit({type:'appearanceRequest',...initialAppearancePages,context:message.context});initialAppearancePages=undefined;}if(ok&&typeof initialAppearanceSystem==='boolean'){emit({type:'appearanceSystem',dark:initialAppearanceSystem,context:message.context});initialAppearanceSystem=undefined;}}catch{await detach();emit({type:'attached',ok:false,visible:false,context:message.context,requestId:message.requestId});}
    }else if(message.type==='detach'){
      appearanceTransfer=undefined;
      const previous=currentContext;
      const matches=!message.context||!previous||['targetId','viewerTargetId','frameTargetId','kind','url','documentGeneration','renderer','rendererInstance'].every(key=>message.context[key]===previous[key]);
      if(matches)await detach();
      emit({type:'detached',ok:matches,context:previous||message.context,requestId:message.requestId});
    }else if(message.type==='overlayVisibility'){
      if(typeof message.visible!=='boolean'||typeof message.requestId!=='string'||!/^[a-f0-9]{32}$/.test(message.requestId))return;
      const matches=!!socket&&!!currentContext&&!!message.context&&['targetId','viewerTargetId','frameTargetId','kind','url','documentGeneration','renderer','rendererInstance'].every(key=>message.context[key]===currentContext[key]);let actual=false,ok=false;
      try{if(matches){actual=await evaluate(`(()=>{const ui=globalThis[${JSON.stringify(ownerKey)}];if(ui?.owner!==${JSON.stringify(binding)}||typeof ui.setVisibility!=='function')return null;ui.setVisibility(${message.visible});return ui.getActualVisible();})()`);ok=typeof actual==='boolean'&&actual===message.visible;}}catch{}emit({type:'visibilityApplied',visible:actual===true,ok,requestId:message.requestId,context:message.context,sourceGeneration:message.sourceGeneration});
    }else if(message.type==='openFocus'&&socket&&currentContext){
      const manifest=JSON.parse(readFileSync(new URL('./extension/manifest.json',import.meta.url),'utf8')),defaultId=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,n=>String.fromCharCode(97+parseInt(n,16))),id=message.extensionId===undefined?defaultId:message.extensionId;
      if(!['bbobdmpbadoijfffgfeefcenegbbjddd','hgkfghgifkifgmklfgglilnmjglojonm'].includes(id))return;
      await call('Target.createTarget',{url:'chrome-extension://'+id+'/focus.html',background:false});
    }else if(['state','word','clear','navigation','appearanceFigures'].includes(message.type)&&socket&&currentContext){
      // Text is unnecessary for painting. Keep it out of browser evaluation,
      // transport errors, logs and any page-owned diagnostics.
      if(message.type==='appearanceFigures'&&message.context&&!['targetId','viewerTargetId','frameTargetId','kind','url','documentGeneration','renderer','rendererInstance'].every(key=>message.context[key]===currentContext[key]))return;
      const clean=message.type==='appearanceFigures'?{type:'appearanceFigures',appearanceFigures:message.appearanceFigures,appearancePages:message.appearancePages,appearanceRasters:message.appearanceRasters,appearanceLinks:message.appearanceLinks}:message.type==='word'?{type:'word',follow:message.follow,...(message.restore===true?{restore:true}:{}),...(message.preview===true?{preview:true}:{}),word:message.word?{page:message.word.page,bbox:message.word.bbox,pageWidth:message.word.pageWidth,pageHeight:message.word.pageHeight,...(message.word.geometryValid===false?{geometryValid:false}:{}),...(validFocusBBox(message.word)?{focusBBox:message.word.focusBBox}:{} ),...(validParts(message.word)?{parts:message.word.parts}:{})}:null}:message;
      await evaluate(`(()=>{const ui=globalThis[${JSON.stringify(ownerKey)}];if(ui?.owner===${JSON.stringify(binding)})ui.update(${JSON.stringify(clean)});})()`);
    }else if(message.type==='close'){closed=true;await detach();lines.close();process.stdin.pause();}
  }).catch(()=>emit({type:'error',message:'Die Vorlesesteuerung hat die Verbindung zur PDF-Vorschau verloren.'}));
});
lines.on('close',()=>{queue=queue.then(async()=>{closed=true;await detach();});});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{closed=true;detach().finally(()=>process.exit(0));});
