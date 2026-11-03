/* Notable Reader · Copyright (c) 2026 Burak Basci · MIT */
(async()=>{
  'use strict';
  const previous=document.getElementById('notable-reader-panel');
  if(previous?.dataset.notableReader==='2'){previous.dispatchEvent(new Event('notable-close'));}
  const selection=String(getSelection()||'').trim();
  let text=selection,title=selection?'Markierter Text':document.title;
  function readableBlockText(html){
    // Template content stays inert and is never adopted into the live page.
    // Only its plain text reaches the reader's textContent-rendered spans.
    const template=document.createElement('template');template.innerHTML=String(html||'');
    template.content.querySelectorAll('script,style,noscript,iframe,object,embed,svg,math,canvas,audio,video,img,link,meta,base,form').forEach(node=>node.remove());
    template.content.querySelectorAll('br,hr,p,div,section,article,h1,h2,h3,h4,h5,h6,li,tr,td,th,blockquote,pre').forEach(node=>{node.before(document.createTextNode('\n'));node.after(document.createTextNode('\n'));});
    return template.content.textContent;
  }
  if(!text){
    const clone=document.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,nav,header,footer,aside,[hidden],[aria-hidden="true"],sup a[href*="#"],a[role="doc-noteref"]').forEach(node=>node.remove());
    try{const article=new Readability(clone,{charThreshold:80}).parse();text=article?readableBlockText(article.content):'';title=article?.title||title;}catch{}
    if(!text.trim()){
      const roots=[...document.querySelectorAll('article,main,[role="main"]')].filter(node=>node.getClientRects().length);
      roots.sort((a,b)=>(b.innerText?.length||0)-(a.innerText?.length||0));
      text=(roots[0]||document.body).innerText||'';
    }
  }
  const {Reader,fingerprint}=globalThis.NotableReaderCore;
  const host=document.createElement('div');host.id='notable-reader-panel';host.dataset.notableReader='2';
  host.style.cssText='all:initial;position:fixed;bottom:18px;right:18px;z-index:2147483647;max-width:calc(100vw - 24px);';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>:host{all:initial}*{box-sizing:border-box}.panel{font:14px/1.55 system-ui,-apple-system,sans-serif!important;color:#263a30;background:#fff;border:1px solid #bdcfc1;box-shadow:0 8px 40px #0003;border-radius:18px;width:390px;max-width:calc(100vw - 24px);padding:16px}header{display:flex;gap:10px;align-items:center}strong{font-size:15px;letter-spacing:-.02em}button,select,input{font:inherit}button{min-height:40px;min-width:40px;border:1px solid #cdd9d0;border-radius:10px;background:#f7f9f6;color:inherit;padding:8px 12px;cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid #dd9600;outline-offset:2px}.primary{background:#145c4c;color:white;border-color:#145c4c;flex:1}.close{margin-left:auto}.controls{display:flex;gap:7px;margin-top:13px}p{margin:9px 0;font-size:12px;color:#586b60}.status{min-height:19px}.error{color:#9b2424}.title{max-height:45px;overflow:hidden;font-size:12px;color:#586b60}label{display:block;margin-top:10px;font-size:12px}select{border:1px solid #cdd9d0;border-radius:8px;padding:8px;max-width:100%;width:100%;min-height:40px;background:white;color:#263a30}input[type=range]{width:100%;accent-color:#145c4c}input[type=checkbox]{accent-color:#145c4c}summary{cursor:pointer;padding:7px 0;font-size:12px}.text{white-space:pre-wrap;line-height:1.8;max-height:38vh;overflow:auto;border-top:1px solid #dbe4dd;margin-top:8px;padding-top:12px;font-size:15px}.sentence{cursor:pointer;border-radius:3px}.sentence:hover{background:#eef5ee}.sentence.active{background:#e3edb4;color:#263313}.text::highlight(notable-word){background:#d0df77;color:#263313}a{color:#145c4c;text-underline-offset:2px}.foot{display:flex;gap:12px;justify-content:space-between;font-size:11px;margin-top:12px}.settings{max-height:42vh;overflow:auto}.note{font-size:11px}.hint{font-size:11px}.reset{width:100%;font-size:12px;margin-top:10px}@media(max-width:430px){.panel{width:calc(100vw - 24px);padding:13px}}@media(prefers-color-scheme:dark){.panel{background:#202c25;color:#e0e9e2;border-color:#53685a}button,select{background:#2b3a30;color:#e0e9e2;border-color:#53685a}.primary{background:#95d8b6;color:#142a1f}p,.title{color:#b0c0b4}a{color:#95d8b6}.error{color:#ffb2aa}.sentence:hover{background:#3e5142}}</style><section class="panel" aria-label="Notable Reader"><header><strong>Notable Reader</strong><button class="close" aria-label="Vorleseleiste schließen">×</button></header><div class="title"></div><div class="controls"><button class="previous" aria-label="Vorheriger Abschnitt">←</button><button class="play primary">Vorlesen</button><button class="next" aria-label="Nächster Abschnitt">→</button><button class="stop" aria-label="Vorlesen stoppen">■</button></div><p class="status" role="status" aria-live="polite"></p><button class="local-ai" style="width:100%;margin-top:10px">Lokale KI-Stimme öffnen</button><details class="settings"><summary>Stimme & Tempo</summary><label>Stimme<select class="voice"></select></label><label><input type="checkbox" class="online"> Auch Online-Stimmen anbieten</label><p class="note"></p><label>Tempo <output class="speed-value">1,00×</output><input class="speed" aria-label="Lesetempo" type="range" min="0.8" max="4" step="0.05" value="1"></label><label>Lautstärke <input class="volume" aria-label="Lautstärke" type="range" min="0" max="1" step="0.05" value="1"></label><button class="reset">Einstellungen & Lesestellen löschen</button></details><details class="text-detail"><summary>Lesetext & Sprung zur Textstelle</summary><div class="text" aria-label="Lesetext"></div><p class="hint">Abschnitt anklicken, dann mit „Vorlesen“ starten.</p></details><div class="foot"><a href="https://reader.benotable.de/app/" target="_blank" rel="noopener noreferrer">PDF oder Text öffnen ↗</a><a href="https://buy.stripe.com/cNi7sM72dbaU3w6eY7aVa00" target="_blank" rel="noopener noreferrer">Unterstützen ↗</a></div></section>`;
  const $=selector=>shadow.querySelector(selector), configKey='notableReaderV2';
  const defaults={rate:1,volume:1,voice:'',online:false,positions:{}};
  let config={...defaults},disposed=false,active=null,spans=[],docHash='';
  try{config={...defaults,...(await chrome.storage.local.get(configKey))[configKey]};}catch{}
  config.positions=config.positions&&typeof config.positions==='object'&&!Array.isArray(config.positions)?config.positions:{};
  config.online=config.online===true;
  const save=()=>{config.positions=Object.fromEntries(Object.entries(config.positions).slice(-100));chrome.storage.local.set({[configKey]:config}).catch(()=>{});};
  const showStatus=(message,error=false)=>{$('.status').textContent=message;$('.status').classList.toggle('error',error);};
  const reader=new Reader({
    onstate({state,index,count,error}){
      $('.play').textContent=state==='playing'?'Pause':state==='paused'?'Weiterlesen':state==='ended'?'Noch einmal':'Vorlesen';
      $('.play').setAttribute('aria-pressed',String(state==='playing'));
      $('.play').disabled=!count;$('.previous').disabled=!count||index===0;$('.next').disabled=!count||index>=count-1;$('.stop').disabled=!count;
      showStatus(error||`${state==='playing'?'Liest':state==='paused'?'Pausiert':state==='ended'?'Fertig':'Bereit'} · ${count?index+1:0}/${count} Abschnitte`,!!error);
    },
    onposition(index){if(docHash){config.positions[docHash]=index;save();}},
    onword({start,end,sentence}){
      active?.classList.remove('active');active=spans[sentence];active?.classList.add('active');
      if($('.text-detail').open&&active){const root=$('.text'),offset=active.offsetTop-root.offsetTop;if(offset<root.scrollTop||offset>root.scrollTop+root.clientHeight-40)root.scrollTop=Math.max(0,offset-80);}
      // Sentence highlighting is guaranteed. Word events vary by installed voice.
    }
  });
  reader.load(text);docHash=fingerprint(reader.text);reader.seek(Number(config.positions[docHash])||0);
  $('.title').textContent=title;
  let cursor=0;
  reader.chunks.forEach((chunk,index)=>{const span=document.createElement('span');span.className='sentence';span.tabIndex=0;span.setAttribute('role','button');span.setAttribute('aria-label',`Abschnitt ${index+1}`);span.textContent=chunk.text;span.addEventListener('click',()=>reader.seek(index));span.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();reader.seek(index);}});$('.text').append(document.createTextNode(reader.text.slice(cursor,chunk.start)),span);spans.push(span);cursor=chunk.end;});
  $('.text').append(document.createTextNode(reader.text.slice(cursor)));
  function refreshVoices(){
    const voices=(speechSynthesis?.getVoices()||[]).filter(voice=>config.online||voice.localService===true),lang=document.documentElement.lang?.split('-')[0]||navigator.language?.split('-')[0];
    const select=$('.voice');select.replaceChildren();
    voices.sort((a,b)=>Number(b.lang.startsWith(lang))-Number(a.lang.startsWith(lang))||a.name.localeCompare(b.name));
    for(const voice of voices)select.add(new Option(`${voice.name} · ${voice.lang}${voice.localService?' · lokal':' · online'}`,voice.voiceURI));
    const chosen=voices.find(voice=>voice.voiceURI===config.voice)||voices[0]||null;
    if(!chosen)select.add(new Option('Keine passende Stimme verfügbar',''));
    else select.value=chosen.voiceURI;
    reader.configure({voice:chosen,rate:config.rate,volume:config.volume});
    $('.note').textContent=!chosen?'Keine Systemstimme gefunden. Mit „Lokale KI-Stimme öffnen“ kannst du kostenlos eine lokale DE/EN-Stimme laden. Alternativ eine Systemstimme installieren oder Online-Stimmen bewusst aktivieren.':chosen.localService?'Vom Browser als lokal gemeldete Stimme. Kein Textupload zu Notable Reader.':'Online-Stimme: Text kann an den Anbieter der Stimme übertragen werden.';
  }
  $('.local-ai').addEventListener('click',async()=>{reader.pause();showStatus('Artikel wird ausschließlich lokal im Reader geöffnet …');try{const result=await chrome.runtime.sendMessage({action:'open-local-reader',text:reader.text,title,language:document.documentElement.lang||''});if(!result?.ok)throw Error('open');showStatus('Artikel ist in der eigenen Reader-Seite geöffnet.');}catch{showStatus('Der lokale Reader konnte nicht geöffnet werden. Bitte die Erweiterung erneut öffnen.',true);}});
  $('.play').addEventListener('click',()=>reader.toggle());$('.previous').addEventListener('click',()=>reader.seek(reader.index-1));$('.next').addEventListener('click',()=>reader.seek(reader.index+1));$('.stop').addEventListener('click',()=>{reader.stop();reader.seek(0);});
  $('.speed').value=config.rate;$('.volume').value=config.volume;$('.online').checked=config.online;$('.speed-value').textContent=`${Number(config.rate).toLocaleString('de-DE',{minimumFractionDigits:2})}×`;
  $('.speed').addEventListener('input',()=>{config.rate=Number($('.speed').value);$('.speed-value').textContent=`${config.rate.toLocaleString('de-DE',{minimumFractionDigits:2})}×`;reader.configure({rate:config.rate});save();});
  $('.volume').addEventListener('input',()=>{config.volume=Number($('.volume').value);reader.configure({volume:config.volume});save();});
  $('.voice').addEventListener('change',()=>{config.voice=$('.voice').value;refreshVoices();save();});$('.online').addEventListener('change',()=>{config.online=$('.online').checked;config.voice='';refreshVoices();save();});
  $('.reset').addEventListener('click',async()=>{reader.stop();await chrome.storage.local.remove(configKey);config={...defaults,positions:{}};docHash='';$('.speed').value=1;$('.volume').value=1;$('.speed-value').textContent='1,00×';$('.online').checked=false;refreshVoices();showStatus('Einstellungen und Lesestellen gelöscht.');});
  function close(){if(disposed)return;disposed=true;reader.stop();speechSynthesis?.removeEventListener('voiceschanged',refreshVoices);window.removeEventListener('pagehide',close);host.remove();}
  $('.close').addEventListener('click',close);host.addEventListener('notable-close',close);window.addEventListener('pagehide',close);
  speechSynthesis?.addEventListener('voiceschanged',refreshVoices);refreshVoices();
  document.documentElement.append(host);
  if(!reader.chunks.length)showStatus('Keine lesbare Textstelle gefunden. Markiere einen Text oder öffne PDF & Text.',true);
})();
