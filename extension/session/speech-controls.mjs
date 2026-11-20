// The original tempo dialog and FX rows, shared by the document surface and settings-only adapters.
// Self-contained factory: native bridge injects this exact function into its serialized closure.
export function createSpeechControls(){
  const FX_ROWS = Object.freeze({
    pitch: {min: -6, max: 6, step: 0.5, def: 0, label: 'fxPitch', hint: 'fxPitchHint'},
    bass: {min: -10, max: 10, step: 1, def: 0, label: 'fxBass'},
    treble: {min: -10, max: 10, step: 1, def: 0, label: 'fxTreble'},
    commaPause: {min: 0, max: 3000, step: 50, def: 0, label: 'commaPause'},
    sentencePause: {min: 0, max: 3000, step: 50, def: 0, label: 'sentencePause'},
    paragraphPause: {min: 0, max: 3000, step: 50, def: 0, label: 'paragraphPause'},
    sectionPause: {min: 0, max: 3000, step: 100, def: 0, label: 'sectionPauseShort', full: 'sectionPause', hint: 'sectionPauseHint'},
  });
  const FX_CSS = `
    .vol-pop.has-fx,.speed-pop.has-fx{flex-wrap:wrap;row-gap:4px;width:min(320px,calc(100vw - 24px))!important;box-sizing:border-box;}
    .fx-sep{flex:0 0 100%;height:1px;margin:2px 0;background:var(--reader-line);}
    .fx-title{flex:0 0 100%;min-width:0;font-size:10px;font-weight:600;line-height:1.4;letter-spacing:.07em;text-transform:uppercase;color:var(--reader-muted);white-space:normal;overflow-wrap:anywhere;}
    /* one grid per popover: label left, slider in the middle, value right; each .fx-row is display:contents so all rows share the same columns */
    .fx-grid{flex:0 0 100%;display:grid;grid-template-columns:var(--fx-label,68px) minmax(0,1fr) var(--fx-out,54px);align-items:center;gap:2px 8px;min-width:0;}
    .fx-row{display:contents;}
    .fx-label{min-width:0;font-size:11.5px;font-weight:400;line-height:1.4;color:var(--reader-ink);white-space:normal;overflow-wrap:anywhere;}
    .fx-foot{flex:0 0 100%;display:flex;justify-content:flex-end;}
    .fx-reset-all{flex:none;min-height:24px;padding:0 4px;border:0;border-radius:4px;background:transparent;font-size:11px;line-height:1.3;color:var(--reader-muted);text-decoration:underline;text-underline-offset:2px;cursor:pointer;}
    .fx-reset-all:hover:not(:disabled){color:var(--reader-ink);background:var(--reader-soft);}
    .fx-reset-all:disabled{opacity:.4;cursor:default;text-decoration:none;}
    .fx-reset-all:focus-visible{outline:2px solid var(--reader-accent);outline-offset:1px;}
    .speed-range.fx-range{width:100%;min-width:0;margin:0;}
    .fx-out{min-width:0;text-align:right;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--reader-muted);}
    /* fixed label column left, slider takes the rest, short fixed value column right; the main row (mute / 1x button, main slider, value) uses the same columns so all sliders line up */
    .vol-pop.has-fx{--fx-label:68px;--fx-out:78px;padding-left:12px;}
    .speed-pop.has-fx{--fx-label:108px;--fx-out:68px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding-left:12px;width:min(380px,calc(100vw - 24px))!important;}
    .vol-pop.has-fx .vol-mute,.speed-pop.has-fx .speed-reset{flex:0 0 var(--fx-label);width:var(--fx-label);min-width:0;box-sizing:border-box;}
    .vol-pop.has-fx .vol-out,.speed-pop.has-fx .speed-out{flex:0 0 var(--fx-out);min-width:0;width:var(--fx-out);}
    .vol-pop.has-fx .vol-range,.speed-pop.has-fx .speed-range:not(.fx-range){flex:1 1 0;}
  `;

  function createFxRows({doc = document, send, uiText, formatNumber = String, rows = FX_ROWS, idPrefix = 'reader-fx-'}) {
    const state = {}, choice = {}, timers = {}, nodes = {}, resetButtons = [], soundKeys = ['pitch','bass','treble'].filter(k=>k in rows), pauseKeys=Object.keys(rows).filter(k=>k.endsWith('Pause'));
    const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + formatNumber(Math.abs(Math.round(v * 10) / 10));
    /* visible value uses unit abbreviations (dB / s) so the sliders get the room; pitch says "semitones" in full because "st" is not
       understood; the long form also goes into tooltip + aria-valuetext */
    const show = (key, v, long = false) => key === 'pitch' ? signed(v) + ' ' + uiText(Math.abs(v) === 1 ? 'fxUnitSemitoneOne' : 'fxUnitSemitone') : key.endsWith('Pause') ? (v === 0 ? uiText('sectionPauseNone').replace(/^./u, c => c.toLocaleUpperCase()) : formatNumber(v / 1000) + ' ' + uiText(long ? 'fxUnitSecLong' : 'fxUnitSecAbbr')) : signed(v) + ' ' + uiText(long ? 'fxUnitDbLong' : 'fxUnitDbAbbr');
    const current = key => choice[key] ?? state[key] ?? rows[key].def;
    const paint = (key, v) => {
      const spec = rows[key], n = nodes[key], text = show(key, v), longText = show(key, v, true), name = uiText(spec.label);
      n.out.textContent = text; n.out.title = longText; n.range.style.setProperty('--vv', String((v - spec.min) / (spec.max - spec.min))); n.range.style.setProperty('--vp', String((spec.def - spec.min) / (spec.max - spec.min)));
      n.range.setAttribute('aria-valuetext', longText); n.range.setAttribute('aria-label', name); n.label.textContent = name;
      if (spec.full) n.range.setAttribute('aria-description', uiText(spec.full));
      if (spec.hint) n.label.title = n.range.title = uiText(spec.hint);
      for (const b of resetButtons) b.disabled = b.keys.every(k => Math.abs((k === key ? v : current(k)) - rows[k].def) < 1e-9);
    };
    const render = () => { for (const key of Object.keys(rows)) { const v = current(key), n = nodes[key]; if (!n.dragging && !n.dirty && Number(n.range.value) !== v) n.range.value = String(v); paint(key, n.dragging || n.dirty ? Number(n.range.value) : v); } };
    const commit = (key, v) => {
      const spec = rows[key]; v = Math.max(spec.min, Math.min(spec.max, Math.round(v / spec.step) * spec.step)); v = Math.round(v * 1000) / 1000;
      choice[key] = v; clearTimeout(timers[key]); timers[key] = setTimeout(() => { delete choice[key]; render(); }, 6000);
      nodes[key].dirty=false;paint(key, v); nodes[key].range.value = String(v); send(key, v);
    };
    const build = key => {
      const spec = rows[key], row = doc.createElement('div'); row.className = 'fx-row'; row.dataset.fx = key;
      const label = doc.createElement('label'), out = doc.createElement('output'), range = doc.createElement('input');
      label.className = 'fx-label'; out.className = 'fx-out'; out.setAttribute('aria-hidden', 'true');
      out.setAttribute('aria-live', 'off');
      range.type = 'range'; range.className = 'speed-range fx-range'; range.min = String(spec.min); range.max = String(spec.max); range.step = String(spec.step); range.value = String(spec.def); range.id = idPrefix + key; label.htmlFor = range.id;
      row.append(label, range, out);
      const node = nodes[key] = {row, label, out, range, dragging: false, dirty:false};
      range.addEventListener('pointerdown', () => { node.dragging = true; });
      const end = () => { node.dragging = false; },cancel=()=>{node.dragging=false;node.dirty=false;render();};
      doc.addEventListener('pointerup', end, true); doc.addEventListener('pointercancel', cancel, true);
      range.addEventListener('input', () => {node.dirty=true;paint(key, Number(range.value));});
      range.addEventListener('change', () => {node.dirty=false;commit(key, Number(range.value));});
      range.addEventListener('dblclick', () => commit(key, spec.def));
      node.dispose = () => { doc.removeEventListener('pointerup', end, true); doc.removeEventListener('pointercancel', cancel, true); clearTimeout(timers[key]); };
      return row;
    };
    const sep = () => { const s = doc.createElement('div'); s.className = 'fx-sep'; s.setAttribute('role', 'separator'); return s; };
    /* The original reset links keep sound and pause options independent; tempo retains its own 1x reset. */
    const resetGroup = keys => { for (const key of keys) if (Math.abs(current(key) - rows[key].def) > 1e-9) commit(key, rows[key].def); };
    const resetAll = () => resetGroup(soundKeys);
    const foot = (keys, labelKey) => { const wrap = doc.createElement('div'), b = doc.createElement('button'); wrap.className = 'fx-foot'; b.type = 'button'; b.className = 'fx-reset-all'; b.keys = keys; b.labelKey = labelKey; b.addEventListener('click', () => { const focused = b.matches(':focus'); resetGroup(keys); if (focused && b.disabled) nodes[keys[0]]?.range.focus({preventScroll: true}); /* the link disables itself at the defaults: the focus moves to the group's first slider instead of getting lost */ }); wrap.append(b); resetButtons.push(b); return wrap; };
    const grid = (...keys) => { const g = doc.createElement('div'); g.className = 'fx-grid'; g.append(...keys.map(build)); return g; };
    const title = () => { const h = doc.createElement('div'); h.className = 'fx-title'; return h; };
    const volumeTitle = title(), speedTitle = title();
    const soundTitle=title(),pauseTitle=title();
    const soundRows=[sep(),grid(...soundKeys),foot(soundKeys,'fxResetSound')];
    const pauseRows=[sep(),pauseTitle,grid(...pauseKeys),foot(pauseKeys,'fxResetPauses')];
    const speedRows=pauseRows,volumeRows=soundRows;
    const refreshLocale = () => { volumeTitle.textContent = uiText('fxSound'); soundTitle.textContent=uiText('fxSound');pauseTitle.textContent=uiText('extraPauses'); speedTitle.textContent = uiText('speed'); for (const b of resetButtons) b.textContent = uiText(b.labelKey); render(); };
    refreshLocale();
    return {
      volumeRows, pauseRows, speedRows, volumeTitle, speedTitle, refreshLocale, nodes, resetAll,
      update(message) {
        for (const key of Object.keys(rows)) {
          const raw=key==='sectionPause'?message?.[key]:message?.reading?.[key]??message?.[key];const v = typeof raw==='number'?raw:NaN; if (!Number.isFinite(v)) continue;
          state[key] = v; if (choice[key] !== undefined && Math.abs(choice[key] - v) < 1e-9) { delete choice[key]; clearTimeout(timers[key]); }
        }
        render();
      },
      dispose() { for (const n of Object.values(nodes)) n.dispose(); },
    };
  }

  function createSoundControls({wrap,send,uiText,formatNumber=String,icon=null,anchorPanel,fxUi,doc=wrap.ownerDocument,settingsToggle=null,onOpen=()=>{},onPlace=null,showValue=false,wheelStep=!showValue}){
    const document=doc,disposers=[],listen=(node,type,fn,options)=>{node.addEventListener(type,fn,options);disposers.push(()=>node.removeEventListener(type,fn,options));};
    icon||=(name=>{const paths={vol0:'<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>',vol1:'<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9.5a4 4 0 0 1 0 5"/>',vol2:'<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9.5a4 4 0 0 1 0 5M19 7a8 8 0 0 1 0 10"/>'};return '<svg aria-hidden="true" viewBox="0 0 24 24">'+paths[name]+'</svg>';});
    wrap.classList.add('vol','reader-speech-controls');wrap.innerHTML='<button class="vol-btn" type="button" disabled aria-haspopup="true" aria-expanded="false">'+icon('vol2')+'</button><div class="vol-pop reader-speech-panel has-fx" role="group"><button class="vol-mute" type="button" aria-pressed="false">'+icon('vol2')+'</button><input class="vol-range" type="range" min="0" max="150" step="5" value="100"><output class="vol-out" aria-hidden="true" aria-live="off">100 %</output></div>';
    const btn=wrap.querySelector('.vol-btn'),pop=wrap.querySelector('.vol-pop'),muteBtn=pop.querySelector('.vol-mute'),range=pop.querySelector('.vol-range'),out=pop.querySelector('.vol-out');
    // showValue (Settings): the same button reads icon + value + chevron like the speed and voice triggers there; the bar keeps the icon-only button.
    if(showValue){btn.classList.add('reader-speech-trigger','vol-trigger');btn.innerHTML='<span class="vol-icon">'+icon('vol2')+'</span><span class="reader-value"></span><span class="chevron"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></span>';}
    const iconSlot=showValue?btn.querySelector('.vol-icon'):btn,valueSlot=showValue?btn.querySelector('.reader-value'):null;
    pop.prepend(fxUi.volumeTitle);pop.append(...fxUi.volumeRows);
    let maxVolume=150,vol=100,muted=false,open=false,choice=null,choiceTimer=0,sendTimer=0,lastWheel=0;
    const cur=()=>({v:Math.min(maxVolume,choice?.volume??vol),m:choice?.muted??muted});
    const render=()=>{
      const {v,m}=cur(),name=m||v===0?'vol0':v<50?'vol1':'vol2',txt=m?uiText('muted'):formatNumber(v)+' %';
      if(btn.dataset.icon!==name){iconSlot.innerHTML=icon(name);muteBtn.innerHTML=icon(name);btn.dataset.icon=name;}if(valueSlot&&valueSlot.textContent!==txt)valueSlot.textContent=txt;
      btn.toggleAttribute('data-muted',m);btn.setAttribute('aria-label',uiText('fxSound')+' · '+uiText('volume')+': '+txt);btn.title=uiText('fxSound')+' · '+uiText('volume')+': '+txt+' · '+uiText('volumeWheel');
      muteBtn.setAttribute('aria-pressed',String(m));muteBtn.setAttribute('aria-label',m?uiText('unmute'):uiText('mute'));muteBtn.title=m?uiText('unmute'):uiText('mute');
      if(Number(range.value)!==v)range.value=String(v);range.style.setProperty('--vp',String(100/maxVolume));range.style.setProperty('--vv',String(v/maxVolume));range.setAttribute('aria-valuetext',txt);out.textContent=txt;
    };
    const remember=patch=>{choice={...(choice||{}),...patch};clearTimeout(choiceTimer);choiceTimer=setTimeout(()=>{choice=null;render();},6000);};
    const setVolume=v=>{
      v=Math.max(0,Math.min(maxVolume,Math.round(v/5)*5));
      remember(v>0?{volume:v,muted:false}:{volume:v});render();
      clearTimeout(sendTimer);sendTimer=setTimeout(()=>send('volume',Math.min(maxVolume,v)),40);
    };
    const toggleMute=()=>{
      const {v,m}=cur();
      if(!m&&v===0){setVolume(50);return;}
      remember({muted:!m});render();send('mute',!m);
    };
    const step=dir=>setVolume(cur().v+dir*5);
    const close=refocus=>{if(!open)return;open=false;pop.removeAttribute('data-open');pop.removeAttribute('data-above');btn.setAttribute('aria-expanded','false');if(refocus)btn.focus();};
    const place=()=>{if(!open)return;anchorPanel(pop,btn,{width:320,cap:360,min:40,fit:room=>{pop.style.maxHeight=room+'px';}});};onPlace?.(place);
    const openPop=focus=>{if(open||btn.disabled)return;onOpen();open=true;pop.setAttribute('data-open','');btn.setAttribute('aria-expanded','true');place();if(focus)range.focus();};
    btn.addEventListener('click',event=>{if(btn.disabled)return;if(open)close(false);else openPop(event.detail===0);});
    btn.addEventListener('keydown',event=>{
      if(btn.disabled)return;
      if(event.key==='ArrowUp'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();step(1);}
      else if(event.key==='ArrowDown'||event.key==='ArrowLeft'){event.preventDefault();event.stopPropagation();step(-1);}
      else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);}
    });
    muteBtn.addEventListener('click',toggleMute);
    range.addEventListener('input',()=>setVolume(Number(range.value)));
    pop.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
      else if(event.key==='Tab')close(false);
      else event.stopPropagation();
    });
    pop.addEventListener('pointerdown',event=>event.stopPropagation());
    wrap.addEventListener('wheel',event=>{
      if(!wheelStep)return;   // inside a scrolling Settings list the wheel scrolls; only the bar's speaker steps the volume
      if(event.composedPath().includes(pop)&&pop.scrollHeight>pop.clientHeight+1){event.stopPropagation();return;}
      event.preventDefault();event.stopPropagation();
      if(btn.disabled||!event.deltaY)return;
      const now=Date.now();if(now-lastWheel<45)return;lastWheel=now;
      step(event.deltaY<0?1:-1);
    },{passive:false});
    if(settingsToggle)listen(settingsToggle,'click',()=>close(false));
    listen(document,'pointerdown',event=>{if(open&&!event.composedPath().includes(wrap))close(false);},true);
    render();
    disposers.push(()=>{clearTimeout(choiceTimer);clearTimeout(sendTimer);});
    return {button:btn,panel:pop,range,open:openPop,close,place,destroy(){for(const fn of disposers)fn();wrap.replaceChildren();},
      refreshLocale(){render();pop.setAttribute('aria-label',uiText('fxSound'));range.setAttribute('aria-label',uiText('volume'));},
      adjust(delta){if(btn.disabled)return null;setVolume(cur().v+delta);return cur().v;},
      muteToggle(){if(btn.disabled)return null;toggleMute();const {v,m}=cur();return {muted:m,volume:v};},
      update(message){
        const v=message.volume;maxVolume=message.volumeMax===100?100:150;range.max=String(maxVolume);range.setAttribute('aria-valuemax',String(maxVolume));
        if(!Number.isFinite(v)||v<0||v>150)return;   // old player without volume: stay disabled
        vol=Math.min(maxVolume,Math.round(v/5)*5);muted=message.muted===true;btn.disabled=false;
        if(choice){
          const done=(choice.volume===undefined||choice.volume===vol)&&(choice.muted===undefined||choice.muted===muted);
          if(done){choice=null;clearTimeout(choiceTimer);}
        }
        render();
      },
    };

  }

  const VOLUME_CSS="    .vol{flex:none;min-width:0}.vol-btn{display:flex;align-items:center;justify-content:center;width:32px;min-height:30px;padding:0;}.vol-btn svg{width:17px;height:17px;}.vol-btn[aria-expanded=true]{border-color:var(--reader-accent);}.vol-btn[data-muted]{color:var(--reader-muted);}.vol-pop{display:none;position:absolute;top:100%;margin-top:8px;width:240px;max-width:calc(100% - 20px);align-items:center;gap:8px;padding:6px 12px 6px 6px;background:var(--reader-paper);border:1px solid var(--reader-line);border-radius:11px;box-shadow:var(--reader-shadow);font-size:12px;color:var(--reader-ink);z-index:4;cursor:default;}.vol-pop[data-open]{display:flex;}.vol-pop[data-above]{top:auto;bottom:100%;margin:0 0 8px;}.vol-mute{flex:none;display:flex;align-items:center;justify-content:center;width:32px;min-height:30px;padding:0;border-color:transparent;background:transparent;}.vol-mute:hover{background:var(--reader-soft);}.vol-mute[aria-pressed=true]{color:var(--reader-muted);}.vol-mute svg{width:17px;height:17px;}.vol-range{flex:1;min-width:0;height:20px;margin:0;cursor:pointer;-webkit-appearance:none;appearance:none;background:transparent;}.vol-range::-webkit-slider-runnable-track{height:20px;border-radius:2px;background:linear-gradient(90deg,transparent calc(calc(7px + (100% - 14px) * var(--vp,.6667)) - 1px),var(--reader-ink) calc(calc(7px + (100% - 14px) * var(--vp,.6667)) - 1px),var(--reader-ink) calc(calc(7px + (100% - 14px) * var(--vp,.6667)) + 1px),transparent calc(calc(7px + (100% - 14px) * var(--vp,.6667)) + 1px)) center/100% 20px no-repeat,linear-gradient(90deg,transparent calc(7px + (100% - 14px) * var(--vp,.6667)),#e8590c calc(7px + (100% - 14px) * var(--vp,.6667)),#e8590c calc(7px + (100% - 14px) * var(--vv,.6667)),transparent calc(7px + (100% - 14px) * var(--vv,.6667))) 0 center/100% 4px no-repeat,linear-gradient(90deg,var(--reader-accent) min(calc(7px + (100% - 14px) * var(--vv,.6667)),calc(7px + (100% - 14px) * var(--vp,.6667))),transparent min(calc(7px + (100% - 14px) * var(--vv,.6667)),calc(7px + (100% - 14px) * var(--vp,.6667)))) 0 center/100% 4px no-repeat,linear-gradient(90deg,var(--reader-line) calc(7px + (100% - 14px) * var(--vp,.6667)),color-mix(in srgb,#e8590c 55%,var(--reader-line)) calc(7px + (100% - 14px) * var(--vp,.6667))) 0 center/100% 4px no-repeat;}.vol-range::-moz-range-track{height:20px;border-radius:2px;background:linear-gradient(90deg,transparent calc(calc(7px + (100% - 14px) * var(--vp,.6667)) - 1px),var(--reader-ink) calc(calc(7px + (100% - 14px) * var(--vp,.6667)) - 1px),var(--reader-ink) calc(calc(7px + (100% - 14px) * var(--vp,.6667)) + 1px),transparent calc(calc(7px + (100% - 14px) * var(--vp,.6667)) + 1px)) center/100% 20px no-repeat,linear-gradient(90deg,transparent calc(7px + (100% - 14px) * var(--vp,.6667)),#e8590c calc(7px + (100% - 14px) * var(--vp,.6667)),#e8590c calc(7px + (100% - 14px) * var(--vv,.6667)),transparent calc(7px + (100% - 14px) * var(--vv,.6667))) 0 center/100% 4px no-repeat,linear-gradient(90deg,var(--reader-accent) min(calc(7px + (100% - 14px) * var(--vv,.6667)),calc(7px + (100% - 14px) * var(--vp,.6667))),transparent min(calc(7px + (100% - 14px) * var(--vv,.6667)),calc(7px + (100% - 14px) * var(--vp,.6667)))) 0 center/100% 4px no-repeat,linear-gradient(90deg,var(--reader-line) calc(7px + (100% - 14px) * var(--vp,.6667)),color-mix(in srgb,#e8590c 55%,var(--reader-line)) calc(7px + (100% - 14px) * var(--vp,.6667))) 0 center/100% 4px no-repeat;}.vol-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:3px;border-radius:50%;background:var(--reader-paper);border:2px solid var(--reader-accent);box-sizing:border-box;}.vol-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--reader-paper);border:2px solid var(--reader-accent);box-sizing:border-box;}.vol-out{flex:none;min-width:40px;text-align:right;font-size:11px;font-variant-numeric:tabular-nums;color:var(--reader-muted);}\n.vol-pop{position:fixed!important;right:auto!important;bottom:auto!important;margin:0!important;max-width:none!important;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;}";

  // Original control chrome also applies when the adapter lives outside .settings-panel.
  // Keep specificity below the existing speed/FX rules so the document dialog keeps its geometry.
  const CONTROL_CSS=`
    :where(.reader-speech-controls,.reader-speech-panel){box-sizing:border-box;color:var(--reader-ink);font:12px/1.4 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
    :where(.reader-speech-controls,.reader-speech-panel) *{box-sizing:border-box;}
    :where(.reader-speech-controls,.reader-speech-panel) button,:where(button.reader-speech-trigger){font:inherit;color:inherit;background:var(--reader-paper);border:1px solid var(--reader-line);border-radius:7px;min-height:30px;padding:4px 8px;cursor:pointer;}
    :where(.reader-speech-controls,.reader-speech-panel) button:hover,:where(button.reader-speech-trigger):hover{border-color:var(--reader-muted);}
    :where(.reader-speech-controls,.reader-speech-panel) button:focus-visible,:where(button.reader-speech-trigger):focus-visible{outline:2px solid var(--reader-accent,#256249);outline-offset:2px;}
    :where(.reader-speech-controls,.reader-speech-panel) button:disabled,:where(button.reader-speech-trigger):disabled{opacity:.5;cursor:default;}
    :where(.reader-speech-controls,.reader-speech-panel) svg,:where(button.reader-speech-trigger) svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;flex:none;}
    :where(button.reader-speech-trigger){display:flex;align-items:center;gap:6px;width:100%;min-width:0;text-align:left;}
    :where(button.reader-speech-trigger)>svg{width:17px;height:17px;}
    :where(button.reader-speech-trigger) .chevron{display:flex;align-items:center;justify-content:center;line-height:0;flex:none;}
    :where(button.reader-speech-trigger) .chevron svg{width:12px;height:12px;}
    .reader-speech-trigger[aria-expanded=true]{border-color:var(--reader-accent);}
    .reader-speech-trigger[aria-expanded=true]>.chevron svg{transform:rotate(180deg);}
    .reader-speech-panel{display:none;position:fixed;z-index:8;background:var(--reader-paper);border:1px solid var(--reader-line);border-radius:11px;box-shadow:var(--reader-shadow);overflow:hidden;pointer-events:auto;}
    .reader-speech-panel[data-open]{display:flex;}
  `;
  const RANGE_CSS=CONTROL_CSS+VOLUME_CSS+".speed-pop{align-items:center;gap:8px;padding:6px 12px 6px 8px;font-size:12px}.speed-reset{flex:none;display:flex;align-items:center;justify-content:center;min-width:34px;min-height:30px;padding:0 6px;border-color:transparent;background:transparent;font-size:11px;font-variant-numeric:tabular-nums;color:var(--reader-muted)}.speed-reset:hover{background:var(--reader-soft)}.speed-reset[data-active]{color:var(--reader-accent);font-weight:600}.speed-range{flex:1;min-width:0;height:20px;margin:0;cursor:pointer;-webkit-appearance:none;appearance:none;background:transparent}.speed-range::-webkit-slider-runnable-track{height:20px;border-radius:2px;background:linear-gradient(90deg,transparent calc(7px + (100% - 14px) * var(--vp,.1429) - 1px),var(--reader-ink) calc(7px + (100% - 14px) * var(--vp,.1429) - 1px),var(--reader-ink) calc(7px + (100% - 14px) * var(--vp,.1429) + 1px),transparent calc(7px + (100% - 14px) * var(--vp,.1429) + 1px)) center/100% 20px no-repeat,linear-gradient(90deg,var(--reader-accent) calc(7px + (100% - 14px) * var(--vv,.1429)),var(--reader-line) calc(7px + (100% - 14px) * var(--vv,.1429))) 0 center/100% 4px no-repeat}.speed-range::-moz-range-track{height:20px;border-radius:2px;background:linear-gradient(90deg,transparent calc(7px + (100% - 14px) * var(--vp,.1429) - 1px),var(--reader-ink) calc(7px + (100% - 14px) * var(--vp,.1429) - 1px),var(--reader-ink) calc(7px + (100% - 14px) * var(--vp,.1429) + 1px),transparent calc(7px + (100% - 14px) * var(--vp,.1429) + 1px)) center/100% 20px no-repeat,linear-gradient(90deg,var(--reader-accent) calc(7px + (100% - 14px) * var(--vv,.1429)),var(--reader-line) calc(7px + (100% - 14px) * var(--vv,.1429))) 0 center/100% 4px no-repeat}.speed-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:3px;border-radius:50%;background:var(--reader-paper);border:2px solid var(--reader-accent);box-sizing:border-box}.speed-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--reader-paper);border:2px solid var(--reader-accent);box-sizing:border-box}.speed-range:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}.speed-out{flex:none;min-width:40px;text-align:right;font-size:11px;font-variant-numeric:tabular-nums;color:var(--reader-muted)}@keyframes reader-spin{to{transform:rotate(360deg)}}.primary[data-glyph=loading] svg{animation:reader-spin .9s linear infinite;transform-origin:50% 50%}@media(prefers-reduced-motion:reduce){.primary[data-glyph=loading] svg{animation:none}}";
  const createSpeedSlider=({select,button:providedButton=null,bar,t,formatNumber=String,glyph=()=>'',icon=()=>'',anchorPanel,closeOtherMenus=()=>{},dropdowns=[],disposers=[],centerIcons=()=>{},onOpen=()=>{},fxUi=null,doc=document,id='reader-speed-options'})=>{
    const document=doc,win=doc.defaultView;
    const wrapper=select.parentElement;select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const button=providedButton||document.createElement('button');button.type='button';button.classList.add('reader-select-trigger','speed-trigger','reader-speech-trigger');wrapper.classList.add('reader-speech-controls');button.setAttribute('aria-haspopup','true');button.setAttribute('aria-expanded','false');if(!providedButton)button.innerHTML=glyph('speed')+'<span class="reader-value"></span><span class="chevron">'+icon('down')+'</span>';if(!providedButton)wrapper.prepend(button);if(!button.querySelector('.reader-value')){const label=document.createElement('span');label.className='reader-value';button.append(label);}
    const panel=document.createElement('div');panel.className='reader-select-menu speed-menu speed-pop reader-speech-panel';panel.setAttribute('role','group');panel.id=id;button.setAttribute('aria-controls',panel.id);
    const reset=document.createElement('button');reset.type='button';reset.className='speed-reset';reset.textContent='1×';
    const range=document.createElement('input');range.type='range';range.className='speed-range';range.min='0.5';range.max='4';range.step='0.05';range.value='1';
    const out=document.createElement('output');out.className='speed-out';out.setAttribute('aria-hidden','true');out.setAttribute('aria-live','off');panel.append(reset,range,out);bar.append(panel);
    let open=false,dragging=false,dirty=false,frame=0,pending=null,choice=null,choiceTimer=0;
    const MIN=.5,MAX=4,fmt=v=>{const option=[...select.options].find(item=>item.value===v.toFixed(2));return option?option.textContent:formatNumber(v)+'×';};
    const current=()=>{const v=choice??Number(select.value);return Number.isFinite(v)&&select.value!==''?Math.max(MIN,Math.min(MAX,v)):1;};
    const paint=v=>{const label=fmt(v);button.querySelector('.reader-value').textContent=label;out.textContent=label;range.style.setProperty('--vv',String((v-MIN)/(MAX-MIN)));range.style.setProperty('--vp',String((1-MIN)/(MAX-MIN)));range.setAttribute('aria-valuetext',label);button.title=t('speed')+' · '+label;button.setAttribute('aria-label',button.title);panel.setAttribute('aria-label',t('speed'));range.setAttribute('aria-label',t('speed'));reset.title=t('speed')+' · '+fmt(1);reset.setAttribute('aria-label',reset.title);reset.toggleAttribute('data-active',Math.abs(v-1)<.001);};
    const render=()=>{const v=current(),selected=select.selectedOptions[0];button.disabled=select.disabled;range.disabled=select.disabled;reset.disabled=select.disabled;if(!dragging&&!dirty&&Number(range.value)!==v)range.value=String(v);paint(dragging||dirty?Number(range.value):v);if(select.value===''&&selected){button.querySelector('.reader-value').textContent=selected.textContent;}};
    const commit=v=>{dirty=false;v=Math.max(MIN,Math.min(MAX,Math.round(v*20)/20));const text=v.toFixed(2);if(select.disabled||select.value===text)return;choice=v;clearTimeout(choiceTimer);choiceTimer=setTimeout(()=>{choice=null;render();},6000);select.value=text;select.dispatchEvent(new Event('change',{bubbles:true}));render();};
    const close=refocus=>{if(!open)return;open=false;panel.removeAttribute('data-open');button.setAttribute('aria-expanded','false');if(refocus)button.focus();};
    const place=()=>{if(!open)return;anchorPanel(panel,button,{width:380,cap:540,min:40,fit:room=>{panel.style.maxHeight=room+'px';}});};
    const api={button,panel,range,render,close,place,open:focus=>openMenu(focus),setLabel:()=>{},update(message){const v=Number(message?.speed);if(Number.isFinite(v)&&v>=MIN&&v<=MAX){if(choice!==null&&Math.abs(choice-v)<1e-9){choice=null;clearTimeout(choiceTimer);}select.value=v.toFixed(2);select.disabled=false;}fxUi?.update(message);render();}};dropdowns.push(api);
    const openMenu=focus=>{if(button.disabled)return;closeOtherMenus(api);onOpen();open=true;panel.setAttribute('data-open','');button.setAttribute('aria-expanded','true');render();place();if(focus)range.focus({preventScroll:true});centerIcons();};
    button.addEventListener('click',event=>{event.stopPropagation();if(open)close(false);else openMenu(event.detail===0);});
    button.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();openMenu(true);}else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);}});
    range.addEventListener('pointerdown',()=>{dragging=true;});
    const endDrag=()=>{dragging=false;},cancelDrag=()=>{dragging=false;dirty=false;pending=null;render();};win.addEventListener('pointerup',endDrag,true);win.addEventListener('pointercancel',cancelDrag,true);disposers.push(()=>{win.removeEventListener('pointerup',endDrag,true);win.removeEventListener('pointercancel',cancelDrag,true);cancelAnimationFrame(frame);clearTimeout(choiceTimer);});
    range.addEventListener('input',()=>{dirty=true;let v=Number(range.value);if(dragging&&Math.abs(v-1)<=.05+1e-9){v=1;range.value='1';}pending=v;if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(pending!==null)paint(pending);});});
    range.addEventListener('change',()=>{pending=null;dirty=false;commit(Number(range.value));});
    reset.addEventListener('click',()=>{range.value='1';commit(1);range.focus({preventScroll:true});});
    range.addEventListener('dblclick',()=>{range.value='1';commit(1);});
    panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}else if(event.key==='Tab')close(false);else event.stopPropagation();});
    panel.addEventListener('pointerdown',event=>event.stopPropagation());panel.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
    const outside=event=>{if(open&&!event.composedPath().includes(panel)&&!event.composedPath().includes(button))close(false);};document.addEventListener('pointerdown',outside,true);disposers.push(()=>document.removeEventListener('pointerdown',outside,true));
    if(fxUi){panel.classList.add('has-fx');panel.prepend(fxUi.speedTitle);panel.append(...fxUi.speedRows);}
    render();return api;
  };

  // Placement without a player surface (popup Settings): below the trigger when it fits or has more room, else above; width and height stay in the viewport.
  const defaultAnchor=doc=>(panel,button,{width,cap,fit})=>{const win=doc.defaultView,r=button.getBoundingClientRect(),w=Math.min(width,win.innerWidth-24),below=win.innerHeight-r.bottom-18,above=r.top-18;fit(Math.max(80,Math.min(cap,Math.max(below,above))));panel.style.width=w+'px';panel.style.left=Math.max(12,Math.min(win.innerWidth-w-12,r.left))+'px';const h=panel.getBoundingClientRect().height;panel.style.top=(below>=h||below>=above?r.bottom+6:Math.max(6,r.top-h-6))+'px';};
  function mountSpeechControls({mount,trigger=null,uiText,formatNumber=String,onCommand=()=>{},anchorPanel=null,doc=mount.ownerDocument}){
    const disposers=[],select=doc.createElement('select'),wrap=doc.createElement('span');wrap.className='speed-control';
    for(let i=0;i<=70;i++){const o=doc.createElement('option'),v=(.5+i*.05).toFixed(2);o.value=v;o.textContent=formatNumber(Number(v))+'×';select.append(o);}select.value='1.00';wrap.append(select);mount.append(wrap);
    const style=doc.createElement('style');style.textContent=RANGE_CSS+FX_CSS;mount.append(style);
    const fxUi=createFxRows({doc,send:onCommand,uiText,formatNumber});
    const place=anchorPanel||defaultAnchor(doc);
    const ui=createSpeedSlider({select,button:trigger,bar:mount,t:uiText,formatNumber,anchorPanel:place,fxUi,disposers,doc,onOpen:()=>sound.close(false)});
    const soundWrap=doc.createElement('span');mount.append(soundWrap);const sound=createSoundControls({wrap:soundWrap,send:onCommand,uiText,formatNumber,anchorPanel:place,fxUi,doc,onOpen:()=>ui.close(false)});
    select.addEventListener('change',()=>onCommand('speed',Number(select.value)));
    const resize=()=>{ui.place();sound.place();};doc.defaultView.addEventListener('resize',resize);disposers.push(()=>doc.defaultView.removeEventListener('resize',resize));
    return {...ui,sound,fxUi,update(message){ui.update(message);sound.update(message);},close(refocus){ui.close(refocus);sound.close(false);},refreshLocale(){sound.refreshLocale();for(const o of select.options)o.textContent=formatNumber(Number(o.value))+'×';fxUi.refreshLocale();ui.render();},destroy(){sound.destroy();soundWrap.remove();fxUi.dispose();for(const fn of disposers)fn();ui.panel.remove();wrap.remove();style.remove();}};
  }
  // The two trigger glyphs of the bar's speed and voice controls (one source for the bar and the Settings rows).
  const GLYPHS=Object.freeze({language:'<path d="M3 5h12M9 3v2M5 5c0 5 4 8 8 10M13 5c0 5-4 8-9 11M14 21l4-10 4 10m-6-3h4"/>',speed:'<path d="M4 17a9 9 0 1 1 16 0M12 12l5-5M5 12h1m12 0h1M8 6l.5 1M12 3v2"/><circle cx="12" cy="12" r="1.5"/>'});
  return {FX_ROWS,FX_CSS,CONTROL_CSS,VOLUME_CSS,RANGE_CSS,GLYPHS,defaultAnchor,createFxRows,createSoundControls,createSpeedSlider,mountSpeechControls};
}
