/* beNotable! Reader · voice picker (round 7: one filterable, sortable voice table) · own code MIT.
 * One button in the bar, one panel behind it: ONE FILTER ROW (a Material "outlined, floating label" text field "Filter" over all columns + one language dropdown with the language icon), then ONE table of voices of ALL languages.
 * Closed bar, left to right: [language icon] [2-letter language code, fixed width] [quality: 3 bars with the Elo number (or dash) below] [name, one line, fades out at the end]; the level, provider and "automatic" are in the tooltip, not in the bar text.
 * Row, left to right (the column heads over the list have the same order): [ONE state button: download arrow / progress ring / trash] [size] [play sample] [language code, two languages stacked; the code of the DETECTED language is bold in the accent color] [quality: tier bars with the Elo number below] [name] [version: Experimental / High / Balanced / Low, size variant under it] [provider] [year].
 * Licensed older voices remain selectable; Experimental families are excluded. Opening selects the detected document language, with an explicit language filter available.
 * A voice is ONE block between two divider lines: its highest version is the main row, every lower version is a sub row below it, ALWAYS visible (nothing to open). A voice with one version is a block of one row, with its own lines.
 * The version column always names the version with ONE of four words (Experimental, High, Balanced, Low; old names High quality / Balanced / Fast), plus the size variant on a second line (Micro / Nano / Mini / 0.6B ...), also when a voice has only one.
 * ONE button per row and version: not on the device = download arrow (size is in the column next to it), loading = progress ring, on the device = trash (two steps, the second click must be a real user click).
 * "In use" is only a mark of the row (accent bar and accent name). Clicking a row that is on the device uses it; a click on a row that is not yet loaded only marks it (the arrow is the consent to download). A double click is the consent as well: it downloads the voice and uses it as soon as it is on the device.
 * A row is ONE click target: a click on the size, the version or the provider counts as a click on the voice (also for the second press of a double click, which the browser no longer reports as dblclick after the rebuild), and nothing in the list can be selected as text.
 * Languages: the language DROPDOWN (All, Automatic, then every language with its number of voices) is the filter; the language filtered by is ticked and bold, the detected language carries a dot and the badge "detected". In the list only the 2-letter code of the detected language is highlighted (bold, accent color), nothing else is tinted. The default order is by quality (Elo, best on top, the detected language first); every column head sorts, "Quality" sorts by Elo.
 * Equal voices are one row (the same name on the same files in two languages, the same device voice twice).
 * Nothing in the panel changes size or position while a sample plays, a download runs or a message appears (fixed row height, messages only for screen readers).
 * Canonical source of the embedded block (markers VOICEPICKER-BEGIN / VOICEPICKER-END) in extension/player-surface.mjs (extension/tools/reader/player-surface.mjs re-exports it)
 * (the surface must stay self-contained, so the function is embedded there; tests/voice-picker-sync.test.mjs keeps both byte-identical).
 * Data: the player catalog (message.catalog: groups of voices with id, label, tier, installed, mb, progress, recommended) plus the voice register,
 * loaded lazily from registryUrl (neural-models.js: MODELS, FAMILIES, modelBytes = the byte sizes of the model files in the register). Without the register every voice is shown as a plain device voice.
 * Nothing is downloaded by browsing or by the listening sample: the sample is a short recording shipped in the extension; the download button is the consent.
 * Language is a rule: choosing a voice of another language than the text makes the language fixed (visible, one click back to automatic). */
import {installReaderScrollbars} from './scrollbars.mjs';
/* Voices a new listener should not meet first: Piper x_low/low and the anonymous multi-speaker MLS sets sound robotic.
   They stay selectable, only listed last. */
export function roboticVoice(model){
 const quality=(/(x_low|low|medium|high)$/.exec(String(model?.voiceURI||model?.id||''))||[])[1];
 const piperLow=model?.family==='piper'&&(quality==='x_low'||quality==='low');
 return piperLow||/^MLS\b/.test(String(model?.display||model?.name||''));
}
/* The voice a language starts with: offered on the voice card of a capable device, played by the welcome sample and
   asked for by a first audio export. German is Thorsten medium (model id 'piper-medium', 63 MB) also where the engine
   has WASM threads: measured 20.11.2026 (isolated engine host, 16 cores), Thorsten high read at RTF 0.65 per worker
   and stopped once per text at 1x and 2x (1.1 s / 2.7 s), medium at 0.07-0.1 never stopped and started within 0.2-1.7 s.
   Change it here and nowhere else. Languages without an entry take the best recommended voice. */
export const FIRST_RUN_VOICES=Object.freeze({de:'piper-medium'});
/* "Recommended for you" in one language: at most a small, a balanced and a best voice (small first), never a robotic
   one. Per size class a natural family (Kokoro, Phonon, Kitten) wins where it speaks the language, otherwise Piper
   fills the class (high before medium); one speaker across the sizes where the register has it (Bella in three
   sizes; German Thorsten next to Kerstin, see FIRST_RUN_VOICES). A voice whose base checkpoint was trained on
   non-commercial data (basisNonCommercial) is left out when the language has another voice of the same size class
   without it. Pure on purpose: a smaller register later changes
   data, not this rule. models: register entries; language: language code; memoryGB: device memory (unknown =
   nothing left out). Returns [{role, model}]. */
export function recommendVoices(models,language,memoryGB){
 const NATURAL=['kokoro','phonon','kitten'],lang=String(language||'').split('-')[0].toLowerCase();
 const mb=m=>(m.files||[]).reduce((sum,f)=>sum+(f.bytes||0),0);
 const level=m=>(/(x_low|low|medium|high)$/.exec(String(m.voiceURI||m.id))||[])[1];
 const quality=m=>({high:3,medium:2,low:1,x_low:0})[level(m)]??2;
 const rank=m=>NATURAL.includes(m.family)?NATURAL.indexOf(m.family):NATURAL.length;
 const speaks=m=>(m.languages||[m.lang]).some(code=>String(code||'').split('-')[0].toLowerCase()===lang);
 // the engine needs at most half of the device memory
 const roomy=m=>!(memoryGB>0)||!(m.ramMB>0)||m.ramMB<=memoryGB*512;
 const all=(Array.isArray(models)?models:[]).filter(m=>m&&!m.experimental&&speaks(m)&&!roboticVoice(m)&&roomy(m));
 const pool=all.filter(m=>!m.basisNonCommercial||!all.some(o=>o.tier===m.tier&&!o.basisNonCommercial));
 const natural=pool.filter(m=>NATURAL.includes(m.family));
 // one speaker across the sizes: the language's first-run voice where it has one, else the leading family
 const named=all.find(m=>m.id===FIRST_RUN_VOICES[lang]);
 const anchor=named?.display||[...(natural.length?natural:pool)].sort((a,b)=>rank(a)-rank(b))[0]?.display;
 const order=(a,b)=>(b.installed)-(a.installed)||(b.display===anchor)-(a.display===anchor)||rank(a)-rank(b)||quality(b)-quality(a)||mb(a)-mb(b);
 const picks=[];
 for(const [tier,role] of [['fast','small'],['balanced','balanced'],['best','best']]){
  const own=natural.filter(m=>m.tier===tier),best=(own.length?own:pool.filter(m=>m.tier===tier)).sort(order)[0];
  if(best)picks.push({role,model:best});
 }
 // a "smaller" voice that is not smaller helps nobody
 return picks.filter((pick,i)=>i===picks.length-1||mb(pick.model)<mb(picks[i+1].model));
}
export function firstRunVoice(models,language,memoryGB){
 const list=Array.isArray(models)?models:[],lang=String(language||'').split('-')[0].toLowerCase();
 const named=list.find(m=>m&&m.id===FIRST_RUN_VOICES[lang]&&!m.experimental);
 return named||recommendVoices(list,lang,memoryGB).find(pick=>pick.role==='best')?.model||null;
}
/* The voice a device starts with when nothing is chosen yet: on a device that gets the best tier the language's first-run voice,
   otherwise the recommendation of its tier (without WASM threads - every Chrome extension page since 2.5 - that is the balanced voice,
   e.g. German Thorsten medium, because Thorsten high cannot keep up on one thread). tier: recommendTier() of the device. The bar
   (page-session voiceChoices) and the welcome page (sizes, sample) use this one rule, so the welcome page names what Play loads. */
