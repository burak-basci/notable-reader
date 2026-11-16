/* beNotable! Reader · explicit, contextual start actions. The source DOM text is
   never wrapped/replaced: all controls live in one isolated overlay portal. */
const COPY={de:{play:'Vorlesen',answer:'Diese Antwort vorlesen',area:'Ziehe einen Rahmen um den gewünschten Text. Esc bricht ab.',ocr:'Ziehe einen Rahmen um den Bildtext. Esc bricht ab.',cancel:'Abbrechen',empty:'In diesem Bereich wurde kein Text gefunden.'},en:{play:'Read aloud',answer:'Read this answer',area:'Drag a box around the text. Esc cancels.',ocr:'Drag a box around the image text. Esc cancels.',cancel:'Cancel',empty:'No text found in this area.'},fr:{play:'Lire',answer:'Lire cette réponse',area:'Encadrez le texte. Échap pour annuler.',ocr:'Encadrez le texte de l’image. Échap pour annuler.',cancel:'Annuler',empty:'Aucun texte dans cette zone.'},es:{play:'Leer',answer:'Leer esta respuesta',area:'Dibuja un marco alrededor del texto. Esc cancela.',ocr:'Dibuja un marco alrededor del texto de la imagen. Esc cancela.',cancel:'Cancelar',empty:'No se encontró texto en esta área.'},it:{play:'Leggi',answer:'Leggi questa risposta',area:'Traccia un riquadro intorno al testo. Esc annulla.',ocr:'Traccia un riquadro intorno al testo dell’immagine. Esc annulla.',cancel:'Annulla',empty:'Nessun testo in quest’area.'},pt:{play:'Ler',answer:'Ler esta resposta',area:'Desenha um retângulo à volta do texto. Esc cancela.',ocr:'Desenha um retângulo à volta do texto da imagem. Esc cancela.',cancel:'Cancelar',empty:'Nenhum texto nesta área.'}};
const editable=el=>!!el?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!el.closest('[aria-hidden="true"],nav,header,footer,button,input,textarea,[contenteditable="true"]');};
export function installQuickActions({document:doc=globalThis.document,onRead=()=>{},onArea=()=>{},language='en',enabled=true,selection=true,answers=true}={}){
 const win=doc.defaultView;let alive=true,active=enabled,area=null,selectionRange=null,frame=0,scanTimer=0;const cleanups=[],anchors=new Map();
 const lang=()=>typeof language==='function'?language():language;
 const t=k=>(COPY[lang()]||COPY.en)[k];
 const answerLabel=()=>/chatgpt\.com$|chat\.openai\.com$|claude\.ai$|gemini\.google\.com$/.test(win.location.hostname)?t('answer'):t('play');
 const host=doc.createElement('div');host.dataset.notableQuickActions='';host.style.cssText='all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646';
 const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>:host{all:initial}*{box-sizing:border-box}.play{position:fixed;display:flex;align-items:center;gap:5px;min-height:32px;padding:6px 11px;border:1px solid #256249;border-radius:18px;background:#fff;color:#20573f;font:600 12px/1.3 system-ui,sans-serif;box-shadow:0 2px 10px #0002;cursor:pointer;pointer-events:auto}.play:hover{background:#eff7f1}.play:focus-visible,.cancel:focus-visible{outline:3px solid #72ad8b;outline-offset:3px}[hidden]{display:none!important}.selection{background:#256249;color:#fff}.selection:hover{background:#194f36}.screen{position:fixed;inset:0;background:#163a240a;pointer-events:auto;cursor:crosshair;touch-action:none}.box{position:fixed;border:2px solid #256249;background:#45815f22;pointer-events:none}.hint{position:fixed;top:18px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);display:flex;align-items:center;gap:16px;padding:12px 16px;border:1px solid #aac5b2;border-radius:12px;background:#fff;color:#172f21;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 24px #0002;pointer-events:auto}.cancel{min-height:32px;padding:5px 10px;border:1px solid #b6c7bb;border-radius:7px;background:#fff;color:#20573f;cursor:pointer}@media(prefers-reduced-motion:reduce){*{transition:none}}</style>';
 const bubble=doc.createElement('button');bubble.type='button';bubble.className='play selection';bubble.hidden=true;shadow.append(bubble);doc.documentElement.append(host);
 const listen=(target,type,fn,opts)=>{target.addEventListener(type,fn,opts);cleanups.push(()=>target.removeEventListener(type,fn,opts));};
 const announce=()=>{bubble.textContent='▶ '+t('play');bubble.setAttribute('aria-label',t('play'));for(const button of anchors.values()){button.textContent='▶';button.title=answerLabel();button.setAttribute('aria-label',answerLabel());}};
 const guarded=(fn,payload)=>{try{Promise.resolve(fn(payload)).catch(()=>{});}catch{}};
 function updateSelection(){
  if(!alive||!active||!selection||area||editable(doc.activeElement)){bubble.hidden=true;return;}
  const sel=doc.getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount||sel.toString().trim().length<2||sel.toString().length>100000){bubble.hidden=true;return;}
  const range=sel.getRangeAt(0),parent=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
  if(!parent||host.contains(parent)||editable(parent)){bubble.hidden=true;return;}
  const rect=range.getBoundingClientRect();if(!rect.width&&!rect.height){bubble.hidden=true;return;}
  selectionRange=range.cloneRange();bubble.hidden=false;const left=Math.max(8,Math.min(win.innerWidth-150,rect.right-12)),top=rect.bottom+8<win.innerHeight-44?rect.bottom+8:Math.max(8,rect.top-42);bubble.style.left=left+'px';bubble.style.top=top+'px';
 }
 listen(bubble,'pointerdown',e=>e.preventDefault());listen(bubble,'click',e=>{if(!e.isTrusted)return;e.preventDefault();e.stopPropagation();const range=selectionRange?.cloneRange();if(!range)return;bubble.hidden=true;guarded(onRead,{kind:'selection',range,ranges:[range],text:range.toString()});});
 // Enough text for a button, decided from the first text nodes: innerText laid out and copied every whole answer
 // (a full chat) after each burst of mutations.
 function hasText(el,min){
  const walker=doc.createTreeWalker(el,NodeFilter.SHOW_TEXT);let count=0;
  for(let node=walker.nextNode();node;node=walker.nextNode()){count+=node.data.trim().length;if(count>=min)return true;}
  return false;
 }
 function candidates(){
  const hostName=win.location.hostname;
  const selectors=/chatgpt\.com$|chat\.openai\.com$/.test(hostName)?'[data-message-author-role="assistant"]':/claude\.ai$/.test(hostName)?'[data-is-streaming],.font-claude-response,[data-testid="assistant-message"]':/gemini\.google\.com$/.test(hostName)?'model-response,.model-response-text':'article,[data-reader-answer],[role="article"]';
  const all=[...doc.querySelectorAll(selectors)].filter(el=>!host.contains(el)&&!editable(el)&&hasText(el,40));
  return all.filter(el=>!all.some(other=>other!==el&&el.contains(other))).slice(0,40);
 }
 function place(){
  frame=0;if(!alive)return;
  for(const [el,button]of anchors){const r=el.getBoundingClientRect();button.hidden=!active||!!area||!el.isConnected||!visible(el)||r.bottom<0||r.top>win.innerHeight;button.style.left=Math.max(8,Math.min(win.innerWidth-42,r.right-34))+'px';button.style.top=Math.max(5,r.top+3)+'px';}
  if(!area)updateSelection();
 }
 function schedule(){if(!frame)frame=win.requestAnimationFrame(place);}
 function refresh(){
  if(!alive)return;const elements=answers&&active?candidates():[];
  for(const [el,b]of anchors)if(!elements.includes(el)){b.remove();anchors.delete(el);}
  for(const el of elements)if(!anchors.has(el)){
   const b=doc.createElement('button');b.type='button';b.className='play answer';b.dataset.notableAnswer='';b.textContent='▶';b.title=answerLabel();b.setAttribute('aria-label',answerLabel());
   b.addEventListener('click',e=>{if(!e.isTrusted)return;e.preventDefault();e.stopPropagation();if(!el.isConnected)return;const range=doc.createRange();range.selectNodeContents(el);guarded(onRead,{kind:'element',element:el,range,ranges:[range],text:range.toString()});});shadow.append(b);anchors.set(el,b);
  }announce();schedule();
 }
 const observer=new win.MutationObserver(records=>{if(!records.some(r=>r.target!==host&&!host.contains(r.target)))return;clearTimeout(scanTimer);scanTimer=win.setTimeout(refresh,250);});observer.observe(doc.documentElement,{subtree:true,childList:true,characterData:true});
 listen(doc,'selectionchange',schedule);listen(win,'scroll',schedule,{capture:true,passive:true});listen(win,'resize',schedule,{passive:true});
 function cancelArea(){if(!area)return;area.screen.remove();area.box.remove();area.hint.remove();area=null;schedule();}
 function startAreaSelection({mode='text'}={}){
  if(!alive)return false;cancelArea();bubble.hidden=true;
  const screen=doc.createElement('div'),box=doc.createElement('div'),hint=doc.createElement('div'),label=doc.createElement('span'),cancel=doc.createElement('button');screen.className='screen';screen.tabIndex=-1;box.className='box';box.hidden=true;hint.className='hint';label.textContent=t(mode==='ocr'?'ocr':'area');cancel.type='button';cancel.className='cancel';cancel.textContent=t('cancel');hint.append(label,cancel);shadow.append(screen,box,hint);area={screen,box,hint,start:null,mode};cancel.addEventListener('click',cancelArea);screen.focus({preventScroll:true});
  const coords=e=>({x:Math.max(0,Math.min(win.innerWidth,e.clientX)),y:Math.max(0,Math.min(win.innerHeight,e.clientY))});
  const rectAt=e=>{const p=coords(e),s=area.start;return{left:Math.min(s.x,p.x),top:Math.min(s.y,p.y),right:Math.max(s.x,p.x),bottom:Math.max(s.y,p.y),width:Math.abs(p.x-s.x),height:Math.abs(p.y-s.y)};};
  screen.addEventListener('pointerdown',e=>{if(!e.isTrusted||e.button!==0)return;e.preventDefault();area.start=coords(e);screen.setPointerCapture?.(e.pointerId);box.hidden=false;});
  screen.addEventListener('pointermove',e=>{if(!area?.start)return;const r=rectAt(e);Object.assign(box.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});});
  screen.addEventListener('pointerup',e=>{if(!e.isTrusted||!area?.start)return;e.preventDefault();const rect=rectAt(e),currentMode=area.mode;cancelArea();if(rect.width<8||rect.height<8)return;
   const blocks=[...doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,[data-reader-block]')].filter(el=>visible(el)&&!editable(el)&&(el.innerText||'').trim()&&intersects(rect,el.getBoundingClientRect()));
   const elements=blocks.filter(el=>!blocks.some(other=>other!==el&&el.contains(other))).slice(0,1000),ranges=elements.map(el=>{const r=doc.createRange();r.selectNodeContents(el);return r;});
   guarded(onArea,{mode:currentMode,rect,elements,ranges,text:ranges.map(r=>r.toString()).join('\n\n')});
  });screen.addEventListener('pointercancel',cancelArea);schedule();return true;
 }
 listen(doc,'keydown',e=>{if(area&&e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelArea();}},{capture:true});
 announce();refresh();return{startAreaSelection,cancelAreaSelection:cancelArea,refresh,setEnabled(value){active=value===true;if(!active)cancelArea();refresh();},destroy(){if(!alive)return;alive=false;cancelArea();observer.disconnect();for(const off of cleanups)off();clearTimeout(scanTimer);win.cancelAnimationFrame(frame);anchors.clear();host.remove();}};
}