export function deviceStartVoice(models,language,{tier='balanced',memoryGB}={}){
 const list=Array.isArray(models)?models:[],order=['small','balanced','best'],want={fast:'small',balanced:'balanced',best:'best'}[tier]||'balanced';
 if(want==='best'){const first=firstRunVoice(list,language,memoryGB);if(first)return first;}
 const picks=recommendVoices(list,language,memoryGB);
 return (picks.filter(pick=>order.indexOf(pick.role)<=order.indexOf(want)).at(-1)||picks[0])?.model||null;
}
export function createVoicePicker({shadow,root=null,idPrefix='vp',send,uiText,getLocale,listen,disposers,settingsToggle=null,place=()=>{},isPlaying=()=>false,getVolume=()=>({volume:100,muted:false}),registryUrl='',eloUrl='',sampleBase='',now=()=>new Date(),createAudio=()=>new Audio(),fetchSample=url=>fetch(url).then(r=>{if(!r.ok)throw new Error('sample');return r.blob();}),onSample=()=>{}}){
 if(typeof installReaderScrollbars==='function')installReaderScrollbars(shadow);
 // root/idPrefix: a second picker (Settings) on its own .voice wrapper keeps every id unique in the shared shadow root
 const ID=/^[a-z][a-z0-9-]{0,20}$/i.test(idPrefix)?idPrefix:'vp',wrap=root||shadow.querySelector('.voice'),btn=wrap.querySelector('.voice-btn'),menu=wrap.querySelector('.voice-menu'),nameEl=btn.querySelector('.vn'),codeEl=btn.querySelector('small');
 const LANG_RE=/^(auto|[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3})$/i,ID_RE=/^[a-z0-9_:.-]{1,64}$/,TIERS=['fast','balanced','best'],LEVEL={fast:1,balanced:2,best:3},SORTS=['downloaded','size','quality','language','name','version','provider','year'],NATURAL={downloaded:'desc',size:'asc',quality:'desc',language:'asc',name:'asc',version:'asc',provider:'asc',year:'desc'},SORT_KEY='notableVoiceSort';
 const baseOf=code=>String(code||'').split('-')[0].toLowerCase();
 const names=new Map();let namesLocale='';
 const intlName=(locale,code)=>{try{const name=new Intl.DisplayNames([locale],{type:'language'}).of(code);return name||code;}catch{return String(code);}};
 const ownName=code=>{const key='own:'+code;if(!names.has(key)){let v;try{const name=new Intl.DisplayNames([code],{type:'language'}).of(code);v=name.charAt(0).toLocaleUpperCase(code)+name.slice(1);}catch{v=String(code).toUpperCase();}names.set(key,v);}return names.get(key);};
 const uiName=code=>{if(namesLocale!==getLocale()){for(const k of [...names.keys()])if(k.startsWith('ui:'))names.delete(k);namesLocale=getLocale();}const key='ui:'+code;if(!names.has(key))names.set(key,intlName(getLocale(),code));return names.get(key);};
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 let info=null,choice=null,choiceTimer=0,open=false,reg=null,highlight='',live='',serial=0,typed='',typedTimer=0,rowSignature='',progressSignature='',filterSignature='',confirming='',failKey='',failTimer=0,sortKey='quality',sortDir='desc',elo=null,eloAsked=false,languageChosen=false,showAll=false;
 /* a voice picked by double click: downloaded now, used as soon as the catalog reports it as installed (5 minutes, then forgotten) */
 let pendingUse=null;
 const filter={text:'',lang:'all'};let langOpen=false,langHi='',gpuKey='';
 const tried=new Set(),sample={key:'',state:'idle',audio:null,url:''};
 /* ---- markup ---- */
 const style=el('style');style.dataset.voicePicker='';style.textContent=`
  .voice-menu{width:min(500px,calc(100vw - 16px))}
  .vp{--vp-row:30px;--vp-sub:26px;--vp-danger:light-dark(#b3261e,#ff8f84);position:relative;display:flex;flex-direction:column;gap:6px;padding:8px;font-size:12px;color:var(--reader-ink);text-align:left}.vp-title{display:flex;align-items:center;gap:8px;font-weight:600;font-size:12px;height:20px;min-width:0}.vp-title small{font-weight:400;font-size:10px;color:var(--reader-muted);white-space:nowrap}.vp-title .vp-count{margin-left:auto;flex:none}
  .vp [hidden]{display:none!important}
  .vp-banner{display:flex;align-items:center;flex:0 1 auto;min-width:0;margin-left:auto}.vp .vp-banner[hidden]{display:none!important}.vp-banner~.vp-count{margin-left:0}.vp-banner .vp-sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
  .vp-banner button,.vp-banner .vp-chip{flex:0 1 auto;min-width:0;height:20px;min-height:20px;box-sizing:border-box;padding:0 8px;border:1px solid var(--reader-accent);border-radius:999px;background:var(--reader-soft);color:var(--reader-accent);font-size:11px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.vp-banner .vp-chip{cursor:default;color:var(--reader-ink)}.vp-banner [hidden]{display:none!important}
  .vp-live{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
  .vp-filter{display:flex;align-items:center;gap:8px;min-width:0;margin-top:4px}
  .vp-field{position:relative;flex:1 1 auto;min-width:0;height:36px}
  .vp-search{display:block;width:100%;height:100%;box-sizing:border-box;margin:0;padding:0 8px 0 36px;border:1px solid var(--reader-muted);border-radius:6px;background:transparent;color:var(--reader-ink);font:inherit;font-size:14px}.vp-search::placeholder{color:transparent;opacity:0}.vp-search:hover{border-color:var(--reader-ink)}.vp-search:focus{outline:0;border-color:var(--reader-accent);box-shadow:0 0 0 1px var(--reader-accent)}
  .vp-fi{position:absolute;left:10px;top:50%;width:18px;height:18px;margin-top:-9px;color:var(--reader-muted);pointer-events:none}.vp-fi svg{display:block;width:100%;height:100%}.vp-field:focus-within .vp-fi{color:var(--reader-accent)}
  .vp-flabel{position:absolute;left:34px;top:50%;max-width:calc(100% - 44px);box-sizing:border-box;padding:0 4px;transform:translateY(-50%);font-size:14px;line-height:1.2;color:var(--reader-muted);background:transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;transition:top .12s ease,font-size .12s ease,color .12s ease}
  .vp-field:focus-within .vp-flabel,.vp-search:not(:placeholder-shown)~.vp-flabel{top:0;left:8px;font-size:11px;background:var(--vp-bg,var(--reader-paper))}.vp-field:focus-within .vp-flabel{color:var(--reader-accent)}
  @media(prefers-reduced-motion:reduce){.vp-flabel{transition:none}}
  .vp-lang{position:relative;flex:none;width:156px;height:36px}
  .vp-langbtn{display:flex;align-items:center;gap:6px;width:100%;height:100%;box-sizing:border-box;margin:0;padding:0 8px;border:1px solid var(--reader-muted);border-radius:6px;background:transparent;color:var(--reader-ink);font:inherit;font-size:13px;text-align:left;cursor:pointer}.vp-langbtn:hover{border-color:var(--reader-ink)}.vp-langbtn[aria-expanded=true],.vp-langbtn:focus-visible{border-color:var(--reader-accent);box-shadow:0 0 0 1px var(--reader-accent);outline:0}.vp-langbtn[data-set]{border-color:var(--reader-accent)}
  .vp-langbtn svg{flex:none;width:17px;height:17px;color:var(--reader-muted)}.vp-langbtn .vp-lt{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 14px),transparent)}.vp-langbtn .vp-ch{flex:none;width:9px;height:9px;border:solid var(--reader-muted);border-width:0 1.5px 1.5px 0;transform:rotate(45deg) translate(-2px,-2px)}
  .vp-langmenu{position:absolute;z-index:5;top:calc(100% + 2px);right:0;min-width:100%;width:230px;max-width:min(260px,calc(100vw - 32px));max-height:240px;overflow:auto;box-sizing:border-box;padding:4px;border:1px solid var(--reader-line);border-radius:8px;background:var(--vp-bg,var(--reader-paper));box-shadow:var(--reader-shadow,0 6px 20px rgba(0,0,0,.2));scrollbar-width:thin}
  .vp-li{display:flex;align-items:center;gap:6px;min-height:30px;box-sizing:border-box;padding:0 8px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap}.vp-li:hover,.vp-li[data-hi]{background:var(--reader-option-hover,var(--reader-soft));box-shadow:inset 0 0 0 2px var(--reader-option-ring,var(--reader-accent))}.vp-li[aria-selected=true]{font-weight:700;background:var(--reader-option-current,var(--reader-accent));color:var(--reader-option-current-ink,var(--reader-on-accent,#fff))}.vp-li[aria-selected=true]:is(:hover,[data-hi]){box-shadow:inset 0 0 0 2px var(--reader-option-current,var(--reader-accent)),inset 0 0 0 4px var(--reader-paper)}.vp .vp-li[aria-selected=true] :is(.vp-tick,.vp-lcount,.vp-ln,.vp-det){color:inherit;border-color:currentColor}.vp-li .vp-tick{flex:none;width:14px;color:var(--reader-accent);font-weight:700}.vp-li .vp-ln{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}.vp-li .vp-lcount{flex:none;font-size:11px;font-weight:400;color:var(--reader-muted);font-variant-numeric:tabular-nums}
  .vp-li .vp-det{flex:none;display:inline-flex;align-items:center;gap:4px;padding:0 6px;height:16px;border:1px solid var(--reader-accent);border-radius:999px;font-size:10px;font-weight:600;color:var(--reader-accent)}.vp-li .vp-det::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}.vp-li[data-cmd] .vp-ln{color:var(--reader-ink)}.vp-li[data-cmd]+.vp-li:not([data-cmd]){margin-top:2px}.vp-lsep{height:1px;margin:3px 4px;background:var(--reader-line)}
  .vp-table{display:flex;flex-direction:column;gap:2px;min-height:0;border-radius:8px}
  .vp-table:focus-visible{outline:2px solid var(--reader-accent);outline-offset:1px}
  .vp-head{display:flex;align-items:center;gap:3px;flex:none;height:24px;box-sizing:border-box;margin:0 1px;padding:0 3px 0 7px;font-size:9.5px;color:var(--reader-muted)}.vp-head [role=row]{display:contents}.vp-head .vp-hcell{display:flex;align-items:center;min-width:0;height:100%}
  .vp-hb{display:inline-flex;align-items:center;justify-content:center;gap:1px;max-width:none;min-width:24px;height:24px;min-height:24px;margin:0 -2px;padding:0 2px;border:0;border-bottom:2px solid transparent;border-radius:3px 3px 0 0;background:transparent;color:inherit;font:inherit;font-weight:600;letter-spacing:.02em;white-space:nowrap;cursor:pointer}.vp-hb:hover{background:var(--reader-soft);color:var(--reader-ink)}.vp-hb[data-on]{color:var(--reader-accent);border-bottom-color:var(--reader-accent)}.vp-hb svg{width:7px;height:7px;flex:none}
  .vp-hc-st{flex:none;width:24px;justify-content:center}.vp-hc-sz{flex:none;width:var(--vp-sz-w,46px);justify-content:flex-end}.vp-hc-play{flex:none;width:24px}.vp-hc-opt{display:flex;flex:1 1 auto;min-width:0;gap:5px;padding:0 3px}.vp-hc-opt>.vp-hcell{flex:none}.vp-hc-q{width:var(--vp-q-w,34px);overflow:visible;justify-content:center}.vp-hc-lg{width:var(--vp-lg-w,28px);overflow:visible;justify-content:center}.vp-hc-nm{flex:1 1 auto!important;min-width:0}.vp-hc-vr{width:var(--vp-vr-w,70px)}.vp-hc-pv{width:var(--vp-pv-w,3.9em)}.vp-hc-yr{width:var(--vp-yr-w,2.6em);justify-content:flex-end}
  .vp-list{display:flex;flex-direction:column;gap:0;border:1px solid var(--reader-line);border-radius:8px;background:var(--reader-paper);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;user-select:none;-webkit-user-select:none}.vp-voices{position:relative;overflow-anchor:none;max-height:calc(var(--vp-row)*10 + 12px);min-height:var(--vp-row)}.vp[data-lang-open] .vp-voices{min-height:215px}
  .vp-voice{flex:none;display:flex;flex-direction:column;border-top:1px solid var(--reader-line);content-visibility:auto;contain-intrinsic-size:auto 31px}.vp-voice:first-child{border-top-color:transparent}.vp-voice:last-child{border-bottom:1px solid var(--reader-line)}
  .vp-empty{flex:none;padding:10px 9px;font-size:11px;color:var(--reader-muted)}
  .vp-gh{flex:none;display:flex;align-items:flex-end;min-height:24px;box-sizing:border-box;padding:6px 9px 3px;
     font-size:10px;font-weight:700;letter-spacing:.03em;color:var(--reader-muted)}
  .vp-gh:not(:first-child){border-top:1px solid var(--reader-line)}
  .vp-c{flex:none;display:flex;align-items:center;justify-content:center}
  .vp-voice[data-group=rec] .vp-vr{color:var(--reader-accent)}
  .vp-morerow{flex:none;display:flex;padding:4px;border-top:1px solid var(--reader-line)}
  .vp-more{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;min-height:30px;padding:4px 8px;
     border:1px solid var(--reader-line);border-radius:6px;background:transparent;color:var(--reader-accent);
     font:inherit;font-size:12px;font-weight:600;cursor:pointer}
  .vp-more:hover{background:var(--reader-soft)}
  .vp-more:focus-visible{outline:2px solid var(--reader-accent);outline-offset:1px}
  .vp-more::after{content:'';width:7px;height:7px;border:solid currentColor;border-width:0 1.5px 1.5px 0;
     transform:translateY(-2px) rotate(45deg)}
  .vp-more[aria-expanded=true]::after{transform:translateY(2px) rotate(-135deg)}
  .vp-opt{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:30px;padding:4px 9px;border-radius:6px;cursor:pointer}.vp-opt[data-hi]{background:transparent}.vp-opt[aria-selected=true]{color:var(--reader-accent);font-weight:600}.vp-opt small,.vp-opt .vp-st{font-size:10px;font-weight:400;color:var(--reader-muted);white-space:nowrap}.vp-opt .vp-nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .vp-row{position:relative;display:flex;align-items:center;gap:3px;flex:none;height:var(--vp-row);box-sizing:border-box;padding:0 3px 0 7px;border-radius:6px;cursor:pointer}.vp-row[data-sub]{height:var(--vp-sub)}.vp-row:hover,.vp-row:has(>.vp-opt[data-hi]){background:var(--reader-option-hover,var(--reader-soft));box-shadow:inset 0 0 0 2px var(--reader-option-ring,var(--reader-accent))}
  .vp-row[data-active]::before{content:'';position:absolute;left:1px;top:5px;bottom:5px;width:3px;border-radius:2px;background:var(--reader-accent)}
  .vp-row .vp-opt{flex:1 1 auto;min-width:0;height:100%;box-sizing:border-box;min-height:0;justify-content:flex-start;gap:5px;padding:0 3px;background:transparent}
  .vp-nmw{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;overflow:hidden;max-height:100%}.vp-row .vp-nm{flex:none;white-space:normal;overflow:hidden;overflow-wrap:anywhere;text-overflow:clip;line-height:12px;max-height:100%}.vp-meta{display:none;font-size:10px;line-height:11px;font-weight:400;color:var(--reader-muted);white-space:nowrap;overflow:hidden}
  .vp-lg{flex:none;width:var(--vp-lg-w,20px);display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;line-height:11px;font-weight:400;color:var(--reader-muted);letter-spacing:.03em}.vp-lg>span{display:block}.vp-lg>span[data-det]{font-weight:800;color:var(--reader-accent)}.vp-pv{flex:none;width:var(--vp-pv-w,3.9em);overflow:visible;white-space:nowrap;font-size:10px;font-weight:400;color:var(--reader-muted)}
  .vp-vr{flex:none;width:var(--vp-vr-w,70px);font-size:10px;line-height:11px;font-weight:400;color:var(--reader-muted);white-space:pre;max-height:100%;overflow:hidden}.vp-row[data-sub] .vp-nm{font-size:11px;font-weight:400;color:var(--reader-muted)}.vp-row[data-sub] .vp-nmw{position:relative;padding-left:14px}.vp-row[data-sub] .vp-nmw::before{content:'';position:absolute;left:3px;top:0;height:50%;width:7px;border-left:1px solid var(--reader-muted);border-bottom:1px solid var(--reader-muted);border-bottom-left-radius:2px}
  .vp-sz{flex:none;width:var(--vp-sz-w,46px);text-align:right;white-space:nowrap;font-size:10px;font-weight:400;color:var(--reader-muted)}.vp-elo{flex:none;text-align:center;font-size:10.5px;line-height:11px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--reader-ink)}.vp-elo[data-none]{font-weight:400;color:var(--reader-muted)}.vp-row[data-sub] .vp-elo{font-weight:400;color:var(--reader-muted)}
  .vp-q{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;width:var(--vp-q-w,34px);height:100%;box-sizing:border-box}.vp-qb{flex:none;display:flex;align-items:flex-end;justify-content:center;gap:1px;height:8px}.vp-qb i{display:block;width:3px;border-radius:1px;background:var(--reader-line)}.vp-qb i:nth-child(1){height:3px}.vp-qb i:nth-child(2){height:5.5px}.vp-qb i:nth-child(3){height:8px}.vp-q[data-level="1"] i:nth-child(-n+1),.vp-q[data-level="2"] i:nth-child(-n+2),.vp-q[data-level="3"] i{background:var(--reader-accent)}
  .vp-yr{flex:none;width:var(--vp-yr-w,2.6em);text-align:right;font-size:10px;font-weight:400;color:var(--reader-muted)}.vp-yr[data-level="3"]{color:var(--reader-accent);font-weight:600}
  .vp-ib{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;min-height:24px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--reader-muted);cursor:pointer}.vp-ib:hover{background:var(--reader-soft);color:var(--reader-ink)}.vp-ib svg{display:block;width:15px;height:15px}
  .vp-ib[data-off]{visibility:hidden;pointer-events:none}.vp-ib[data-act=play][aria-pressed=true]{color:var(--reader-accent)}.vp-ib[data-act=play][data-fail]{color:var(--vp-danger)}.vp-ib[data-act=play][aria-busy=true]{opacity:.55}
  .vp-ib[data-act=del]{color:var(--vp-danger);border:1px solid var(--vp-danger)}.vp-ib[data-act=del]:hover{background:color-mix(in srgb,var(--vp-danger) 14%,transparent);color:var(--vp-danger)}
  .vp-ib[data-act=dl]{color:var(--reader-accent);border:1px solid var(--reader-accent)}.vp-ib[data-st=busy]{border:1px solid transparent;background:conic-gradient(var(--reader-accent) calc(var(--p,0)*1%),var(--reader-line) 0);box-shadow:inset 0 0 0 5px var(--reader-paper);color:var(--reader-accent);}.vp-ib[data-st=busy] svg{display:none}.vp-ib[data-st=busy]:is(:hover,:focus-visible) svg{display:block;width:12px;height:12px}.vp-ib[data-st=busy]{cursor:pointer}.vp-ib[data-st=wait]{border:1px dashed var(--reader-accent);color:var(--reader-accent)}.vp-ib[data-st=wait] svg:last-child{display:none}.vp-ib[data-st=wait]:is(:hover,:focus-visible) svg:first-child{display:none}.vp-ib[data-st=wait]:is(:hover,:focus-visible) svg:last-child{display:block}
  .vp-confirm{position:absolute;inset:0 0 auto 0;min-height:100%;z-index:2;display:flex;align-items:center;gap:6px;box-sizing:border-box;padding:2px 4px 2px 8px;border:1px solid var(--vp-danger);border-radius:6px;background:var(--reader-paper)}.vp-confirm span{flex:1;min-width:0;font-size:10.5px;line-height:1.2;font-weight:400;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.vp-confirm button{flex:none;min-height:22px;padding:2px 8px;font-size:11px;white-space:nowrap}.vp-confirm [data-act=del-yes]{border-color:var(--vp-danger);color:var(--vp-danger)}
  .vp :is(.vp-voices,.vp-opt,.vp-li):focus-visible,.vp-voices:focus-visible,.vp-ib:focus-visible,.vp-confirm button:focus-visible{outline:2px solid var(--reader-accent);outline-offset:1px}
  .vp-notice{display:flex;gap:8px;align-items:flex-start;box-sizing:border-box;padding:6px 9px;border:1px solid var(--vp-danger);border-radius:8px;font-size:11px;line-height:1.35;color:var(--reader-ink);background:color-mix(in srgb,var(--vp-danger) 8%,transparent)}.vp-notice{flex-wrap:wrap}.vp-ntext{flex:1 1 0;min-width:0}.vp-nact{flex:1 0 100%;display:flex;flex-wrap:wrap;gap:6px;padding-left:23px}.vp-nact button{min-height:24px;padding:3px 10px;font-size:11px;border:1px solid var(--reader-accent);border-radius:6px;background:transparent;color:var(--reader-accent);cursor:pointer}.vp-nact button:hover{background:color-mix(in srgb,var(--reader-accent) 12%,transparent)}.vp-nact button:focus-visible{outline:2px solid var(--reader-accent);outline-offset:1px}.vp-nact[hidden]{display:none}.vp-notice::before{content:'!';flex:none;display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--vp-danger);color:var(--reader-paper);font-weight:700;font-size:10px;line-height:1}
  .voice-btn .vp-bar-q{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:2.4em}.voice-btn .vp-bar-q[data-level="1"] i:nth-child(-n+1),.voice-btn .vp-bar-q[data-level="2"] i:nth-child(-n+2),.voice-btn .vp-bar-q[data-level="3"] i{background:var(--reader-accent)}.voice-btn .vp-bar-elo{flex:none;text-align:center;font-size:10.5px;line-height:11px;font-weight:600;font-variant-numeric:tabular-nums}.voice-btn .vp-bar-elo[data-none]{font-weight:400;color:var(--reader-muted)}.voice-btn[data-warn]{border-color:#c0392b}
  /* a voice that still has to be downloaded: a small download mark on the bar button */
  .voice-btn[data-missing]{position:relative}
  .voice-btn[data-missing]::after{content:'↓';position:absolute;top:-5px;right:-5px;width:13px;height:13px;
     border-radius:50%;
  background:var(--reader-accent);color:var(--reader-on-accent,#fff);
     font:700 9px/13px ui-sans-serif,system-ui,sans-serif;
   text-align:center;pointer-events:none}
  .voice-btn[data-recommended]{position:relative}
  .voice-btn[data-recommended]::before{content:'★';position:absolute;top:-6px;left:-6px;width:14px;height:14px;
     border-radius:50%;
  background:var(--reader-accent);color:var(--reader-on-accent,#fff);
     font:700 10px/14px ui-sans-serif,system-ui,sans-serif;
   text-align:center;pointer-events:none}
  .voice-btn[data-recommended][data-missing]::before{left:auto;right:20px}
  .voice-btn .vn{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:clip;white-space:nowrap;line-height:1.3;text-align:left;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 14px),transparent)}.voice-btn>small.vp-code{display:block;flex:none;width:2.2em;margin:0;text-align:center;font-size:10px;letter-spacing:.03em}
  @media(max-width:420px){.voice-btn>.language-icon,.voice-btn>.chevron{display:none}.voice-btn[data-static]>.language-icon{display:none}.voice .voice-btn.voice-btn{gap:3px;padding-left:5px;padding-right:5px}.voice-btn>small.vp-code{width:1.7em}.voice-btn .vp-bar-q{min-width:0}.voice-btn .vp-bar-elo{font-size:10px}
   .vp-lang{width:120px}.vp-row{gap:2px}.vp-row .vp-opt{gap:3px}.vp-meta{font-size:9.5px}
   .vp-row .vp-vr,.vp-row .vp-pv,.vp-row .vp-yr{display:none}.vp-row .vp-meta{display:block}.vp-row[data-long] .vp-meta{display:none}
   .vp-head [role=row]{justify-content:space-between}.vp-head .vp-hc-opt{display:contents}.vp-head .vp-hc-play{display:none}.vp-head .vp-hcell{width:auto!important;flex:none!important}.vp-head{padding-right:3px}}`;
 if(!shadow.querySelector('style[data-voice-picker]'))shadow.append(style);
 const audio=createAudio();audio.hidden=true;audio.className='vp-audio';audio.preload='none';try{(root||shadow).append(audio);}catch{}
 /* closed bar: quality bars, language code, name, auto mark (left to right) */
 const bars3=()=>{const b=el('span','vp-qb');b.append(el('i'),el('i'),el('i'));return b;};
 // the level only: an arena number without its scale means nothing in the bar
 const barQ=el('span','vp-bar-q');barQ.setAttribute('aria-hidden','true');barQ.append(bars3());
 codeEl.classList.add('vp-code');nameEl.before(codeEl,barQ);
 menu.removeAttribute('role');menu.replaceChildren();
 const panel=el('div','vp');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');      /* Tab stays inside the panel (Escape closes it and returns to the voice button): a contained dialog, so screen readers keep their cursor in it too */
 const title=el('div','vp-title'),titleText=el('span'),titleMode=el('small'),countEl=el('small','vp-count');
 const banner=el('div','vp-banner'),bannerText=el('span','vp-sr'),bannerChip=el('span','vp-chip'),bannerBack=el('button');bannerBack.type='button';bannerChip.setAttribute('aria-hidden','true');banner.hidden=true;banner.append(bannerText,bannerChip,bannerBack);
 title.append(titleText,titleMode,banner,countEl);
 /* ONE filter row: Material "outlined, floating label" text field (the label "Filter" stands in the field, floats onto the outline when focused or filled, so it is always readable) + a language dropdown with the language icon */
 const filterBar=el('div','vp-filter');filterBar.setAttribute('role','search');
 const field=el('div','vp-field'),search=el('input','vp-search'),fieldLabel=el('label','vp-flabel');search.type='search';search.id=ID+'-search';search.autocomplete='off';search.spellcheck=false;search.placeholder=' ';search.setAttribute('autocapitalize','off');fieldLabel.htmlFor=ID+'-search';field.append(search,fieldLabel);
 const langWrap=el('div','vp-lang'),langBtn=el('button','vp-langbtn'),langText=el('span','vp-lt'),langMenu=el('div','vp-langmenu');langBtn.type='button';langBtn.id=ID+'-langbtn';langBtn.setAttribute('aria-haspopup','listbox');langBtn.setAttribute('aria-expanded','false');langBtn.setAttribute('aria-controls',ID+'-langmenu');langMenu.id=ID+'-langmenu';langMenu.setAttribute('role','listbox');langMenu.hidden=true;langMenu.tabIndex=-1;
 const langIcon=()=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d','M3 5h12M9 3v2M5 5c0 5 4 8 8 10M13 5c0 5-4 8-9 11M14 21l4-10 4 10m-6-3h4');for(const [k,v] of [['fill','none'],['stroke','currentColor'],['stroke-width','2'],['stroke-linecap','round'],['stroke-linejoin','round']])path.setAttribute(k,v);svg.append(path);return svg;};
 langBtn.append(langIcon(),langText,el('span','vp-ch'));langWrap.append(langBtn,langMenu);
 filterBar.append(field,langWrap);
 const notice=el('div','vp-notice'),noticeText=el('span','vp-ntext'),noticeActs=el('div','vp-nact');notice.setAttribute('role','alert');notice.hidden=true;notice.append(noticeText,noticeActs);
 /* "WebGPU missing": buttons that open the browser's flags page filtered to the flag (the extension may open chrome:// and brave:// pages with tabs.create; if the browser refuses, the address is copied instead). Flag names: developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips */
 const FLAGS=[['vulkan','enable-vulkan','flags_open_vulkan'],['webgpu','enable-unsafe-webgpu','flags_open_webgpu']],isFirefox=/Firefox\//.test(globalThis.navigator?.userAgent||''),isBrave=()=>!!globalThis.navigator?.brave;
 const openFlag=async(flag,id)=>{
  const rt=(globalThis.browser||globalThis.chrome)?.runtime;let reply=null;
  try{reply=await rt.sendMessage({t:'openFlags',flag,brave:isBrave()});}catch{}
  if(reply?.ok)return;
  const url=(isBrave()?'brave':'chrome')+'://flags/#'+id;let copied=false;
  try{await globalThis.navigator.clipboard.writeText(url);copied=true;}catch{}
  const text=uiText(copied?'flags_copied':'flags_copy_failed',{url});say(text);noticeText.textContent=uiText(gpuKey||'gpu_missing')+' '+text;requestAnimationFrame(()=>doPlace());
 };
 const buildNotice=()=>{
  noticeText.textContent=gpuKey?uiText(gpuKey):'';noticeActs.replaceChildren();
  const offer=gpuKey==='gpu_missing'||gpuKey==='gpu_failed';
  if(offer&&isFirefox){const hint=el('span','vp-nhint',uiText('flags_firefox_hint'));noticeActs.append(hint);}
  else if(offer)for(const [flag,id,key] of FLAGS){const b=el('button','vp-nflag',uiText(key));b.type='button';b.dataset.flag=flag;b.title=(isBrave()?'brave':'chrome')+'://flags/#'+id;b.addEventListener('click',event=>{if(event.isTrusted)void openFlag(flag,id);});noticeActs.append(b);}
  noticeActs.hidden=!noticeActs.childNodes.length;
 };
 /* column heads = sorting: one narrow row over the list, same column order and widths as a voice row; a click sorts, a second click reverses (aria-sort on the heads) */
 const head=el('div','vp-head');head.setAttribute('role','rowgroup');head.id=ID+'-head';
 const headRow=el('div');headRow.setAttribute('role','row');head.append(headRow);
 const headOpt=el('div','vp-hc-opt'),headCells={},OPT_KEYS=new Set();headOpt.setAttribute('role','columnheader');
 /* left to right, exactly like a voice row: [download state] [size] [play] | [language] [quality + Elo] [name] [version] [provider] [year] */
 const headSpec=[['downloaded','vp-hc-st'],['size','vp-hc-sz'],['','vp-hc-play'],['language','vp-hc-lg',1],['quality','vp-hc-q',1],['name','vp-hc-nm',1],['version','vp-hc-vr',1],['provider','vp-hc-pv',1],['year','vp-hc-yr',1]];
 for(const [key,cls,inOpt] of headSpec){
  const cell=el('div',cls+' vp-hcell');if(!key){cell.setAttribute('role','columnheader');headRow.append(cell,headOpt);continue;}
  if(!inOpt){cell.setAttribute('role','columnheader');cell.setAttribute('aria-sort','none');}const b=el('button','vp-hb');b.type='button';b.dataset.sort=key;b.tabIndex=key==='downloaded'?0:-1;b.append(el('span','vp-hl'),el('span','vp-ha'));cell.append(b);headCells[key]=cell;
  if(inOpt){headOpt.append(cell);OPT_KEYS.add(key);}else headRow.append(cell);
 }
 const voices=el('div','vp-list vp-voices');voices.id=ID+'-voices';voices.setAttribute('role','rowgroup');
 /* ONE grid: the header row and the voice rows. Focus stays on the grid, the marked voice cell is active. */
 const grid=el('div','vp-table');grid.setAttribute('role','grid');grid.tabIndex=0;grid.append(head,voices);
 const liveEl=el('div','vp-live');liveEl.setAttribute('role','status');liveEl.setAttribute('aria-live','polite');
 panel.append(title,filterBar,notice,grid,liveEl);menu.append(panel);
 /* ---- remembered per browser profile: sort order (extension storage, else localStorage) ---- */
 const store=globalThis.chrome?.storage?.local||null;
 const saveSort=()=>{const value=sortKey+':'+sortDir;try{if(store)void store.set({[SORT_KEY]:value}).catch?.(()=>{});else localStorage.setItem('notable-voice-sort',value);}catch{}};
 /* stored as "key:direction"; an older value without direction means the natural direction of that column; the former Elo column is the quality column now */
 const ALL_KEY='notableVoiceListAll';
 const saveShowAll=()=>{
  try{
   if(store)void store.set({[ALL_KEY]:showAll}).catch?.(()=>{});
   else localStorage.setItem('notable-voice-list-all',showAll?'1':'0');
  }catch{}
 };
 const loadShowAll=async()=>{
  try{
   const value=store?(await store.get(ALL_KEY))[ALL_KEY]===true:localStorage.getItem('notable-voice-list-all')==='1';
   if(value!==showAll){showAll=value;rowSignature='';if(info&&open)build();}
  }catch{}
 };
 const loadSort=async()=>{try{const value=String(store?(await store.get(SORT_KEY))[SORT_KEY]:localStorage.getItem('notable-voice-sort')||''),[key0,dir]=value.split(':'),key=key0==='elo'?'quality':key0;if(SORTS.includes(key)){const d=dir==='asc'||dir==='desc'?dir:NATURAL[key];if(key!==sortKey||d!==sortDir){sortKey=key;sortDir=d;rowSignature='';if(info)render();}}}catch{}};
 /* ---- data ---- */
 const clean=raw=>Array.isArray(raw)?raw.filter(e=>e&&typeof e.code==='string'&&LANG_RE.test(e.code)&&e.code!=='auto'&&Array.isArray(e.voices)).map(e=>({code:e.code,label:String(e.label||e.code).slice(0,40),voices:e.voices.filter(v=>v&&v.experimental!==true&&typeof v.id==='string'&&ID_RE.test(v.id)).map(v=>({id:v.id,label:String(v.label||v.id).slice(0,60),tier:TIERS.includes(v.tier)?v.tier:'',installed:v.installed!==false,mb:Math.max(0,Math.round(Number(v.mb)||0)),progress:Number.isFinite(v.progress)?Math.max(0,Math.min(100,Math.round(v.progress))):-1,recommended:v.recommended===true}))})).filter(e=>e.voices.length):[];
 const bytesOf=model=>reg?.modelBytes?reg.modelBytes(model):(model.files||[]).reduce((sum,f)=>sum+f.bytes,0);
 const familyName=model=>reg?.FAMILIES?.[model.family]||model.family||'';
 let byUri=new Map(),dupes=new Set();
 const indexRegistry=()=>{byUri=new Map(Object.values(reg.MODELS).map(m=>[m.voiceURI,m]));const seen=new Map();for(const m of Object.values(reg.MODELS)){if(!m.voiceId)continue;const key=(m.display||'').toLowerCase();if(!seen.has(key))seen.set(key,new Set());seen.get(key).add(m.family||m.voiceId);}dupes=new Set([...seen].filter(([,ids])=>ids.size>1).map(([key])=>key));};
 /* ---- arena ratings: the data file voice-elo.json (value, arena, source, date per entry), loaded lazily. A model without an entry has NO number (shown as a dash). ---- */
 const fin=(v,min=0)=>typeof v==='number'&&Number.isFinite(v)&&v>=min?v:0;
 const cleanElo=raw=>{
  if(!raw||!Array.isArray(raw.entries))return null;
  const list=a=>Array.isArray(a)?a.filter(x=>typeof x==='string'):[],ent=e=>e&&fin(e.elo,1)&&typeof e.arena==='string'&&typeof e.retrieved==='string'?{arena:e.arena.slice(0,60),elo:Math.round(e.elo),ci:Math.round(fin(e.ci)),rank:fin(e.rank),of:fin(e.of),votes:fin(e.votes),retrieved:e.retrieved,model:String(e.model||'').slice(0,60)}:null;
  const entries=raw.entries.map(e=>{const main=ent(e);return main?{...main,families:list(e.families),modelIds:list(e.modelIds),languages:list(e.languages),also:(Array.isArray(e.also)?e.also:[]).map(ent).filter(Boolean)}:null;}).filter(Boolean);
  const sources=raw.sources||{},none=raw.noRating||{};
  return {entries,arenas:list(none.checked).map(k=>sources[k]?.name).filter(Boolean),checked:typeof none.retrieved==='string'?none.retrieved:'',own:raw.ownMeasurement&&typeof raw.ownMeasurement==='object'?raw.ownMeasurement:{}};
 };
 const eloOf=(model,base)=>elo&&model?elo.entries.find(e=>(e.families.includes(model.family)||e.modelIds.includes(model.id))&&(!e.languages.length||e.languages.includes(base)))||null:null;
 /* The provider stands in every row; in tooltips and screen reader names it is added to the name only where the name alone is ambiguous (Bella: Kokoro and Kitten). */
 const ambiguous=voice=>!!voice.family&&dupes.has(voice.name.toLowerCase());
 const shown=voice=>voice.name+(ambiguous(voice)?' · '+voice.family:'');
 // the register names Kokoro's blended default voice in German
 const localName=name=>String(name).replace('Standardmischung',uiText('model_name_mix'));
 const providerOf=row=>row.system?uiText('voice_provider_system'):row.family;
 /* Sizes: up to 999 MB in MB; from 1000 MB (four digits) in GB with the three most significant digits, cut not rounded (1455 MB = 1,45 GB, 12340 MB = 12,3 GB, 123456 MB = 123 GB), decimal sign of the UI language. */
 const sizeText=bytes=>{
  const mb=Math.round(bytes/1e6);
  if(mb<1000)return bytes>=1e6?mb+' MB':Math.max(1,Math.round(bytes/1e3))+' KB';
  const digits=mb>=100000?0:mb>=10000?1:2,gb=Math.floor(mb/10**(3-digits))/10**digits;
  let text;try{text=gb.toLocaleString(getLocale(),{minimumFractionDigits:digits,maximumFractionDigits:digits,useGrouping:false});}catch{text=gb.toFixed(digits);}
  return text+' GB';
 };
 /* Novelty from the release month (YYYY-MM): up to 12 months old = 3 (highlighted year), up to 24 = 2, older = 1; unknown = no display (never guessed). */
 const noveltyOf=released=>{const m=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(released||'');if(!m)return 0;const d=now(),age=(d.getFullYear()-Number(m[1]))*12+(d.getMonth()+1-Number(m[2]));return age<=12?3:age<=24?2:1;};
 const yearOf=entry=>Number(String(entry?.released||'').slice(0,4))||0;
 /* Bytes a removal really frees: the files of this model that no OTHER installed voice with a different file set still needs (same rule as exclusiveFiles in the model manager). */
 const sameSet=(a,b)=>a.files.length===b.files.length&&a.files.every(f=>b.files.some(g=>g.url===f.url));
 const removal=entry=>{
  const model=byUri.get(entry.id);if(!model?.files)return {bytes:entry.mb*1e6,siblings:0,names:[]};
  const keep=new Set(),siblings=new Map(),own=new Set([entry.id,...entry.twins.map(t=>t.id)]),mine=(model.display||model.name||'').toLowerCase();
  for(const group of info.catalog)for(const v of group.voices){if(!v.installed||own.has(v.id))continue;const other=byUri.get(v.id);if(!other?.files)continue;if(sameSet(model,other)){const name=other.display||other.name||v.label;if(name.toLowerCase()!==mine)siblings.set(name.toLowerCase(),name);}else for(const f of other.files)keep.add(f.url);}
  return {bytes:model.files.filter(f=>!keep.has(f.url)).reduce((sum,f)=>sum+f.bytes,0),siblings:siblings.size,names:[...siblings.values()]};
 };
/* The sentence that names the voices which go with it (they share ONE file set: Qwen3-TTS 1.7B holds nine speakers in one download, Kitten eight voices): up to eight names, then "+N". */
 const alsoText=rm=>{if(!rm.siblings)return '';const shown=rm.names.slice(0,8),more=rm.names.length-shown.length;return uiText('voice_remove_shared',{count:rm.siblings,names:shown.join(', ')+(more>0?' +'+more:'')});};
 const entryHas=(entry,id)=>!!entry&&(entry.id===id||entry.twins.some(t=>t.id===id));
 const entriesOf=row=>row.system?[row.entry]:[...Object.values(row.tiers),...row.smaller];
 const anyInstalled=row=>row.system||entriesOf(row).some(e=>e.installed)?1:0;
 const tierText=tier=>tier?uiText('model_tier_'+tier):'';
 /* Stage "Experimentell" (large/WebGPU models): named instead of a quality level, no quality bars, sorted below the rated voices. */
 const tierLabel=entry=>entry?.experimental?uiText('voice_experimental'):tierText(entry?.tier);
 /* The version a row names: level plus size variant (High quality, Balanced · Mini, Fast · Nano, Experimental · 1.7B); always filled for registry voices, also when a voice has only one. */
 const versionOf=entry=>entry?.fileKey===undefined||!entry?.tier&&!entry?.variant?'':[tierLabel(entry),entry.variant?entry.variant.charAt(0).toLocaleUpperCase()+entry.variant.slice(1):''].filter(Boolean).join(' · ');
 const rank=entry=>(entry?.experimental?0.1:LEVEL[entry?.tier]||0);
 /* The highest version is the main row, every lower one a sub row below it. */
 const top=row=>row.system?row.entry:[...entriesOf(row)].sort((a,b)=>rank(b)-rank(a)||b.mb-a.mb)[0];
 /* The entry a voice stands for when the bar must pick one (keyboard cycling): the one in use, else the best installed one, else the recommended one, else Balanced. */
 const best=(row,pref)=>{const list=TIERS.map(t=>row.tiers[t]).filter(Boolean);return list.find(e=>e.tier===pref&&e.installed)||[...list].reverse().find(e=>e.installed)||row.smaller.find(e=>e.installed)||list.find(e=>e.tier===pref)||list.find(e=>e.recommended)||list.find(e=>e.tier==='balanced')||list[0];};
 const others=(row,entry)=>row.system?[]:entriesOf(row).filter(x=>x!==entry).sort((a,b)=>rank(b)-rank(a)||b.mb-a.mb);
 const cmp=(a,b)=>a<b?-1:a>b?1:0;
 /* Voices of ALL languages: one row per register voice (versions folded in), device voices one row each. Equal voices are one row: the same name on the same model files in two languages (Qwen3-TTS English/German),
    the same device voice listed twice. The other ids stay on the entry as "twins", so using or removing it works with whichever id fits the text language. */
 const allRows=()=>{
  const map=new Map(),devices=new Map();
  for(const group of info.catalog){const base=baseOf(group.code);for(const v of group.voices){
   const model=byUri.get(v.id);if(model?.experimental)continue;
   if(!model){const dk=base+'|'+v.label.toLowerCase(),mate=devices.get(dk);if(mate){mate.entry.twins.push({id:v.id,group:group.code});continue;}
    const entry={id:v.id,tier:'',released:'',installed:v.installed,mb:0,ram:0,progress:v.progress,queued:v.queued===true,recommended:v.recommended,sample:'',variant:'',experimental:false,group:group.code,unclear:false,family:'',elo:null,fileKey:undefined,twins:[]},row={key:v.id,system:true,name:v.label,family:'',group:group.code,bases:[base],tiers:{},smaller:[],entry};devices.set(dk,row);map.set(v.id,row);continue;}
   const key=model.voiceId||v.id;let row=map.get(key);
   if(!row){row={key,system:false,name:localName(model.display||v.label),family:familyName(model),group:group.code,bases:[],tiers:{},smaller:[]};map.set(key,row);}
   if(!row.bases.includes(base))row.bases.push(base);
   const entry={id:v.id,tier:model.tier||'',released:model.released||'',installed:v.installed,mb:Math.max(1,Math.round(bytesOf(model)/1e6)),ram:model.ramMB||0,progress:v.progress,queued:v.queued===true,recommended:v.recommended,sample:model.sample||'',variant:model.variant||'',experimental:model.experimental===true,group:group.code,unclear:model.licenseStatus==='unclear',family:model.family||'',elo:eloOf(model,base),fileKey:(model.files||[]).map(f=>f.url).sort().join('+'),twins:[]};
   const current=row.tiers[entry.tier];if(!current)row.tiers[entry.tier]=entry;else if(entry.mb>current.mb){row.smaller.push(current);row.tiers[entry.tier]=entry;}else row.smaller.push(entry);
  }}
  const seen=new Map(),out=[];
  for(const row of map.values()){
   if(row.system){out.push(row);continue;}
   const sig=row.family+'|'+row.name+'|'+entriesOf(row).map(e=>e.tier+'/'+e.variant+'/'+e.fileKey).sort().join(','),canon=seen.get(sig);
   if(!canon){seen.set(sig,row);out.push(row);continue;}
   for(const e of entriesOf(row)){const mate=entriesOf(canon).find(x=>x.tier===e.tier&&x.variant===e.variant&&x.fileKey===e.fileKey);mate.twins.push({id:e.id,group:e.group});mate.installed=mate.installed||e.installed;mate.progress=Math.max(mate.progress,e.progress);}
   for(const b of row.bases)if(!canon.bases.includes(b))canon.bases.push(b);
  }
  return out;
 };
 const bases=()=>{const seen=[];for(const g of info.catalog){const b=baseOf(g.code);if(!seen.includes(b))seen.push(b);}return seen;};
 const groupCodeOf=base=>info.catalog.find(g=>g.code===base)?.code||info.catalog.find(g=>baseOf(g.code)===base)?.code||base;
 /* ---- filter: text over all columns, chips, age switch ---- */
 const FIELD={elo:'elo',mb:'mb',size:'mb',groesse:'mb',year:'year',jahr:'year',name:'name',provider:'provider',anbieter:'provider',lang:'lang',sprache:'lang',version:'version',level:'level',stufe:'level',quality:'level',qualitaet:'level'},NUMERIC=new Set(['elo','mb','year']);
 const LEVELWORD={fast:'fast',balanced:'balanced',best:'best'};
 const parseQuery=text=>String(text||'').toLowerCase().split(/\s+/).filter(Boolean).map(tok=>{const m=/^([a-z]+)(>=|<=|>|<|=|:)(.+)$/.exec(tok),field=m&&FIELD[m[1]];if(!field)return {text:tok};if(NUMERIC.has(field)){const n=Number(String(m[3]).replace(',','.'));if(Number.isFinite(n))return {field,op:m[2]===':'?'=':m[2],n};return {text:tok};}return {field,text:m[3]};});
 const versionsOf=row=>entriesOf(row).map(versionOf).filter(Boolean);
 const langWords=row=>row.bases.flatMap(b=>[b,ownName(b),uiName(b)]);
 const haystack=row=>[row.name,shown(row),providerOf(row),row.family,...langWords(row),...entriesOf(row).flatMap(e=>[e.tier,tierLabel(e),e.variant,e.experimental?'experimental':'',e.mb?e.mb+' mb':'',e.elo?String(e.elo.elo):'',e.released?e.released.slice(0,4):'',e.installed&&!row.system?uiText('model_status_installed'):''])].join(' ').toLowerCase();
 const compare=(value,op,n)=>op==='>'?value>n:op==='>='?value>=n:op==='<'?value<n:op==='<='?value<=n:value===n;
 const matchToken=(row,t,hay)=>{
  if(!t.field)return hay.includes(t.text);
  const list=entriesOf(row);
  if(t.field==='elo')return list.some(e=>e.elo&&compare(e.elo.elo,t.op,t.n));
  if(t.field==='mb')return list.some(e=>e.mb>0&&compare(e.mb,t.op,t.n));
  if(t.field==='year')return list.some(e=>yearOf(e)&&compare(yearOf(e),t.op,t.n));
  if(t.field==='name')return (row.name+' '+shown(row)).toLowerCase().includes(t.text);
  if(t.field==='provider')return (providerOf(row)+' '+row.family).toLowerCase().includes(t.text);
  if(t.field==='lang')return langWords(row).some(w=>w.toLowerCase().includes(t.text));
  if(t.field==='version')return versionsOf(row).some(v=>v.toLowerCase().includes(t.text));
  if(t.field==='level')return list.some(e=>(e.experimental?'experimental':e.tier).includes(LEVELWORD[t.text]||t.text)||tierLabel(e).toLowerCase().includes(t.text));
  return true;
 };
 const matchesFilters=(row,tokens,hay)=>(filter.lang==='all'||row.bases.includes(filter.lang))&&tokens.every(t=>matchToken(row,t,hay));
 /* 2025 or newer (a voice of unknown year is never judged old) */
 /* Order: the chosen column first (ascending or descending), then Elo (rated first), our own level, newer before older, name. Unknown values (no year, no size, no Elo) always go last, in either direction.
    Default (quality = Elo, best on top): the voices of the detected language come first. */
 const sortRows=(rows,detectedBase)=>{
  const facts=new Map(rows.map(r=>{const p=top(r);return [r,{lvl:rank(p),elo:p?.elo?.elo||0,y:p?.released||'',mb:p?.mb||0,inst:anyInstalled(r),ver:versionOf(p),det:detectedBase&&r.bases.includes(detectedBase)?1:0,rob:!r.system&&roboticVoice(byUri.get(p?.id))?1:0}];}));
  const f=r=>facts.get(r),loc=getLocale(),unknown={year:r=>!f(r).y,size:r=>!f(r).mb,quality:r=>!f(r).elo,version:r=>!f(r).ver},
   asc={quality:(a,b)=>f(a).elo-f(b).elo||f(a).lvl-f(b).lvl,downloaded:(a,b)=>f(a).inst-f(b).inst,provider:(a,b)=>(a.system?'':a.family).localeCompare(b.system?'':b.family,loc),year:(a,b)=>cmp(f(a).y,f(b).y),
   name:(a,b)=>a.name.localeCompare(b.name,loc),language:(a,b)=>cmp(a.bases[0],b.bases[0]),size:(a,b)=>f(a).mb-f(b).mb,version:(a,b)=>f(a).ver.localeCompare(f(b).ver,loc)}[sortKey]||(()=>0),sign=sortDir==='desc'?-1:1,pin=sortKey==='quality'&&sortDir==='desc'&&filter.lang==='all';   /* with ONE language chosen every row already belongs to it: a multi-language row (Qwen, unrated) must not be lifted above rated voices of that list */
  const by=(a,b)=>{if(sortKey==='quality'&&f(a).rob!==f(b).rob)return f(a).rob-f(b).rob;if(pin&&f(a).det!==f(b).det)return f(b).det-f(a).det;const u=unknown[sortKey];if(u&&u(a)!==u(b))return u(a)?1:-1;if(sortKey==='provider'&&a.system!==b.system)return a.system?1:-1;return sign*asc(a,b);};
  return [...rows].sort((a,b)=>by(a,b)||(f(b).elo-f(a).elo)||(f(b).lvl-f(a).lvl)||cmp(f(b).y,f(a).y)||a.name.localeCompare(b.name,loc)||cmp(a.key,b.key));
 };
 /* The effective state: what the player reported, overlaid with a recent local choice (so a click shows at once and a late state does not undo it). */
 const effective=()=>{
  const setting=choice?.language!==undefined?choice.language:info.language,auto=setting==='auto';
  let activeBase=choice?.voice?baseOf(choice.voice.language):!auto?baseOf(setting):baseOf(info.active||info.detected||info.catalog[0].code);
  if(!info.catalog.some(g=>baseOf(g.code)===activeBase))activeBase=baseOf(info.catalog[0].code);
  const voiceId=choice?.voice?.id??info.voice,detectedBase=info.detected?baseOf(info.detected):'';
  const raw=allRows(),owner=raw.find(row=>entriesOf(row).some(en=>entryHas(en,voiceId)))||null,entry=owner?entriesOf(owner).find(en=>entryHas(en,voiceId)):null;
  /* Older licensed models stay available; release dates and arena scores are never inferred. */
  const all=raw;
  const tokens=parseQuery(filter.text);
  const pass=all.filter(r=>matchesFilters(r,tokens,tokens.some(t=>!t.field)?haystack(r):'')),rows=sortRows(pass,detectedBase);
  return {setting,auto,activeBase,all,rows,current:owner,entry,voiceId,detectedBase,pinnedOther:!auto&&detectedBase&&detectedBase!==activeBase,noVoiceForPage:auto&&detectedBase&&!info.catalog.some(g=>baseOf(g.code)===detectedBase)};
 };
 const say=text=>{live=text;liveEl.textContent=text;};
 /* The live region is invisible: a click on a voice that is not on the device used to look like "nothing happens". The same sentence is shown for a few seconds in the title line, in the accent color. */
 let flashTimer=0;
 const flash=text=>{clearTimeout(flashTimer);countEl.textContent=text;countEl.dataset.hint='';countEl.style.color='var(--reader-accent)';countEl.style.fontWeight='600';flashTimer=setTimeout(()=>{delete countEl.dataset.hint;countEl.style.color='';countEl.style.fontWeight='';rowSignature='';if(open)build();},4500);};
 /* ---- bar button ---- */
 const renderButton=()=>{
  if(!info)return;
  const e=effective(),current=e.current,label=current?shown(current):(!choice&&info.voiceLabel)||'';
  nameEl.textContent=(current?current.name:label)||uiText('voice');codeEl.textContent=e.activeBase.toUpperCase().slice(0,2);
  if(LEVEL[e.entry?.tier])barQ.dataset.level=String(LEVEL[e.entry.tier]);else barQ.removeAttribute('data-level');
    const lang=uiName(e.activeBase),text=uiText('voice_bar_label',{voice:label||uiText('voice'),language:lang,mode:uiText(e.auto?'voice_mode_auto':'voice_mode_fixed'),tier:tierLabel(e.entry)}).replace(/,\s*\./,'.').replace(/\s+\./g,'.');
  const missing=!!e.entry&&!e.current?.system&&!e.entry.installed&&e.entry.progress<0;
  const activeBase=e.activeBase;
  const recVoice=e.rows.find(r=>baseOf(r.code)===activeBase)?.voices.find(v=>v.recommended&&!v.installed);
  const hasRecommended=!!recVoice;
  btn.title=(e.noVoiceForPage?uiText('voice_none_for',{language:uiName(e.detectedBase)}):text)+(missing?' · '+uiText('voice_missing',{mb:e.entry.mb}):'')+(hasRecommended?' · '+uiText('model_recommended'):'');btn.setAttribute('aria-label',btn.title);btn.toggleAttribute('data-warn',!!e.noVoiceForPage);btn.toggleAttribute('data-missing',missing);btn.toggleAttribute('data-recommended',hasRecommended);
  btn.removeAttribute('data-static');btn.tabIndex=0;btn.setAttribute('aria-haspopup','dialog');btn.setAttribute('aria-expanded',String(open));btn.setAttribute('aria-controls',ID+'-panel');
 };
 panel.id=ID+'-panel';
 const commitLanguage=code=>{
  const e=effective();
  if((code==='auto'&&e.auto)||(code!=='auto'&&!e.auto&&e.activeBase===code))return;
  const value=code==='auto'?'auto':groupCodeOf(code);choice={...(choice||{}),language:value,voice:undefined};startChoiceTimer();send('language',value);highlight='';
  say(code==='auto'?uiText('voice_lang_auto',{language:info.detected?ownName(baseOf(info.detected)):uiText('automatic')}):uiText('voice_lang_pinned',{language:ownName(code)}));render();
 };
 const startChoiceTimer=()=>{clearTimeout(choiceTimer);choiceTimer=setTimeout(()=>{choice=null;render();},6000);};
 /* Applies a voice entry: a voice of another language than the text makes the language fixed (visible, one click back). An entry that stands for the same voice in two languages is used in the one that fits the text. */
 const useEntry=(row,entry0)=>{
  const e=effective(),want=e.auto&&e.detectedBase?e.detectedBase:e.activeBase,options=[{id:entry0.id,group:entry0.group},...entry0.twins],pick=options.find(o=>baseOf(o.group)===want)||options[0],entry={...entry0,id:pick.id,group:pick.group},base=baseOf(entry.group);
  if(e.auto&&e.detectedBase&&base!==e.detectedBase||e.auto&&!e.detectedBase&&base!==e.activeBase){choice={...(choice||{}),language:entry.group};send('language',entry.group);}
  choice={...(choice||{}),voice:{language:entry.group,id:entry.id}};startChoiceTimer();send('voice',{language:entry.group,id:entry.id});
  say(uiText('voice_chosen',{voice:shown(row),tier:tierLabel(entry)}).replace(/,\s*$/,''));render();
 };
 /* What the list shows. By default only "Recommended for you" (recommendVoices for the reading language), the voices
    already on the device and the one in use, then the switch to the full list (remembered per profile); a search or a
    chosen language filter shows the full list at once. A full-list line is the main row of a voice (id = its row key)
    or one of its lower versions (row key + "#" + entry id); the short groups prefix their ids, because one voice can
    stand in two groups. */
 const listMode=()=>filter.text.trim()||languageChosen?'filtered':showAll?'all':'short';
 const modelsOf=e=>{
  const full=[];
  for(const row of e.rows){
   const entry=top(row);
   full.push({id:row.key,row,entry,sub:false,group:'all'});
   for(const alt of others(row,entry))full.push({id:row.key+'#'+alt.id,row,entry:alt,sub:true,group:'all'});
  }
  const mode=listMode();if(mode==='filtered')return full;
  const owner=id=>{
   for(const row of e.all)for(const entry of entriesOf(row))if(entryHas(entry,id))return {row,entry};
   return null;
  };
  const picks=reg?recommendVoices(Object.values(reg.MODELS),e.activeBase,globalThis.navigator?.deviceMemory):[];
  const rec=picks.map(pick=>({...owner(pick.model.voiceURI),role:pick.role})).filter(x=>x.row);
  const seen=new Set(rec.map(x=>x.entry.id)),mine=[];
  for(const row of sortRows(e.all,e.detectedBase))for(const entry of entriesOf(row)){
   const onDevice=!row.system&&entry.installed||entryHas(entry,e.voiceId);
   if(onDevice&&!seen.has(entry.id)){seen.add(entry.id);mine.push({row,entry});}
  }
  const line=(prefix,group,x)=>({id:prefix+x.entry.id,row:x.row,entry:x.entry,sub:false,group,role:x.role});
  const short=[...rec.map(x=>line('r|','rec',x)),...mine.map(x=>line('m|','mine',x))];
  return mode==='all'?[...short,...full]:short;
 };
 const lookup=(id,e)=>{const m=modelsOf(e).find(x=>x.id===id);return m?{row:m.row,entry:m.entry,sub:m.sub}:null;};
 const keyOfId=id=>id.split('#')[0];
 const markedId=(e,list)=>(list.some(m=>m.id===highlight)?highlight:'')||(list.find(m=>entryHas(m.entry,e.voiceId)&&(e.current&&m.row===e.current))?.id)||list[0]?.id||'';
 const SVG='http://www.w3.org/2000/svg',ICONS={search:['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.2 15.2 20 20'],play:['M8 5.5v13l10.5-6.5z',true],stop:['M7.5 7.5h9v9h-9z',true],trash:['M5 7h14M10 7V5h4v2m-6 0 1 12h6l1-12M10.5 10.5v6M13.5 10.5v6'],down:['M12 4.5v10m0 0-4-4m4 4 4-4M5.5 19.5h13'],asc:['M12 5l8 13H4z',true],desc:['M12 19L4 6h16z',true],close:['M7 7l10 10M17 7L7 17'],wait:['M6.5 12h.01M12 12h.01M17.5 12h.01']};
 /* The bar centres every button icon by its measured box (getBBox, one forced layout per icon, again after every list rebuild). The few list icons are measured ONCE each and carry their shift from the start, so a rebuild of 175 rows costs no layout. */
 const shifts=new Map();
 const paintPath=(path,fill)=>{if(fill)path.setAttribute('fill','currentColor');else{for(const [k,v] of [['fill','none'],['stroke','currentColor'],['stroke-width','2'],['stroke-linecap','round'],['stroke-linejoin','round']])path.setAttribute(k,v);}};
 const shiftOf=name=>{
  if(shifts.has(name))return shifts.get(name);
  let shift=null;
  try{if(shadow.host?.isConnected){const svg=document.createElementNS(SVG,'svg'),path=document.createElementNS(SVG,'path'),[d,fill]=ICONS[name];svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.style.cssText='position:absolute;width:24px;height:24px;visibility:hidden;pointer-events:none';path.setAttribute('d',d);paintPath(path,fill);svg.append(path);shadow.append(svg);const b=svg.getBBox();svg.remove();if(b.width&&b.height)shift=`translate(${12-b.x-b.width/2} ${12-b.y-b.height/2})`;}}catch{}
  if(shift)shifts.set(name,shift);return shift;
 };
 const icon=name=>{const svg=document.createElementNS(SVG,'svg'),path=document.createElementNS(SVG,'path'),[d,fill]=ICONS[name];svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',d);paintPath(path,fill);const shift=shiftOf(name);if(shift){const g=document.createElementNS(SVG,'g');g.setAttribute('transform',shift);g.append(path);svg.append(g);svg.dataset.centered='true';}else svg.append(path);return svg;};
 {const mark=el('span','vp-fi');mark.setAttribute('aria-hidden','true');mark.append(icon('search'));field.prepend(mark);}
 const iconButton=(act,label,name,tab)=>{const b=el('button','vp-ib');b.type='button';b.dataset.act=act;b.setAttribute('aria-label',label);b.title=label;b.tabIndex=tab?0:-1;b.append(icon(name));return b;};
 const off=b=>{b.dataset.off='';b.tabIndex=-1;b.setAttribute('aria-hidden','true');};
 /* The Elo / quality tooltip: arena rating with source and date (if there is one), our own level, and what Elo does not measure. */
 /* one formatter per language, not one per call: the tooltips of all rows are built on every open */
 let formatters=null;
 const formatterFor=()=>{const loc=getLocale();if(formatters?.loc!==loc){let number=null,date=null;try{number=new Intl.NumberFormat(loc);}catch{}try{date=new Intl.DateTimeFormat(loc,{dateStyle:'medium',timeZone:'UTC'});}catch{}formatters={loc,number,date,days:new Map()};}return formatters;};
 const fmt=n=>{try{return formatterFor().number.format(n);}catch{return String(n);}};
 const dateText=iso=>{const f=formatterFor();if(f.days.has(iso))return f.days.get(iso);let v;try{v=f.date.format(new Date(iso+'T00:00:00Z'));}catch{v=iso;}f.days.set(iso,v);return v;};
 const eloLine=(key,x)=>uiText(key,{arena:x.arena,elo:fmt(x.elo),ci:fmt(x.ci),rank:x.rank?fmt(x.rank):'?',total:x.of?fmt(x.of):'?',votes:x.votes?fmt(x.votes):'?',date:dateText(x.retrieved)});
 const qualityTip=(entry,tierName)=>{
  const own=entry.experimental?tierName+' · '+uiText('voice_experimental_hint'):tierName+' · '+uiText('model_tier_'+entry.tier+'_hint');
  if(!elo)return own;
  const lines=[];
  if(entry.elo){lines.push(eloLine('voice_elo_tip',entry.elo),uiText('voice_elo_scope',{model:entry.elo.model||entry.family}));for(const also of entry.elo.also)lines.push(eloLine('voice_elo_also',also));}
  else lines.push(uiText('voice_elo_none',{arenas:elo.arenas.join(', '),date:elo.checked?dateText(elo.checked):''}));
  lines.push(uiText('voice_elo_own',{tier:tierName}),entry.experimental?uiText('voice_experimental_hint'):uiText('model_tier_'+entry.tier+'_hint'));
  const own2=elo.own[entry.family];
  if(own2&&fin(own2.wer)&&fin(own2.referenceWer))lines.push(uiText('voice_elo_measure',{wer:fmt(own2.wer),ref:fmt(own2.referenceWer),model:String(own2.referenceModel||''),date:own2.date?dateText(own2.date):''}));
  if(entry.elo||own2)lines.push(uiText('voice_elo_hint'));
  return lines.join('\n');
 };
 /* Model facts come from the pinned register. Unknown dates, gender and arena scores stay explicitly unknown. */
 const metadataTip=entry=>{
  const model=entry&&byUri.get(entry.id);if(!model)return '';
  const meta=model.metadata||{},unknown=uiText('voice_meta_unknown'),line=(key,value)=>uiText('voice_meta_'+key,{value:value===undefined||value===null||value===''?unknown:String(value)});
  return [line('language',model.lang),line('quality',meta.quality||tierText(model.tier)),line('sample_rate',model.sampleRate?fmt(model.sampleRate)+' Hz':''),line('speaker',meta.speakerLabel?meta.speakerLabel+' · ID '+(model.speakerId??0):model.speakerId),line('speakers',model.voices),line('size',sizeText(bytesOf(model))),line('license',model.license),line('dataset',meta.dataset),line('dataset_license',meta.datasetLicense),line('attribution',model.attribution),line('source',model.source),line('gender',['f','m'].includes(model.gender)?uiText('voice_meta_gender_'+model.gender):''),line('release',model.released),line('rating',entry.elo?'Elo '+entry.elo.elo:'')].join('\n');
 };
 /* Columns that hold text of any length (provider, version, size, language codes) take the width of their longest text, so no name is ever cut and the heads stay over their columns. */
 let measureCtx=null;
 const textWidth=(text,font)=>{try{measureCtx=measureCtx||document.createElement('canvas').getContext('2d');measureCtx.font=font;return measureCtx.measureText(text).width;}catch{return text.length*6.2;}};
 /* two languages of one voice stand stacked (one under the other) to save width */
 const codes=row=>row.bases.map(b=>b.toUpperCase().slice(0,2));
  const sizeColumns=models=>{
  const family=getComputedStyle(voices).fontFamily||'sans-serif',mains=models.filter(m=>!m.sub),set=(name,px)=>panel.style.setProperty(name,Math.ceil(px)+'px');
  const w=(list,font)=>Math.max(0,...list.map(t=>textWidth(t,font)));
  set('--vp-pv-w',Math.max(w(mains.map(m=>providerOf(m.row)),'10px '+family),textWidth(uiText('voice_col_provider'),'600 9.5px '+family)+8,30)+2);
  set('--vp-vr-w',Math.min(98,Math.max(w(models.flatMap(m=>(m.role?uiText('voice_role_'+m.role):versionOf(m.entry)).split(' · ')),'10px '+family)+3,textWidth(uiText('voice_col_version'),'600 9.5px '+family)+8,40)));
  set('--vp-sz-w',Math.max(w(models.map(m=>m.entry?.mb?sizeText(m.entry.mb*1e6):'–'),'10px '+family)+2,textWidth(uiText('voice_col_size'),'600 9.5px '+family)+8,30));
  set('--vp-lg-w',Math.max(w(mains.flatMap(m=>codes(m.row)),'10px '+family)+3,textWidth(uiText('voice_col_language'),'600 9.5px '+family)+4,20));
  set('--vp-q-w',Math.max(w(models.map(m=>m.entry?.elo?String(m.entry.elo.elo):uiText('voice_elo_na')),'600 10.5px '+family)+3,textWidth(uiText('voice_col_quality'),'600 9.5px '+family)+8,16));
  set('--vp-yr-w',Math.max(textWidth('2026','10px '+family)+3,textWidth(uiText('voice_col_year'),'600 9.5px '+family)+8,26));
 };
 /* the head sits over the list: its right edge keeps the width of the list's scrollbar free, so the heads stay over their columns */
 const syncScrollbar=()=>{if(!open)return;const bar=Math.max(0,voices.offsetWidth-voices.clientWidth-2);head.style.paddingRight=(3+bar)+'px';};
 /* narrow menu: the details sit under the name; a name that needs two lines takes the whole row */
 const markLong=()=>{if(!open||!window.matchMedia?.('(max-width:420px)').matches)return;for(const r of voices.querySelectorAll('.vp-row:not([data-sub])')){const n=r.querySelector('.vp-nm');r.toggleAttribute('data-long',!!n&&n.getBoundingClientRect().height>14);}};
 const buildVoices=e=>{
  const list=modelsOf(e),hiId=markedId(e,list);
  /* view model per line: everything that is drawn, so the signature can not miss a state */
  const models=list.map(m=>{
   const {row,entry}=m,sys=row.system,downloading=!sys&&entry?.progress>=0,installed=!!entry?.installed&&!sys,queued=!sys&&!installed&&!downloading&&entry?.queued===true;
   return {...m,sys,downloading,queued,installed,hi:m.id===hiId,active:!!entry&&entryHas(entry,e.voiceId)&&(sys||entry.installed),sampling:!!entry&&sample.key===entry.id?sample.state:'',level:noveltyOf(entry?.released),fail:failKey===entry?.id,confirm:confirming===m.id&&installed};
  });
  const mode=listMode();
  if(!('hint' in countEl.dataset))countEl.textContent=uiText('voice_count',{shown:mode==='short'?models.length:e.rows.length,total:e.all.length});
  const sig=JSON.stringify([getLocale(),sortKey,sortDir,!!elo,e.detectedBase,e.current?.key,e.rows.length,mode,models.map(m=>[m.id,m.group,m.role,shown(m.row),m.row.family,m.row.bases.join(),m.entry?.id,m.entry?.tier,m.entry?.variant,m.entry?.mb,m.entry?.elo?.elo,m.installed?1:0,m.downloading?1:0,m.queued?1:0,m.hi?1:0,m.active?1:0,m.sampling,m.level,m.entry?.released,m.fail?1:0,m.confirm?1:0,!!m.entry?.sample,m.row.bases.length,m.entry?.recommended?1:0])]);
  /* A download reports its percentage up to 100 times: only the ring of the busy row changes, the other rows (and the one under the mouse) stay the same nodes. */
  const progress=models.filter(m=>m.downloading).map(m=>m.id+'='+m.entry.progress).join('|');
  if(sig===rowSignature){
   if(progress!==progressSignature){progressSignature=progress;for(const m of models){if(!m.downloading)continue;const state=voices.querySelector('.vp-row[data-id="'+CSS.escape(m.id)+'"] [data-st=busy]');if(!state)continue;
    const name=state.title.slice(0,Math.max(0,state.title.lastIndexOf(' · '))),t=uiText('model_downloading',{percent:m.entry.progress});state.style.setProperty('--p',String(m.entry.progress));state.setAttribute('aria-label',name+' · '+t);state.title=name+' · '+t;}}
   syncScrollbar();return;}
  rowSignature=sig;progressSignature=progress;
  const focused=shadow.activeElement,keep=focused&&voices.contains(focused)&&focused.dataset?.act?[focused.closest('.vp-row')?.dataset.id,focused.dataset.act]:null;
  const blocks=[];let block=null,group='';
  /* a group heading and the switch to the full list are rows of the grid as well (one cell each) */
  const textRow=(cls,text)=>{
   const r=el('div',cls),c=el('span','',text);
   r.setAttribute('role','row');c.setAttribute('role','gridcell');r.append(c);return r;
  };
  const moreRow=()=>{
   const r=el('div','vp-morerow'),c=el('div');
   r.setAttribute('role','row');c.setAttribute('role','gridcell');c.style.flex='1';
   const b=el('button','vp-more',uiText(showAll?'voice_show_fewer':'voice_show_all',{count:e.rows.length}));
   b.type='button';b.dataset.act='more';
   b.setAttribute('aria-expanded',String(showAll));b.setAttribute('aria-controls',ID+'-voices');
   c.append(b);r.append(c);return r;
  };
  for(let i=0;i<models.length;i++){
   const m=models[i],{row,entry,sub}=m,name=shown(row),size=entry?.mb?sizeText(entry.mb*1e6):'',tierName=tierLabel(entry),version=m.role?uiText('voice_role_'+m.role):versionOf(entry),subName=name+(version?' ('+version+')':'');
   if(m.group!==group){
    if(m.group==='all'&&mode!=='filtered')blocks.push(moreRow());
    else if(m.group!=='all')
     blocks.push(textRow('vp-gh',uiText(m.group==='rec'?'voice_group_recommended':'voice_group_device')));
    group=m.group;
   }
   const rowEl=el('div','vp-row');rowEl.setAttribute('role','row');rowEl.dataset.id=m.id;rowEl.dataset.row=row.key;rowEl.dataset.entry=entry?.id||'';if(sub)rowEl.dataset.sub='';if(m.active)rowEl.dataset.active='';
   const lg=el('span','vp-lg');if(!sub)for(const base of row.bases){const c=el('span','',base.toUpperCase().slice(0,2));if(base===e.detectedBase)c.dataset.det='';lg.append(c);}lg.setAttribute('aria-hidden','true');if(!sub&&row.bases.length>1)lg.title=uiText('voice_langs_title',{languages:row.bases.map(ownName).join(', ')});
   const play=iconButton('play',(m.sampling==='playing'?uiText('voice_sample_playing'):uiText('voice_sample'))+' · '+subName,m.sampling==='playing'?'stop':'play',m.hi);
   if(!entry?.sample){off(play);}
   play.setAttribute('aria-pressed',String(m.sampling==='playing'));if(m.sampling==='loading')play.setAttribute('aria-busy','true');if(m.fail)play.dataset.fail='';
   const opt=el('div','vp-opt');opt.id=ID+'-v'+i;opt.setAttribute('role','gridcell');opt.setAttribute('aria-selected',String(m.active));opt.dataset.key=m.id;const facts=metadataTip(entry);if(facts)opt.title=name+'\n'+facts;if(m.hi)opt.dataset.hi='';
   const tip=entry?.experimental||LEVEL[entry?.tier]?qualityTip(entry,tierName):'';
   /* ONE quality cell: the three bars (our level) with the arena Elo number (or a dash) below; experimental models look the same, "Experimental" stands in the version column */
   const ev=el('span','vp-elo',entry?.elo?String(entry.elo.elo):uiText('voice_elo_na'));if(!entry?.elo)ev.dataset.none='';
   const qb=bars3(),q=el('span','vp-q');q.setAttribute('aria-hidden','true');q.append(qb,ev);if(tip)q.title=tip;if(LEVEL[entry?.tier])q.dataset.level=String(LEVEL[entry.tier]);else qb.style.visibility='hidden';
   const nmw=el('span','vp-nmw'),vr=el('span','vp-vr',version.replace(' · ','\n'));if(version)vr.title=version;
   const meta=sub?version:[version,providerOf(row)].filter(Boolean).join(' · ');
   if(!sub){const nm=el('span','vp-nm',row.name);nm.title=name+(facts?'\n'+facts:'');nmw.append(nm);}else{const nm=el('span','vp-nm',row.name);nm.title=name+(version?' · '+version:'');nmw.append(nm);}   /* a lower version names its voice too, indented under the main row (a row of only size and level was not readable as a variant) */
   nmw.append(el('span','vp-meta',meta));
   opt.append(lg,q,nmw,vr);
   if(!sub){
    opt.append(el('span','vp-pv',providerOf(row)));
    const yr=el('span','vp-yr');if(m.level){yr.textContent=entry.released.slice(0,4);yr.dataset.level=String(m.level);const text=uiText('voice_released',{date:entry.released});yr.title=text;yr.setAttribute('aria-label',text);}
    opt.append(yr);
    opt.setAttribute('aria-label',[name,version,size,entry?.elo?'Elo '+entry.elo.elo:'',entry?.released?uiText('voice_released',{date:entry.released}):'',m.active?uiText('voice_in_use'):''].filter(Boolean).join(', '));
   }else{
    opt.append(el('span','vp-pv'),el('span','vp-yr'));vr.title=version+'\n'+uiText('voice_tier_sub')+(entry.recommended?' · '+uiText('model_recommended'):'');
    opt.setAttribute('aria-label',[subName,size,entry.elo?'Elo '+entry.elo.elo:'',m.active?uiText('voice_in_use'):''].filter(Boolean).join(', '));
   }
   /* ONE state button: download arrow / progress ring / trash */
   const rm=m.installed?removal(entry):{bytes:0,siblings:0,names:[]};
   let state;
   if(m.sys){state=iconButton('dl',uiText('voice_dl_done',{voice:row.name,tier:''}),'down',false);off(state);}
   else if(m.downloading){state=iconButton('dlx','','close',m.hi);state.dataset.st='busy';state.style.setProperty('--p',String(entry.progress));const t=uiText('model_downloading',{percent:entry.progress})+'\n'+uiText('voice_dl_cancel');state.setAttribute('aria-label',subName+' · '+t);state.title=subName+' · '+t;}
   else if(m.queued){state=iconButton('dlx','','wait',m.hi);state.append(icon('close'));state.dataset.st='wait';const t=uiText('voice_dl_waiting')+'\n'+uiText('voice_dl_cancel');state.setAttribute('aria-label',subName+' · '+t);state.title=subName+' · '+t;}
   else if(m.installed){const t=uiText('voice_remove',{voice:row.name,tier:version||tierName,size:sizeText(rm.bytes)})+(rm.siblings?'\n'+alsoText(rm):'');state=iconButton('del',t,'trash',m.hi);state.dataset.st='del';}
   else{const retry=tried.has(entry?.id),t=uiText(retry?'voice_retry':'voice_dl_get',{voice:name,tier:version||tierName,size});state=iconButton('dl',retry?t+' · '+subName+' · '+size:t,'down',m.hi);state.dataset.st='get';}
   const sz=el('span','vp-sz',size||'–');sz.setAttribute('role','gridcell');if(size)sz.title=size;else sz.setAttribute('aria-label',uiText('voice_size_none'));
   const cell=button=>{const c=el('span','vp-c');c.setAttribute('role','gridcell');c.append(button);return c;};
   rowEl.append(cell(state),sz,cell(play),opt);
   if(m.confirm){
    const box=el('div','vp-confirm');box.setAttribute('role','gridcell');const q2=uiText('voice_remove_q',{voice:row.name,tier:version||tierName,size:sizeText(rm.bytes)})+(rm.siblings?' '+alsoText(rm):'');box.setAttribute('aria-label',q2);
    const text=el('span','',q2);text.title=q2;const yes=el('button','',uiText('voice_remove_yes')),no=el('button','',uiText('model_cancel'));yes.type='button';no.type='button';yes.dataset.act='del-yes';no.dataset.act='del-no';box.append(text,yes,no);rowEl.append(box);
   }
   /* a voice is ONE block (main row plus all lower versions) between two divider lines */
   if(!sub){block=el('div','vp-voice');block.setAttribute('role','presentation');block.dataset.row=row.key;block.dataset.group=m.group;blocks.push(block);}
   block.append(rowEl);
  }
  /* blocks outside the visible part of the list are not laid out or painted (content-visibility); rows have fixed heights (30 px, lower versions 26 px, 1 px divider), so their reserved size is exact and the scroll bar does not jump */
  for(const b of blocks)if(b.classList.contains('vp-voice'))b.style.containIntrinsicSize='auto '+(1+30+26*(b.children.length-1))+'px';
  if(mode==='short')blocks.push(moreRow());
  if(!models.length&&mode!=='short')blocks.push(textRow('vp-empty',uiText('voice_no_results')));
  sizeColumns(models);
  /* the list keeps its scroll position through a rebuild (a download finishing, a click on a row): the rows outside the viewport are only laid out with an estimate (content-visibility), the browser's own clamping would move them */
  const keepTop=voices.scrollTop;voices.replaceChildren(...blocks);if(keepTop)voices.scrollTop=keepTop;markLong();syncScrollbar();
  const hi=voices.querySelector('.vp-opt[data-hi]');if(hi)grid.setAttribute('aria-activedescendant',hi.id);else grid.removeAttribute('aria-activedescendant');
  if(keep){const row=voices.querySelector('.vp-row[data-id="'+CSS.escape(keep[0])+'"]');let target=row&&(keep[1]==='dl'||keep[1]==='del'?row.querySelector('[data-act=dl]:not([data-off]),[data-act=del]'):row.querySelector('[data-act="'+keep[1]+'"]'));if(!target||target.dataset.off!==undefined||target.hasAttribute('aria-hidden'))target=voices.querySelector('.vp-confirm [data-act=del-no]')||grid;target.focus({preventScroll:true});}
 };
 /* The row in use (or the marked one) stands in the middle of the list when the panel opens, so the neighbours are visible. */
 const centerMarked=()=>{const row=voices.querySelector('.vp-opt[data-hi]')?.closest('.vp-row');if(row){const block=row.closest('.vp-voice');voices.scrollTop=Math.max(0,(block||row).offsetTop-Math.round((voices.clientHeight-row.offsetHeight)/2));}};
 const voiceNodes=()=>[...voices.querySelectorAll('.vp-opt')];
 const setHighlight=(id)=>{highlight=id;confirming='';rowSignature='';build();const node=voiceNodes().find(n=>n.dataset.key===id);if(node)node.scrollIntoView?.({block:'nearest'});};
 /* The language hint is one chip in the title row (fixed row height): nothing moves when it appears or goes. */
 const buildBanner=e=>{
  let text='',chip='',back=false;
  if(e.noVoiceForPage){text=uiText('voice_none_body',{language:uiName(e.detectedBase)});chip=uiText('voice_none_chip',{language:uiName(e.detectedBase)});}
  else if(e.pinnedOther){text=uiText('voice_lang_pinned_banner',{language:uiName(e.activeBase),page:uiName(e.detectedBase)});back=true;}
  else if(!e.auto){text=uiText('voice_lang_pinned',{language:uiName(e.activeBase)});back=true;}
  banner.hidden=!text;bannerText.textContent=text;banner.title=text;bannerChip.hidden=!chip;bannerChip.textContent=chip;bannerBack.hidden=!back;bannerBack.textContent='↺ '+uiText('automatic');bannerBack.title=text;bannerBack.setAttribute('aria-label',uiText('voice_back_auto')+(text?' · '+text:''));
 };
 /* Column heads: label, tooltip (full name + how to use), aria-sort and the arrow of the active column */
 const buildHead=()=>{
  head.setAttribute('aria-label',uiText('voice_sort_label'));headOpt.setAttribute('aria-label',uiText('voice'));headOpt.setAttribute('aria-sort',OPT_KEYS.has(sortKey)?(sortDir==='asc'?'ascending':'descending'):'none');headRow.querySelector('.vp-hc-play').setAttribute('aria-label',uiText('voice_sample'));{const c=head.querySelector('.vp-hc-play');let sr=c.querySelector('.vp-sr');if(!sr){sr=el('span','vp-sr');c.append(sr);}if(sr.textContent!==uiText('voice_sample'))sr.textContent=uiText('voice_sample');}
  for(const key of SORTS){const cell=headCells[key],b=cell.firstChild,on=key===sortKey,full=uiText('voice_sort_'+key),dirText=on?(sortDir==='asc'?' ↑':' ↓'):'';
   b.firstChild.textContent=uiText('voice_col_'+(key==='downloaded'?'loaded':key));b.title=full+dirText+'\n'+uiText('voice_sort_hint');b.setAttribute('aria-label',full);
   if(!OPT_KEYS.has(key))cell.setAttribute('aria-sort',on?(sortDir==='asc'?'ascending':'descending'):'none');b.toggleAttribute('data-on',on);b.setAttribute('aria-pressed',String(on));
   const mark=sortDir+key;if(b.lastChild.dataset.m!==(on?mark:'')){b.lastChild.dataset.m=on?mark:'';b.lastChild.replaceChildren(...(on?[icon(sortDir==='asc'?'asc':'desc')]:[]));}}
 };
 /* Filter row: the floating label "Filter" and the language dropdown (All, Automatic, every language of the catalog with its number of voices; the detected one marked) */
 const langItems=e=>{
  const langs=bases().map(b=>({code:b,text:ownName(b),det:b===e.detectedBase,count:e.all.filter(r=>r.bases.includes(b)).length})).filter(l=>l.count).sort((a,b)=>b.det-a.det||a.text.localeCompare(b.text,getLocale()));
  return {langs,items:[{v:'__auto',cmd:true,text:uiText('automatic'),sub:e.detectedBase?ownName(e.detectedBase):''},{v:'all',text:uiText('voice_filter_all'),count:e.all.length},...langs.map(l=>({v:l.code,text:l.text,count:l.count,det:l.det}))]};
 };
 const buildFilter=e=>{
  fieldLabel.textContent=uiText('voice_filter_field');search.setAttribute('aria-label',uiText('voice_filter_label'));search.title=uiText('voice_filter_hint');
  const {langs,items}=langItems(e);
  if(filter.lang!=='all'&&!langs.some(l=>l.code===filter.lang))filter.lang='all';
  const sig=JSON.stringify([getLocale(),items,filter.lang,langHi,langOpen]);
  if(sig!==filterSignature){filterSignature=sig;
   langMenu.setAttribute('aria-label',uiText('voice_filter_lang'));
   langMenu.replaceChildren(...items.flatMap(it=>{
    const node=el('div','vp-li');node.id=ID+'-l-'+it.v;node.dataset.v=it.v;node.setAttribute('role','option');
    const on=!it.cmd&&it.v===filter.lang;node.setAttribute('aria-selected',String(on));if(it.cmd)node.dataset.cmd='';if(it.v===langHi)node.dataset.hi='';
    node.append(el('span','vp-tick',on?'✓':''),el('span','vp-ln',it.text+(it.sub?' · '+it.sub:'')));
    if(it.det){const badge=el('span','vp-det',uiText('voice_detected_badge'));node.title=it.text+' · '+uiText('voice_detected_row');node.append(badge);}
    if(it.count!==undefined)node.append(el('span','vp-lcount',String(it.count)));
    if(it.cmd)node.title=uiText('voice_lang_auto',{language:it.sub||uiText('automatic')});
    node.setAttribute('aria-label',it.text+(it.sub?', '+it.sub:'')+(it.det?', '+uiText('voice_detected_row'):'')+(it.count!==undefined?', '+it.count:''));
    return it.v==='__auto'?[node,el('div','vp-lsep')]:[node];
   }));
  }
  const cur=filter.lang==='all'?uiText('voice_filter_all'):ownName(filter.lang);
  langText.textContent=cur;langBtn.setAttribute('aria-label',uiText('voice_filter_lang')+': '+cur);langBtn.title=uiText('voice_filter_lang')+': '+cur;langBtn.toggleAttribute('data-set',filter.lang!=='all');
  langBtn.setAttribute('aria-expanded',String(langOpen));langMenu.hidden=!langOpen;
  if(panel.hasAttribute('data-lang-open')!==langOpen){panel.toggleAttribute('data-lang-open',langOpen);requestAnimationFrame(()=>doPlace());}
  if(langOpen&&langHi)langMenu.setAttribute('aria-activedescendant',ID+'-l-'+langHi);else langMenu.removeAttribute('aria-activedescendant');
 };
 const build=()=>{
  if(!info||!open)return;
  const e=effective();
  titleText.textContent=uiText('voice_panel_title');grid.setAttribute('aria-label',uiText('voice_panel_title'));titleMode.textContent=uiText(e.auto?'voice_mode_auto':'voice_mode_fixed');panel.setAttribute('aria-label',uiText('languageVoice'));
  buildHead();buildFilter(e);
  const had=!notice.hidden;notice.hidden=!gpuKey;buildNotice();if(had===notice.hidden)requestAnimationFrame(()=>doPlace());
  buildBanner(e);buildVoices(e);
 };
 const render=()=>{if(!info)return;renderButton();build();};
 /* ---- open/close ---- */
 const doPlace=()=>{if(!open)return;markLong();voices.style.maxHeight='';place(menu,btn);const deficit=menu.scrollHeight-menu.clientHeight;if(deficit>0){voices.style.maxHeight=Math.max(66,voices.offsetHeight-deficit)+'px';place(menu,btn);}syncScrollbar();};
 const close=refocus=>{if(!open)return;closeLang(false);confirming='';pendingUse=null;stopSample(false);open=false;menu.removeAttribute('data-open');menu.removeAttribute('data-above');btn.setAttribute('aria-expanded','false');if(refocus)btn.focus();};
 /* Each opening follows the document language. A user-selected filter survives state refreshes until reopen/new document. */
 const detectedFilter=()=>{const detected=baseOf(info?.detected);return detected&&allRows().some(r=>r.bases.includes(detected))?detected:'all';};
 const openPanel=focus=>{
  if(!info)return;
  if(!open){languageChosen=false;filter.lang=detectedFilter();open=true;highlight='';confirming='';rowSignature='';filterSignature='';langOpen=false;loadRegistry();loadElo();build();menu.setAttribute('data-open','');btn.setAttribute('aria-expanded','true');doPlace();say('');centerMarked();}
  if(focus!==false)search.focus({preventScroll:true});
 };
 /* ---- sample ---- */
 /* The listening sample is a symbol state of the row's play button (play / stop / busy / failed): no text line, so nothing moves while it plays or ends. */
 const refreshRows=()=>{rowSignature='';if(open)build();try{onSample({key:sample.key,state:sample.state});}catch{}};
 const stopSample=()=>{if(sample.state==='idle'&&!sample.url)return;serial++;audio.onended=null;audio.onerror=null;try{audio.pause();audio.removeAttribute?.('src');audio.load?.();}catch{}if(sample.url){URL.revokeObjectURL(sample.url);sample.url='';}sample.state='idle';sample.key='';refreshRows();};
 const playSample=async(entry)=>{
  if(!entry?.sample)return;
  if(sample.state!=='idle'&&sample.key===entry.id){stopSample();return;}
  stopSample();const mine=++serial;sample.key=entry.id;sample.state='loading';refreshRows();
  const failed=()=>{if(mine!==serial)return;stopSample();failKey=entry.id;clearTimeout(failTimer);failTimer=setTimeout(()=>{failKey='';refreshRows();},2500);refreshRows();};
  try{
   if(isPlaying())send('toggle');                  // the reading is paused for the sample and not resumed afterwards: no surprise sound
   const blob=await fetchSample(sampleBase+entry.sample);if(mine!==serial)return;
   const level=getVolume(),volume=level.muted?0:Math.max(0,Math.min(1,(Number(level.volume)||0)/100));
   sample.url=URL.createObjectURL(blob);audio.src=sample.url;audio.volume=volume;audio.muted=level.muted===true||volume===0;
   audio.onended=()=>{if(mine===serial)stopSample();};audio.onerror=failed;
   await audio.play();if(mine!==serial)return;sample.state='playing';
  }catch{failed();}
  refreshRows();
 };
 /* ---- registry (lazy) ---- */
 let registryAsked=false;
 const loadElo=()=>{if(eloAsked||!eloUrl)return;eloAsked=true;fetch(eloUrl).then(r=>{if(!r.ok)throw new Error('elo');return r.json();}).then(raw=>{const data=cleanElo(raw);if(!data)return;elo=data;rowSignature='';render();}).catch(()=>{eloAsked=false;});};
 const loadRegistry=()=>{if(registryAsked||!registryUrl)return;registryAsked=true;import(registryUrl).then(module=>{reg=module;indexRegistry();if(open&&!languageChosen)filter.lang=detectedFilter();rowSignature='';filterSignature='';render();}).catch(()=>{registryAsked=false;});};
 /* ---- keyboard ---- */
 const typeahead=(key,names,current)=>{typed+=key.toLowerCase();clearTimeout(typedTimer);typedTimer=setTimeout(()=>{typed='';},600);const start=typed.length>1&&typed.split('').every(c=>c===typed[0])?typed[0]:typed;const order=names.map((name,i)=>[name.toLowerCase(),i]),after=[...order.slice(current+1),...order.slice(0,current+1)];const hit=after.find(([name])=>name.startsWith(start))||after.find(([name])=>name.startsWith(typed[0]));return hit?hit[1]:-1;};
 const printable=event=>event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key!==' ';
 const move=(event,count,index)=>event.key==='Home'?0:event.key==='End'?count-1:event.key==='PageDown'?Math.min(count-1,index+10):event.key==='PageUp'?Math.max(0,index-10):event.key==='ArrowDown'?Math.min(count-1,index+1):event.key==='ArrowUp'?Math.max(0,index-1):-1;
 /* filter changes: the list is rebuilt from the top, the result is announced */
 const refilter=()=>{highlight='';confirming='';rowSignature='';build();voices.scrollTop=0;const e=effective();say(uiText('voice_count',{shown:e.rows.length,total:e.all.length}));doPlace();};
 search.addEventListener('input',()=>{filter.text=search.value;refilter();});
 search.addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();grid.focus({preventScroll:true});}
  else if(event.key==='Escape'&&search.value){event.preventDefault();event.stopPropagation();search.value='';filter.text='';refilter();}
 });
 /* language dropdown: button + listbox; arrows move, Enter/Space choose, Escape closes only the menu. A language filters the list; "Automatic" makes the reading language follow the page again (and shows the voices of the detected language). */
 const closeLang=refocus=>{if(!langOpen)return;langOpen=false;langHi='';filterSignature='';build();if(refocus)langBtn.focus({preventScroll:true});};
 const openLang=()=>{if(!info)return;langOpen=true;langHi=filter.lang;filterSignature='';build();langMenu.focus({preventScroll:true});langMenu.querySelector('[data-hi]')?.scrollIntoView?.({block:'nearest'});};
 const chooseLang=value=>{
  if(value==='__auto'){const e=effective();commitLanguage('auto');filter.lang=e.detectedBase&&e.all.some(r=>r.bases.includes(e.detectedBase))?e.detectedBase:'all';}
  else filter.lang=value;
  languageChosen=true;
  langOpen=false;langHi='';filterSignature='';refilter();langBtn.focus({preventScroll:true});
 };
 langBtn.addEventListener('click',()=>{if(langOpen)closeLang(false);else openLang();});
 langBtn.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();openLang();}else if(event.key==='Escape'&&langOpen){event.preventDefault();event.stopPropagation();closeLang(true);}});
 langMenu.addEventListener('click',event=>{const node=event.target.closest?.('.vp-li');if(node)chooseLang(node.dataset.v);});
 langMenu.addEventListener('keydown',event=>{
  const values=[...langMenu.querySelectorAll('.vp-li')].map(n=>n.dataset.v),at=Math.max(0,values.indexOf(langHi)),to=event.key==='ArrowDown'?Math.min(values.length-1,at+1):event.key==='ArrowUp'?Math.max(0,at-1):event.key==='Home'?0:event.key==='End'?values.length-1:-1;
  if(to>=0){event.preventDefault();event.stopPropagation();langHi=values[to];filterSignature='';build();langMenu.querySelector('[data-hi]')?.scrollIntoView?.({block:'nearest'});}
  else if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();chooseLang(langHi||filter.lang);}
  else if(event.key==='Escape'||event.key==='Tab'){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();}closeLang(event.key==='Escape');}
 });
 panel.addEventListener('pointerdown',event=>{if(langOpen&&!langWrap.contains(event.target))closeLang(false);});
 /* Sorting = clicking a column head: first click sorts by it (natural direction), a second click reverses; remembered per browser profile. Arrow keys move between the heads. */
 const setSort=key=>{
  if(!SORTS.includes(key))return;
  if(key===sortKey)sortDir=sortDir==='asc'?'desc':'asc';else{sortKey=key;sortDir=NATURAL[key];}
  saveSort();highlight='';confirming='';rowSignature='';build();voices.scrollTop=0;
  say(uiText(sortDir==='asc'?'voice_sorted_asc':'voice_sorted_desc',{column:uiText('voice_sort_'+sortKey)}));
 };
 head.addEventListener('click',event=>{const b=event.target.closest?.('button[data-sort]');if(b)setSort(b.dataset.sort);});
 head.addEventListener('keydown',event=>{
  const buttons=[...head.querySelectorAll('button[data-sort]')],at=buttons.indexOf(shadow.activeElement),to=event.key==='ArrowRight'?Math.min(buttons.length-1,at+1):event.key==='ArrowLeft'?Math.max(0,at-1):event.key==='Home'?0:event.key==='End'?buttons.length-1:-1;
  if(at<0||to<0)return;event.preventDefault();for(const b of buttons)b.tabIndex=-1;buttons[to].tabIndex=0;buttons[to].focus({preventScroll:true});
 });
 /* Use what a line stands for if it is on the device; otherwise only name the way to get it (the arrow is the consent to download). */
 const chooseLine=(t,e)=>{
  if(!t)return;
  /* a click on the voice that is already in use (chosen automatically for the language) is still an explicit choice: it is stored, so a voice installed
     later never takes its place; the session keeps playing (the same voice does not rebuild the pipeline) */
  if(t.entry.installed||t.row.system)useEntry(t.row,t.entry);
  else{const text=uiText('voice_get',{voice:shown(t.row),mb:t.entry.mb});say(text);flash(text);}
 };
 grid.addEventListener('keydown',event=>{
  if(!event.isTrusted)return;   // same for synthetic keys (Enter starts/downloads the marked voice)
  if(event.target!==grid)return;                // keys on a row button belong to that button (Enter/Space activate it)
  const e=effective(),list=modelsOf(e),id=markedId(e,list),nodes=voiceNodes(),index=Math.max(0,nodes.findIndex(n=>n.dataset.key===id));
  const target=move(event,nodes.length,index);
  if(target>=0){event.preventDefault();setHighlight(nodes[target].dataset.key);return;}
  if(event.key==='Enter'||event.key===' '){event.preventDefault();const t=lookup(id,e);if(!t)return;
   if(t.entry.installed||t.row.system)chooseLine(t,e);else{voices.querySelector('.vp-row[data-id="'+CSS.escape(id)+'"] [data-act=dl]:not([data-off])')?.focus({preventScroll:true});say(uiText('voice_get',{voice:shown(t.row),mb:t.entry.mb}));}}
  else if(event.key==='Delete'){const t=lookup(id,e);if(t&&!t.row.system&&t.entry.installed){event.preventDefault();askRemove(id);}}
  else if(printable(event)){event.preventDefault();const mains=nodes.filter(n=>!n.closest('.vp-row').hasAttribute('data-sub')),at=Math.max(0,mains.findIndex(n=>n.dataset.key===keyOfId(id))),hit=typeahead(event.key,mains.map(n=>n.querySelector('.vp-nm').textContent),at);if(hit>=0)setHighlight(mains[hit].dataset.key);}
 });
 const askRemove=id=>{highlight=id;confirming=id;rowSignature='';build();voices.querySelector('.vp-confirm [data-act=del-no]')?.focus({preventScroll:true});};
 /* Row buttons: play sample, remove (two steps, the second click must be a real user click), download. */
 const rowAction=(act,id,event)=>{
  const e=effective(),sel='.vp-row[data-id="'+CSS.escape(id)+'"] ';
  if(act==='del-no'){confirming='';rowSignature='';build();voices.querySelector(sel+'[data-act=del]')?.focus({preventScroll:true});return;}
  const t=lookup(id,e);if(!t)return;const {row,entry}=t;
  if(highlight!==id){highlight=id;confirming=act==='del-yes'?id:'';rowSignature='';build();}
  if(act==='play')playSample(entry);
  else if(act==='dlx'){if(entry.installed||row.system)return;if(pendingUse&&pendingUse.id===entry.id)pendingUse=null;send('cancelDownload',entry.id);say(uiText('voice_dl_cancelled',{voice:shown(row)}));rowSignature='';build();}
  else if(act==='dl'){if(entry.installed||entry.progress>=0||entry.queued||row.system)return;tried.add(entry.id);send('downloadVoice',entry.id);say(uiText('voice_dl_queued',{voice:shown(row)}));rowSignature='';build();}
  else if(act==='del'){if(entry.installed&&!row.system)askRemove(id);}
  else if(act==='del-yes'){if(!event.isTrusted||!entry.installed)return;const r=removal(entry);confirming='';send('removeVoice',entry.id);say(uiText('voice_removed',{voice:shown(row),size:sizeText(r.bytes)})+(r.siblings?' '+alsoText(r):''));rowSignature='';build();grid.focus({preventScroll:true});}
 };
 /* ONE click target per row: the voice cell, but a click on the size, the version or the gaps of the row counts as a click on the voice too (a row is one thing, nothing in it selects text). */
 const rowVoice=target=>{
  const cell=target.closest?.('.vp-opt');if(cell)return cell;
  const rowEl=target.closest?.('.vp-row');if(!rowEl||target.closest?.('.vp-confirm'))return null;
  return rowEl.querySelector('.vp-opt');
 };
 /* A double click on a voice that is not on the device downloads it and uses it as soon as it is there: one gesture instead of arrow, wait, row.
    The second press of the double click is caught by the click counting (detail), because the list is rebuilt after the first press and the browser
    then no longer reports a dblclick for the new node. */
 const startVoice=id=>{
  const e=effective(),t=lookup(id,e);if(!t)return;const {row,entry}=t;
  if(entry.installed||row.system){useEntry(row,entry);return;}
  if(entry.progress>=0||entry.queued)return;                       /* already on its way: the ring shows it */
  tried.add(entry.id);pendingUse={id:entry.id,at:now().getTime()};
  send('downloadVoice',entry.id);
  const text=uiText('voice_dl_queued',{voice:shown(row)});say(text);flash(text);
  rowSignature='';build();
 };
 voices.addEventListener('click',event=>{
  if(!event.isTrusted)return;   // the list lives in the page's DOM: a page script's synthetic click must not start downloads (hundreds of MB) or change the voice (code review 2.5.5, R4); own code never clicks in here
  const button=event.target.closest?.('button[data-act]');
  if(button?.dataset.act==='more'){
   showAll=!showAll;saveShowAll();highlight='';rowSignature='';build();doPlace();
   voices.querySelector('.vp-more')?.focus({preventScroll:true});
   say(uiText(showAll?'voice_show_fewer':'voice_show_all',{count:effective().rows.length}));return;
  }
  if(button){const rowEl=button.closest('.vp-row');if(rowEl&&button.getAttribute('aria-disabled')!=='true')rowAction(button.dataset.act,rowEl.dataset.id,event);return;}
  const cell=rowVoice(event.target);if(!cell)return;
  const e=effective(),id=cell.dataset.key;
  if(event.detail>1){startVoice(id);return;}                        /* the second press of a double click (the first one already marked the row) */
  setHighlight(id);grid.focus({preventScroll:true});chooseLine(lookup(id,e),e);
 });
 const playMarked=()=>{const e=effective(),t=lookup(markedId(e,modelsOf(e)),e);if(t)playSample(t.entry);};
 bannerBack.addEventListener('click',()=>{commitLanguage('auto');});
 btn.addEventListener('click',event=>{if(!info)return;if(open)close(false);else openPanel(event.detail===0);});
 btn.addEventListener('keydown',event=>{
  if(!info)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();openPanel(true);}
  else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);}
 });
 menu.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!event.defaultPrevented&&confirming){event.preventDefault();event.stopPropagation();rowAction('del-no',confirming,event);return;}
  if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();close(true);return;}
  if(event.key==='Tab'&&!event.altKey&&!event.ctrlKey&&!event.metaKey){
   const usable=n=>n.tabIndex>=0&&!n.disabled&&!n.closest('[hidden],[aria-hidden=true]')&&n.getClientRects().length;
   const stops=[...panel.querySelectorAll('button,input,[tabindex]')].filter(usable);
   const at=stops.indexOf(shadow.activeElement);
   if(stops.length){
    const to=event.shiftKey?(at<=0?stops.length-1:at-1):(at<0||at===stops.length-1?0:at+1);
    event.preventDefault();event.stopPropagation();stops[to].focus({preventScroll:true});return;
   }
  }
  if((event.key==='p'||event.key==='P')&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.defaultPrevented&&!filterBar.contains(shadow.activeElement)&&shadow.activeElement!==grid&&!head.contains(shadow.activeElement)){event.preventDefault();playMarked();}
  if(!event.altKey)event.stopPropagation();
 });
 menu.addEventListener('pointerdown',event=>event.stopPropagation());
 menu.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
 if(settingsToggle)settingsToggle.addEventListener('click',()=>close(false));
 listen(document,'pointerdown',event=>{if(open&&!event.composedPath().includes(wrap))close(false);},true);
 disposers.push(()=>{clearTimeout(choiceTimer);clearTimeout(typedTimer);serial++;try{audio.pause();}catch{}if(sample.url)URL.revokeObjectURL(sample.url);});
 void loadSort();void loadShowAll();
 return {
  refreshLocale(){filterSignature='';rowSignature='';render();if(open)doPlace();},
  open(){openPanel(true);},
  place:doPlace,
  /* the voice card's "Play sample": the same shipped recording and player as the row button (a second call stops it) */
  previewSample(voice){
   if(!voice?.sample||typeof voice.id!=='string')return false;
   void playSample({id:voice.id,sample:voice.sample});return true;
  },
  /* keyboard cycling (Alt+Shift+1/2/3/4): next voice / language without opening the panel; returns the name for the status line */
  cycleVoice(direction){
   if(!info)return null;const e=effective(),rows=e.all.filter(r=>r.bases.includes(e.activeBase)&&(r.system||entriesOf(r).some(x=>x.installed)));if(rows.length<2)return null;
   const at=Math.max(0,rows.findIndex(r=>r.key===e.current?.key)),row=rows[(at+direction+rows.length)%rows.length],entry=row.system?row.entry:best(row,e.entry?.tier);
   if(!entry)return null;useEntry(row,entry);return shown(row);
  },
  cycleLanguage(direction){
   if(!info)return null;const e=effective(),codes=['auto',...bases()],current=e.auto?'auto':e.activeBase,target=codes[(codes.indexOf(current)+direction+codes.length)%codes.length];
   commitLanguage(target);return target==='auto'?uiText('automatic'):ownName(target);
  },
  update(message){
   const catalog=clean(message.catalog);if(!catalog.length)return;
   const language=typeof message.language==='string'&&LANG_RE.test(message.language)?message.language:(info?.language||'auto');
   const oldDetected=info?.detected,oldDocument=info?.documentId;
   info={catalog,language,documentId:typeof message.documentId==='string'?message.documentId:'',detected:typeof message.detectedLanguage==='string'&&LANG_RE.test(message.detectedLanguage)?message.detectedLanguage:null,active:typeof message.activeLanguage==='string'&&LANG_RE.test(message.activeLanguage)?message.activeLanguage:null,voice:typeof message.voice==='string'&&ID_RE.test(message.voice)?message.voice:null,voiceLabel:typeof message.voiceLabel==='string'?message.voiceLabel.slice(0,60):''};
   if(oldDocument!==info.documentId)languageChosen=false;
   if(pendingUse){
    const want=pendingUse.id,entry=[...allRows()].flatMap(row=>entriesOf(row).map(en=>({row,en}))).find(x=>x.en.id===want&&x.en.installed&&!x.row.system);
    if(entry){pendingUse=null;useEntry(entry.row,entry.en);}
    else if(now().getTime()-pendingUse.at>300000)pendingUse=null;
   }
   if(open&&(!languageChosen||oldDocument!==info.documentId)&&(oldDetected!==info.detected||oldDocument!==info.documentId)){filter.lang=detectedFilter();rowSignature='';filterSignature='';}
   if(choice){const done=(choice.language===undefined||choice.language===info.language)&&(!choice.voice||choice.voice.id===info.voice);if(done){choice=null;clearTimeout(choiceTimer);}}
   gpuKey=['gpu_missing','jspi_missing','gpu_failed'].includes(message.statusKey)?message.statusKey:'';
   if(!reg)loadRegistry();if(!elo)loadElo();render();
  },
  state(){return {open,info,highlight,sortKey,filter:{...filter},sample:{...sample,audio:undefined},live};},
 };
}
