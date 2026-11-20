import {createVoicePicker} from './voice-picker.mjs';
import {installReaderScrollbars} from './scrollbars.mjs';
import {createSpeechControls} from './session/speech-controls.mjs';
import {mountSharedSettings,createSettingsSelect,settingsPanelMarkup,createKeyboardSettingsRow,createSettingsSwitch} from './session/shared-settings.mjs';
import {createDownloadMenu,DOWNLOAD_MENU_CSS} from './session/download-menu.mjs';
// One original Paper/Green player renderer for native documents, Focus and Popup.
// Self-contained by design: the native bridge serializes this exact function.
// Where the voice picker finds the voice register and the listening samples (module-relative; the function itself must not use import.meta, the native bridge serializes it).
const VOICE_PICKER_URLS={registry:new URL('./tools/reader/neural-models.js',import.meta.url).href,elo:new URL('./tools/reader/voice-elo.json',import.meta.url).href,samples:new URL('./',import.meta.url).href};
export function mountPlayerSurface({mount,variant='overlay',settingsMode='popover',settingsScope=settingsMode==='inline'?'document':'all',initialLocale=null,locales,formattingFactory,appearanceFactory=null,appearanceController=null,onCommand=()=>{},onClose=()=>{},onSelection=()=>false,onLayout=()=>{},onLocalChange=()=>{},shadow:providedShadow=null,managed=true,ownPage=variant==='popup',keyboardActions={},onKeyboardChange=()=>{},onKeyboardSettings=null}={}) {
  if(!mount||!locales?.messages||typeof formattingFactory!=='function')throw new TypeError('Player surface requires mount, locales and formattingFactory');
  // English is the fallback of every text; the owner passes its UI language so the first paint is not in a foreign one.
  let uiLocale=typeof initialLocale==='string'&&locales.messages[initialLocale]?initialLocale:'en',formatNumber=value=>String(value),destroyed=false,polish=null,latest={},playing=false,followChoice=null,clickSeekChoice=null,speedChoice=null,lastPreferenceVersion=-1,localPosition={x:.5,y:1},dragging=null;
  const uiText=(key,args={})=>(locales.messages[uiLocale]?.[key]||locales.messages.en?.[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(args[k]??''));
  const host=providedShadow?providedShadow.host:document.createElement('div');
  if(!providedShadow){host.dataset.notableReaderSurface=variant;host.style.cssText=variant==='popup'?'display:block;position:relative;min-width:0;':'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';mount.append(host);}
  const shadow=providedShadow||host.attachShadow({mode:'open'}),disposers=[];let ownsAppearance=false;
  if(!appearanceController&&typeof appearanceFactory==='function'){ownsAppearance=true;appearanceController=appearanceFactory({document,kind:'html',uiHost:host,contentRoot:document.createElement('div'),onStatus:info=>polish?.appearanceStatus(info)});}
  const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);disposers.push(()=>target.removeEventListener(type,fn,options));};
  const send=(command,value)=>{if(!destroyed)onCommand(command,value);};
  const systemTheme=matchMedia('(prefers-color-scheme:dark)');let playerTheme='system',hiddenDisplay=null,overlayColors={light:null,dark:null};
  const applyPlayerTheme=value=>{playerTheme=['system','light','dark'].includes(value)?value:'system';const dark=playerTheme==='dark'||playerTheme==='system'&&systemTheme.matches;const colors=dark?{paper:'#1c1f1d',ink:'#e8eee8',muted:'#a0aca2',line:'#414c43',soft:'#272b28',accent:'#a5d3b3','on-accent':'#173020',shadow:'0 12px 44px #0006'}:{paper:'#ffffff',ink:'#000000',muted:'#4d554f',line:'#dfe4df',soft:'#f5f6f3',accent:'#256249','on-accent':'#ffffff',shadow:'0 12px 44px #172c2426'};const custom=overlayColors[dark?'dark':'light'];for(const [key,color]of Object.entries(custom?{...colors,...custom}:colors))host.style.setProperty('--reader-'+key,color);host.dataset.overlayCustom=custom?'true':'false';host.style.setProperty('color-scheme',dark?'dark':'light');host.dataset.playerTheme=playerTheme;};
  const setOverlayColors=value=>{const clean=side=>{const v=value?.[side];if(!v||typeof v!=='object')return null;const out={};for(const key of ['paper','ink','muted','line','soft','accent','on-accent'])if(typeof v[key]==='string'&&/^#[0-9a-f]{6}$/i.test(v[key]))out[key]=v[key];return Object.keys(out).length?out:null;};overlayColors={light:clean('light'),dark:clean('dark')};applyPlayerTheme(playerTheme);};
  const themeChanged=()=>{if(playerTheme==='system')applyPlayerTheme('system');};systemTheme.addEventListener('change',themeChanged);disposers.push(()=>systemTheme.removeEventListener('change',themeChanged));applyPlayerTheme('system');
  const getActualVisible=()=>{if(destroyed||!host.isConnected||!bar.isConnected)return false;const r=bar.getBoundingClientRect();if(typeof bar.checkVisibility==='function'&&!bar.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;return getComputedStyle(host).display!=='none'&&getComputedStyle(host).visibility!=='hidden'&&getComputedStyle(bar).visibility!=='hidden'&&bar.getClientRects().length>0&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;};
  const setVisibility=visible=>{if(typeof visible!=='boolean')return getActualVisible();if(!visible){polish?.closePopovers();if(hiddenDisplay===null)hiddenDisplay={value:bar.style.getPropertyValue('display'),priority:bar.style.getPropertyPriority('display')};bar.style.setProperty('display','none','important');}else{if(hiddenDisplay){if(hiddenDisplay.value)bar.style.setProperty('display',hiddenDisplay.value,hiddenDisplay.priority);else bar.style.removeProperty('display');hiddenDisplay=null;}refreshLayout();}return getActualVisible();};
  // One placement rule for every dropdown/popover: anchored to its own trigger. Left edge = trigger left edge
  // (clamped 12px into the viewport), below the trigger when it fits or has more room, else above; height limited
  // to the free space (inner scroll via fit), never over the trigger.
  const anchorPanel=(panel,trigger,{width,cap,min=60,fit,important=false,preferAbove=false,clear=null})=>{
    if(bar.dataset.overlayMode==='light'&&panel.matches('.speed-pop,.vol-pop')&&!panel.matches('.settings-pop'))width=Math.min(width,260);
    /* a trigger without a box (the compact bar's hidden voice button, opened from More or by shortcut) anchors at More, else at the bar */
    let r=trigger.getBoundingClientRect();if(!r.width&&!r.height){const more=shadow.querySelector('.more-toggle');r=(more&&more.getBoundingClientRect().width?more:bar).getBoundingClientRect();}
    const top=Math.min(r.top,clear?clear.getBoundingClientRect().top:r.top),bottom=r.bottom,w=Math.max(0,Math.min(width,innerWidth-24)),gap=6,below=innerHeight-bottom-gap-12,above=top-gap-12,room=Math.max(min,Math.min(cap,Math.max(below,above)));
    panel.style.width=w+'px';fit(room);const h=panel.getBoundingClientRect().height,down=!(preferAbove&&above>=h)&&(below>=h||below>=above),set=(k,v)=>important?panel.style.setProperty(k,v,'important'):panel.style.setProperty(k,v);
    set('left',Math.max(12,Math.min(innerWidth-w-12,r.left))+'px');set('top',(down?bottom+gap:Math.max(6,top-h-gap))+'px');panel.toggleAttribute('data-above',!down);
  };
  const placeExtras=[];
  /*KEYBOARD-BEGIN*/
  // Keyboard layer. One table (KEYMAP) drives the dispatcher, the tooltips / aria-keyshortcuts and the help panel.
  // Chord = Alt+Shift (Mac: Option+Shift) + the PHYSICAL key (event.code): layout, AltGr and Mac Option characters do not matter.
  // Textually identical in both player surfaces; tests/keyboard-sync.test.mjs keeps the two copies equal.
  let kb=null;
  function createKeyboard({shadow,bar,uiText,icon,ownPage,extra,isHidden,actions,onEnabled,onSettings}) {
    // [id, code, group, text key, scope]; scope 'file' = only where the page supplies its own action (file view).
    const KEYMAP=[
      ['playPause','KeyK','Playback','kbPlayPause'],
      ['previousSection','ArrowLeft','Navigation','kbPreviousSection'],['nextSection','ArrowRight','Navigation','kbNextSection'],['previousBlock','PageUp','Navigation','kbPreviousBlock'],['nextBlock','PageDown','Navigation','kbNextBlock'],
      ['previousChapter','Home','Navigation','kbPreviousChapter'],['nextChapter','End','Navigation','kbNextChapter'],['seekBack','KeyJ','Navigation','kbSeekBack'],['seekForward','KeyL','Navigation','kbSeekForward'],
      ['volumeUp','ArrowUp','Sound','kbVolumeUp'],['volumeDown','ArrowDown','Sound','kbVolumeDown'],['mute','KeyM','Sound','kbMute'],['speedDown','Comma','Sound','kbSpeedDown'],['speedUp','Period','Sound','kbSpeedUp'],
      ['voiceMenu','KeyN','Voice','kbVoiceMenu'],['voicePrev','Digit1','Voice','kbVoicePrev'],['voiceNext','Digit2','Voice','kbVoiceNext'],['languagePrev','Digit3','Voice','kbLanguagePrev'],['languageNext','Digit4','Voice','kbLanguageNext'],
      ['theme','KeyD','View','kbTheme'],['focus','KeyF','View','kbFocus'],['follow','KeyW','View','kbFollow'],['clickSeek','KeyC','View','kbClickSeek'],
      ['settings','KeyE','Dialogs','kbSettings'],['uiLanguage','KeyU','Dialogs','kbUiLanguage'],['export','KeyX','Dialogs','kbExport'],['openFile','KeyO','Dialogs','kbOpenFile','file'],['help','KeyH','Dialogs','kbHelp'],['close','KeyQ','Dialogs','kbClose']
    ];
    const GROUPS=[['Playback','kbGroupPlayback'],['Navigation','kbGroupNavigation'],['Sound','kbGroupSound'],['Voice','kbGroupVoice'],['View','kbGroupView'],['Dialogs','kbGroupDialogs']];
    const REPEAT=new Set(['volumeUp','volumeDown','speedDown','speedUp','seekBack','seekForward','previousSection','nextSection']);
    const SPOKEN=new Set(['previousSection','nextSection','previousBlock','nextBlock','previousChapter','nextChapter','seekBack','seekForward']);
    // Elements whose tooltip names their shortcut(s): [selector, ids].
    const DECOR=[['.primary',['playPause']],['.previous-section',['previousSection']],['.next-section',['nextSection']],['.speed-trigger',['speedDown','speedUp']],['.chapter-trigger',['previousChapter','nextChapter']],['.seek-progress',['seekBack','seekForward']],['.vol-btn',['volumeDown','volumeUp']],['.vol-mute',['mute']],['.voice-btn',['voiceMenu','voicePrev','voiceNext']],['.follow',['follow']],['.select-text',['clickSeek']],['.theme-toggle',['theme']],['.focus-toggle',['focus']],['.download-trigger',['export']],['.settingsToggle',['settings']],['.closeReader',['close']],['.ui-language-trigger',['uiLanguage']],['.kb-help-open',['help']]];
    const PROBE={close:'.closeReader',focus:'.focus-toggle',theme:'.theme-toggle'};
    const available=id=>{const selector=PROBE[id];if(!selector)return true;const element=shadow.querySelector(selector);if(!element)return false;return !element.hidden&&getComputedStyle(element).display!=='none';};
    const byId=new Map(KEYMAP.map(entry=>[entry[0],entry]));let custom={},byCombo=new Map();   // custom = the user's own assignments (id -> combination), everything else keeps Alt+Shift+<default key>; combination = 'Mod+Alt+Shift+<event.code>' (Mod = Cmd on a Mac, Ctrl elsewhere), see platform/keycombo.mjs
    const nav=globalThis.navigator,mac=/mac|iphone|ipad/i.test(String(nav?.userAgentData?.platform||nav?.platform||''));
    const NAMES={ArrowLeft:['←','ArrowLeft'],ArrowRight:['→','ArrowRight'],ArrowUp:['↑','ArrowUp'],ArrowDown:['↓','ArrowDown'],PageUp:['PgUp','PageUp'],PageDown:['PgDn','PageDown'],Home:['Home','Home'],End:['End','End'],Enter:['Enter','Enter']};
    let layout=null,enabled=true,destroyed=false;const cleanups=[],switches=[];
    const PUNCT={Comma:',',Period:'.',Slash:'/',Semicolon:';',Quote:"'",Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Backquote:'`'};
    const keyName=code=>{if(NAMES[code])return NAMES[code];const raw=/^Key([A-Z])$/.exec(code)?.[1]||/^Digit(\d)$/.exec(code)?.[1]||PUNCT[code]||code,shown=layout?.get?.(code);return [typeof shown==='string'&&shown.length===1?shown.toUpperCase():raw,raw];};
    const comboOf=id=>custom[id]||'Alt+Shift+'+byId.get(id)[1];
    const fmt=(combo,forAria)=>{const parts=combo.split('+'),code=parts.pop(),[shown,raw]=keyName(code);if(forAria)return [...parts.map(m=>m==='Mod'?(mac?'Meta':'Control'):m),raw].join('+');return mac?parts.map(m=>({Mod:'⌘',Alt:'⌥',Shift:'⇧'}[m])).join('')+shown:[...parts.map(m=>m==='Mod'?'Ctrl':m),shown].join('+');};
    // A combination is only accepted when it cannot fire while typing: it holds Mod or Alt, or it is a key that is no text key (F13-F24, media keys).
    const safeCombo=c=>typeof c==='string'&&c.length<40&&(/^(?:Mod\+|Alt\+)(?:Mod\+)?(?:Alt\+)?(?:Shift\+)?(?:Key[A-Z]|Digit\d|Arrow(?:Left|Right|Up|Down)|Page(?:Up|Down)|Home|End|Comma|Period|Slash|Semicolon|Quote|Minus|Equal|Bracket(?:Left|Right)|Backslash|Backquote|F(?:[1-9]|1[0-2]))$/.test(c)||/^(?:F1[3-9]|F2[0-4]|MediaPlayPause|MediaTrackNext|MediaTrackPrevious|MediaStop)$/.test(c));
    const rebuild=()=>{byCombo=new Map();for(const entry of KEYMAP){const c=comboOf(entry[0]);if(!byCombo.has(c))byCombo.set(c,entry);}};rebuild();
    // Event -> combination. Same rules for the dispatcher and for recording: AltGr (Ctrl+Alt on Windows) never counts; on a Mac Ctrl and on PCs the Windows/Super key are not part of a combination.
    const comboFromEvent=event=>{if(/^(?:Shift|Control|Alt|Meta|OS|AltGraph)(?:Left|Right)?$/.test(event.code))return null;if(event.getModifierState?.('AltGraph'))return null;if(mac?event.ctrlKey:event.metaKey)return null;return [(mac?event.metaKey:event.ctrlKey)&&'Mod',event.altKey&&'Alt',event.shiftKey&&'Shift'].filter(Boolean).concat(event.code).join('+');};
    const label=entry=>fmt(comboOf(entry[0]),false);
    const aria=entry=>fmt(comboOf(entry[0]),true);
    const listed=id=>{const entry=byId.get(id);return !!entry&&(!entry[4]||typeof extra[id]==='function')&&available(id);};
    const usable=id=>enabled&&listed(id);
    const hint=ids=>{const own=ids.filter(usable);return own.length?' ('+own.map(id=>label(byId.get(id))).join(' / ')+')':'';};
    const idsFor=element=>{for(const [selector,ids] of DECOR)if(element.matches(selector))return ids;return null;};
    const decorate=element=>{
      const ids=idsFor(element);if(!ids)return;const title=element.getAttribute('title');if(title===null)return;
      const previous=element.dataset.kbHint||'',now=hint(ids),base=previous&&title.endsWith(previous)?title.slice(0,-previous.length):title,next=base+now;
      if(title!==next)element.setAttribute('title',next);
      if(now)element.dataset.kbHint=now;else delete element.dataset.kbHint;
      const keys=ids.filter(usable).map(id=>aria(byId.get(id))).join(' ');if(keys)element.setAttribute('aria-keyshortcuts',keys);else element.removeAttribute('aria-keyshortcuts');
    };
    const applyAll=()=>{if(destroyed)return;for(const [selector] of DECOR)for(const element of shadow.querySelectorAll(selector))decorate(element);};
    const observer=new MutationObserver(records=>{for(const record of records)if(record.target.nodeType===1)decorate(record.target);});
    observer.observe(bar,{subtree:true,attributes:true,attributeFilter:['title']});cleanups.push(()=>observer.disconnect());
    // Screen-reader feedback for key actions (visually hidden, no layout effect).
    const region=document.createElement('div');region.className='kb-announce';region.setAttribute('role','status');region.setAttribute('aria-live','polite');region.setAttribute('aria-atomic','true');bar.append(region);let spoken=0;
    const announce=text=>{clearTimeout(spoken);region.textContent='';spoken=setTimeout(()=>{region.textContent=String(text||'');},30);};cleanups.push(()=>clearTimeout(spoken));
    // The switch persists per browser profile (extension storage, else localStorage) and is shared live by every surface.
    const KEY='notableShortcuts',store=globalThis.chrome?.storage?.local||null;
    const persist=value=>{if(onSettings){onSettings({enabled:value,keys:{...custom}});return;}try{if(store)void store.set({[KEY]:value}).catch?.(()=>{});else localStorage.setItem('notable-reader-shortcuts',value?'on':'off');}catch{}};
    const restore=async()=>{try{if(store)return (await store.get(KEY))[KEY]!==false;return localStorage.getItem('notable-reader-shortcuts')!=='off';}catch{return true;}};
    const syncSwitches=()=>{for(const node of switches){node.setAttribute('aria-checked',String(enabled));}};
    const setEnabled=(value,save=true)=>{value=value!==false;if(enabled===value)return;enabled=value;if(!enabled)stopRecorder();if(save)persist(value);syncSwitches();applyAll();onEnabled?.(value);if(save)announce(uiText(value?'kbAnnounceOn':'kbAnnounceOff'));};
    if(!onSettings)void restore().then(value=>{if(!destroyed&&value!==enabled)setEnabled(value,false);});
    if(!onSettings)try{const listener=(changes,area)=>{if(area==='local'&&changes?.[KEY])setEnabled(changes[KEY].newValue!==false,false);};globalThis.chrome?.storage?.onChanged?.addListener(listener);cleanups.push(()=>globalThis.chrome?.storage?.onChanged?.removeListener(listener));}catch{}
    try{void nav?.keyboard?.getLayoutMap?.().then(map=>{layout=map;applyAll();}).catch(()=>{});}catch{}
    // Settings row (switch + help button). Each surface decides where it goes.
    const settingsRow=()=>{const rows=createKeyboardSettingsRow({document,t:uiText,enabled,onEnabled:value=>setEnabled(value),onHelp:()=>toggleHelp(true)});switches.push(rows[0].querySelector('.kb-switch'));return rows;};
    // Help panel: same tokens as the other panels, rebuilt on every open (language, platform, availability).
    const help=document.createElement('div');help.className='kb-help';help.setAttribute('role','dialog');help.setAttribute('aria-modal','false');help.setAttribute('aria-labelledby','kb-help-title');help.tabIndex=-1;help.hidden=true;bar.append(help);
    let helpOpen=false,helpReturn=null,helpContent=null;
    const mod=()=>mac?'⌥⇧':'Alt+Shift';
    const buildHelp=()=>{
      const content=document.createElement('div');content.className='kb-help-content';
      const head=document.createElement('div');head.className='kb-help-head';const title=document.createElement('h2');title.id='kb-help-title';title.textContent=uiText('kbHelpTitle');const close=document.createElement('button');close.type='button';close.className='kb-help-close';close.innerHTML=icon('close');close.title=uiText('closeMessage');close.setAttribute('aria-label',uiText('closeMessage'));close.addEventListener('click',()=>toggleHelp(false));head.append(title,close);
      const intro=document.createElement('p');intro.textContent=uiText('kbHelpIntro',{mod:mod()})+(enabled?'':' · '+uiText('kbAnnounceOff'));
      const grid=document.createElement('div');grid.className='kb-help-groups';
      for(const [group,key] of GROUPS){const entries=KEYMAP.filter(entry=>entry[2]===group&&listed(entry[0]));if(!entries.length)continue;const section=document.createElement('section');section.className='kb-help-group';const h=document.createElement('h3');h.textContent=uiText(key);const list=document.createElement('ul');for(const entry of entries){const li=document.createElement('li');const text=document.createElement('span');text.textContent=uiText(entry[3]);const kbd=document.createElement('kbd');kbd.textContent=label(entry);li.append(text,kbd);list.append(li);}section.append(h,list);grid.append(section);}
      const notes=[uiText('kbHelpSettings',{key:label(byId.get('settings'))}),uiText('kbHelpInputs')];if(globalThis.chrome?.runtime?.id)notes.splice(1,0,mac?uiText('kbHelpGlobalMac',{mod:'⌃⇧'}):uiText('kbHelpGlobal',{mod:mod()}));if(ownPage)notes.push(uiText('kbHelpSpace'));if(Object.keys(custom).length)notes.push(uiText('kbHelpCustom'));if(typeof extra.previousBlock==='function')notes.push(uiText('kbHelpPdf'));
      content.append(head,intro,grid,...notes.map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));return content;
    };
    const placeHelp=()=>{if(!helpOpen)return;const r=bar.getBoundingClientRect(),w=Math.max(0,Math.min(560,innerWidth-24)),below=innerHeight-r.bottom-18,above=r.top-18,room=Math.max(140,Math.min(520,Math.max(below,above)));help.style.width=w+'px';if(helpContent)helpContent.style.maxHeight=(room-2)+'px';const h=help.getBoundingClientRect().height,down=below>=h||below>=above;help.style.left=Math.max(12,Math.min(innerWidth-w-12,r.left))+'px';help.style.top=(down?r.bottom+6:Math.max(6,r.top-h-6))+'px';};
    const toggleHelp=value=>{
      const open=typeof value==='boolean'?value:!helpOpen;if(open===helpOpen){if(open)help.querySelector('.kb-help-close')?.focus({preventScroll:true});return;}
      if(!open){helpOpen=false;help.hidden=true;const back=helpReturn;helpReturn=null;if(back?.isConnected)back.focus({preventScroll:true});return;}
      for(const other of shadow.querySelectorAll('.reader-select-menu[data-open],.voice-menu[data-open],.vol-pop[data-open],.download-menu[data-open]'))other.removeAttribute('data-open');
      helpReturn=shadow.activeElement;helpContent=buildHelp();help.replaceChildren(helpContent);helpOpen=true;help.hidden=false;placeHelp();help.querySelector('.kb-help-close')?.focus({preventScroll:true});
    };
    help.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();toggleHelp(false);}else if(event.key==='Tab'){event.stopPropagation();}else event.stopPropagation();});
    help.addEventListener('pointerdown',event=>event.stopPropagation());help.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
    const outside=event=>{if(helpOpen&&!event.composedPath().includes(help)&&!event.composedPath().some(node=>node?.classList?.contains('kb-help-open')))toggleHelp(false);};
    document.addEventListener('pointerdown',outside,true);cleanups.push(()=>document.removeEventListener('pointerdown',outside,true));
    const relayout=()=>placeHelp();window.addEventListener('resize',relayout);cleanups.push(()=>window.removeEventListener('resize',relayout));
    // Dispatcher: window capture, so it runs before page handlers and before the bar stops propagation.
    const editable=event=>{const node=event.composedPath?.()[0]||event.target;if(!node||node.nodeType!==1)return false;if(node.isContentEditable)return true;const tag=node.tagName;if(tag==='TEXTAREA'||tag==='SELECT')return true;if(tag==='INPUT')return !['button','submit','reset','checkbox','radio','range','color','file','image'].includes(String(node.type||'text').toLowerCase());return false;};
    const spaceTarget=event=>{const node=event.composedPath?.()[0]||event.target;if(!node||node.nodeType!==1)return true;if(node===document.body||node===document.documentElement)return true;return !node.closest('button,a[href],input,select,textarea,summary,details,[role=button],[role=switch],[role=option],[role=tab],[role=menuitem],[role=menuitemradio],[tabindex]:not([tabindex="-1"]),[contenteditable]');};
    const run=id=>{const own=extra[id];if(typeof own==='function'&&own()===true)return true;const action=actions[id];if(!action)return false;action();return true;};
    // Recording a new combination (settings editor): the next key press is swallowed, never executed. Escape without modifier cancels; a lone modifier key is ignored (the user is still building the combination).
    let recorder=null,recorderHooks=null;const stopRecorder=()=>{const done=recorder;recorder=null;recorderHooks=null;done?.(null);};
    const onRecord=event=>{if(!recorder||!event.isTrusted||event.isComposing||event.keyCode===229&&!event.code)return;if(/^(?:Shift|Control|Alt|Meta|OS|AltGraph)(?:Left|Right)?$/.test(event.code)){recorderHooks?.onModifier?.([(mac?event.metaKey:event.ctrlKey)&&'Mod',event.altKey&&'Alt',event.shiftKey&&'Shift'].filter(Boolean));return;}if(event.code==='Tab'&&!event.altKey&&!event.ctrlKey&&!event.metaKey){const done=recorder;recorder=null;done(null);return;}if(event.repeat){event.preventDefault();return;}event.preventDefault();event.stopImmediatePropagation();const done=recorder;recorder=null;if(event.code==='Escape'&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){done(null);return;}done({combo:comboFromEvent(event),code:event.code,alt:event.altKey,shift:event.shiftKey,ctrl:event.ctrlKey,meta:event.metaKey});};
    window.addEventListener('keydown',onRecord,true);cleanups.push(()=>window.removeEventListener('keydown',onRecord,true));
    const onKeydown=event=>{
      if(destroyed||recorder||!event.isTrusted||!enabled||isHidden()||event.isComposing||event.keyCode===229)return;
      const plain=!event.altKey&&!event.ctrlKey&&!event.metaKey;let entry=null;
      const combo=comboFromEvent(event);if(combo)entry=byCombo.get(combo)||null;
      if(entry){if(editable(event))return;}
      else if(plain&&event.key==='?'&&(ownPage||event.composedPath().includes(shadow.host))&&!editable(event))entry=byId.get('help');
      else if(plain&&!event.shiftKey&&event.key===' '&&ownPage&&!helpOpen&&spaceTarget(event)&&!editable(event))entry=byId.get('playPause');
      else return;
      const id=entry[0];if(entry[4]&&typeof extra[id]!=='function')return;if(!listed(id)&&id!=='help')return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.repeat&&!REPEAT.has(id))return;
      if(run(id)&&SPOKEN.has(id))announce(uiText(entry[3]));
    };
    window.addEventListener('keydown',onKeydown,true);cleanups.push(()=>window.removeEventListener('keydown',onKeydown,true));
    // Settings dialog: Page Up/Down moves between its groups (not on sliders, lists and text fields, which use those keys themselves).
    const settingsPanel=shadow.querySelector('.settings-panel');
    const onGroupKey=event=>{if(!enabled||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!['PageUp','PageDown'].includes(event.key))return;const node=event.composedPath()[0];if(!node||node.nodeType!==1||node.tagName==='SELECT'||node.tagName==='TEXTAREA'||node.tagName==='INPUT'&&node.type!=='checkbox')return;const groups=[...settingsPanel.querySelectorAll('.settings-block,.block-cell,.appearance-group,.kb-settings,.export-settings')].filter(group=>group.getClientRects().length),focusable=group=>group.querySelector('button:not([disabled]),input:not([disabled]),select:not([disabled])'),at=groups.findIndex(group=>group.contains(node)),target=groups[Math.max(0,Math.min(groups.length-1,at+(event.key==='PageDown'?1:-1)))],first=target&&focusable(target);if(!first||target.contains(node))return;event.preventDefault();event.stopPropagation();first.focus();first.scrollIntoView?.({block:'nearest'});};
    settingsPanel?.addEventListener('keydown',onGroupKey);cleanups.push(()=>settingsPanel?.removeEventListener('keydown',onGroupKey));
    const style=document.createElement('style');style.textContent=".kb-announce{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}.kb-switch-row{display:flex;align-items:center;justify-content:space-between;gap:8px}.kb-switch{position:relative;display:inline-block;flex:none;width:36px;height:20px;min-width:36px;min-height:0;padding:0;margin:0;border:1px solid var(--reader-line);border-radius:10px;background:var(--reader-soft);cursor:pointer}.kb-switch::before{content:\"\";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--reader-muted);transition:transform .15s,background-color .15s}.kb-switch[aria-checked=true]{background:var(--reader-accent);border-color:var(--reader-accent)}.kb-switch[aria-checked=true]::before{transform:translateX(16px);background:var(--reader-on-accent,#fff)}.kb-switch:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}.kb-help-open{align-self:flex-start;font-size:11px}.kb-help{position:fixed;z-index:9;background:var(--reader-paper);color:var(--reader-ink);border:1px solid var(--reader-line);border-radius:11px;box-shadow:var(--reader-shadow);font-size:11px;line-height:1.5;overflow:hidden;pointer-events:auto;cursor:default}.kb-help[hidden]{display:none}.kb-help-content{overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable;padding:12px 14px;border-radius:inherit}.kb-help-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.kb-help-head h2{font-size:12px;font-weight:600;margin:0}.kb-help-close{display:flex;align-items:center;justify-content:center;flex:none;width:26px;min-height:26px;padding:0;border-color:transparent;background:transparent}.kb-help-close svg{width:16px;height:16px}.kb-help-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:2px 20px;margin-top:4px}.kb-help-group h3{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--reader-muted);margin:10px 0 3px}.kb-help-group ul{list-style:none;margin:0;padding:0}.kb-help-group li{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:2px 0}.kb-help kbd{font:inherit;font-size:10px;white-space:nowrap;padding:1px 5px;border:1px solid var(--reader-line);border-radius:5px;background:var(--reader-soft);color:var(--reader-ink)}.kb-help-content>p{margin:10px 0 0;font-size:10px;color:var(--reader-muted);overflow-wrap:anywhere}";shadow.append(style);
    const setBindings=(value,notify=true)=>{const next={};if(value&&typeof value==='object'&&value.keys&&typeof value.keys==='object')for(const [id,c] of Object.entries(value.keys))if(byId.has(id)&&safeCombo(c)&&c!=='Alt+Shift+'+byId.get(id)[1])next[id]=c;const was=JSON.stringify(custom);custom=next;rebuild();const on=!(value&&value.enabled===false),flip=on!==enabled;if(flip){enabled=on;if(!enabled)stopRecorder();syncSwitches();}applyAll();if(flip||was!==JSON.stringify(custom))onEnabled?.(enabled);if(notify&&was!==JSON.stringify(custom)&&help.hidden===false){toggleHelp(false);}};
    const commit=value=>{setBindings(value);onSettings?.({enabled,keys:{...custom}});};
    return {enabled:()=>enabled,setEnabled,setBindings,commit,bindings:()=>({enabled,keys:{...custom}}),comboOf,defaultComboOf:id=>'Alt+Shift+'+byId.get(id)[1],comboLabel:combo=>fmt(combo,false),available:id=>listed(id),capture:(cb,hooks)=>{if(!enabled){cb(null);return ()=>{};}recorder=cb;recorderHooks=hooks||null;return ()=>{if(recorder===cb){recorder=null;recorderHooks=null;}};},recording:()=>!!recorder,cancelRecording:stopRecorder,hint:(...ids)=>hint(ids),aria:(...ids)=>ids.filter(usable).map(id=>aria(byId.get(id))).join(' '),applyAll,settingsRow,toggleHelp,helpOpen:()=>helpOpen,announce,keymap:KEYMAP.map(entry=>[...entry]),label:id=>byId.has(id)?label(byId.get(id)):'',destroy(){destroyed=true;for(const fn of cleanups)fn();help.remove();region.remove();style.remove();}};
  }
  /*KEYBOARD-END*/
function mountPlayerPolish({shadow,bar,send,icon,locales,onLocale,onFormats,relayout,formattingFactory,appearanceController,onPlayerTheme,fxUi,initialLocale=null,initialTheme=null}) {
  // Serialized into both documents: no globals, requests, prose or fake timers.
  const $=s=>shadow.querySelector(s),dictionary=locales.messages,formats=formattingFactory({formatLocales:locales.formatLocales});let locale='en',latest={},localChoice=null,formatPrefs=formats.preferences({});const regionalPending=new Map();const makeSwitch=createSettingsSwitch
  const t=(key,args={})=>(dictionary[locale]?.[key]||dictionary.en?.[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(typeof args[k]==='number'?formats.number(args[k],formatPrefs):args[k]??''));
  const dropdowns=[],disposers=[];let closeDirect=()=>{},placeDirect=()=>{},closeError=()=>{},placeError=()=>{},closeMore=()=>{};
  const centerIcons=()=>{
    if(!shadow.host.isConnected)return;
    for(const svg of bar.querySelectorAll('button svg,.handle svg')){
      if(svg.dataset.centered)continue;
      let b;try{b=svg.getBBox();}catch{continue;}if(!b.width||!b.height)continue;
      svg.dataset.centered='true';const solidPlay=!!svg.querySelector('path[fill="currentColor"][stroke="none"]'),dx=solidPlay?1/3:12-b.x-b.width/2;const g=document.createElementNS('http://www.w3.org/2000/svg','g');while(svg.firstChild)g.append(svg.firstChild);g.setAttribute('transform',`translate(${dx} ${12-b.y-b.height/2})`);svg.append(g);
    }
  };
  const centerObserver=new MutationObserver(centerIcons);centerObserver.observe(bar,{childList:true,subtree:true});
  const closeOtherMenus=except=>{
    for(const dropdown of dropdowns)if(dropdown!==except)dropdown.close(false);closeDirect(false);closeError(false);closeMore(false);
    for(const selector of ['.voice-btn','.vol-btn']){const button=$(selector);if(button?.getAttribute('aria-expanded')==='true')button.click();}
  };
  const createSelect=(...args)=>createSettingsSelect({shadow,bar,t,icon,anchorPanel,closeOtherMenus,dropdowns,disposers,centerIcons},...args);
  /* Tempo as a slider like the volume: trigger button (current value) + popover with range input, a 1x reset and the value. The hidden <select> stays the single
     value holder (0.50-4.00 in 0.05 steps, one 'change' = one command + save), so keyboard shortcuts, state updates and the job-limit logic are untouched.
     Dragging only repaints the value (one rAF per frame, no layout); the value is committed on release / each key step. Mouse drags snap to 1x within one step (a detent). */
  const createSpeedSlider=select=>speechControls.createSpeedSlider({select,bar,t,formatNumber:v=>formats.number(v,formatPrefs,{maximumFractionDigits:2}),glyph,icon,anchorPanel,closeOtherMenus,dropdowns,disposers,centerIcons,fxUi,onOpen:()=>{if(!select.closest('.settings-panel')){$('.settings-panel').removeAttribute('data-open');$('.settingsToggle').setAttribute('aria-expanded','false');}}});
  const glyph=(name)=>{const paths={...speechControls.GLYPHS,previous:'<path d="M6 5v14m12-14L8 12l10 7z"/>',next:'<path d="M18 5v14M6 5l10 7-10 7z"/>',follow:'<path d="M4 5h12M4 10h8M4 15h6M16 11v10m-4-4 4 4 4-4"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'};return '<svg aria-hidden="true" viewBox="0 0 24 24">'+paths[name]+'</svg>';};
  const style=document.createElement('style');style.textContent="\n    .reader-controls{gap:7px;padding:4px 12px 8px;}.voice{flex:1;min-width:0;padding:0;}.voice-btn{width:100%;padding:4px 8px;gap:6px;}.voice-btn>.language-icon svg{width:17px;height:17px;transform:none!important;color:var(--reader-ink);}.voice-btn .vn{flex:1;min-width:0;text-align:left;}.voice-btn>small{display:none;}.voice-btn[data-static]{padding:4px 8px;}.voice-btn[data-static]>.language-icon svg{display:block;}\n    .reader-controls>.previous-section,.reader-controls>.next-section{display:flex;align-items:center;justify-content:center;width:26px;min-width:26px;min-height:30px;padding:0;border-color:transparent;background:transparent;}.previous-section svg,.next-section svg{width:18px;height:18px;}.reader-controls>.primary{width:36px;min-width:36px;height:36px;margin:0;}\n    .speed-control{display:flex;align-items:center;gap:6px;border:1px solid var(--reader-line);border-radius:7px;padding:4px 8px;min-height:30px;background:var(--reader-paper);}.speed-control{width:auto;flex:none;}.speed-control>svg{width:17px;height:17px;}.speed-control .speed{appearance:none;border:0;border-radius:0;min-width:0;max-width:none;width:100%;min-height:20px;padding:0;font-size:11px;background:transparent;}.speed-control:hover{border-color:var(--reader-muted);}.speed-control:focus-within{outline:2px solid var(--reader-accent);outline-offset:2px;}.speed-control select:focus-visible{outline:0;}\n    .vol-btn{width:32px;padding:4px 8px;}.follow-label{margin-left:0;}.reader-controls .follow,.reader-controls .select-text{display:flex;align-items:center;justify-content:center;width:30px;min-width:30px;height:30px;padding:0;background:transparent;border-color:transparent;color:var(--reader-muted);}.reader-controls .follow:hover,.reader-controls .select-text:hover{border-color:var(--reader-muted);}.follow svg,.select-text svg{width:18px;height:18px;}.follow[aria-pressed=true],.select-text[aria-pressed=true]{background:var(--reader-soft);color:var(--reader-accent);border-color:var(--reader-line);}.status{cursor:default;}.status:hover{background:transparent;}.status-slot{flex:1;min-width:20px;position:relative;display:flex;align-items:center;}.status-slot[data-error]>.status{opacity:0;}.error-trigger{position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-start!important;gap:4px;width:100%;min-height:0;padding:4px 2px;border:0;background:var(--reader-paper);color:var(--reader-ink);font-size:11px;}.error-trigger>svg{width:14px;height:14px;flex:none;color:var(--reader-accent);}.error-trigger-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.error-trigger[hidden]{display:none!important;}.reader-error{position:fixed;z-index:9;background:var(--reader-paper);color:var(--reader-ink);border:1px solid var(--reader-line);border-radius:11px;box-shadow:var(--reader-shadow);font-size:11px;line-height:1.5;overflow:hidden;pointer-events:auto;}.reader-error[hidden]{display:none;}.reader-error-content{overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable;padding:12px 14px;border-radius:inherit;}.reader-error-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;}.reader-error-heading strong{font-size:11px;}.error-dismiss{display:flex;align-items:center;justify-content:center;flex:none;width:26px;min-height:26px;padding:0;border-color:transparent;background:transparent;}.error-dismiss svg{width:16px;height:16px;}.reader-error-text{margin:7px 0 12px;white-space:pre-wrap;overflow-wrap:anywhere;}.error-retry{font-size:11px;}\n    .voice-menu{overflow:hidden;padding:0;}.voice-list{max-height:inherit;overflow:auto;padding:6px;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable;border-radius:inherit;}\n    .reader-timeline{padding:0 12px 9px;font-variant-numeric:tabular-nums;}.seek-progress{display:block;width:100%;height:14px;margin:0;cursor:pointer;-webkit-appearance:none;appearance:none;background:transparent;accent-color:var(--reader-accent);}.seek-progress::-webkit-slider-runnable-track{height:8px;border-radius:4px;background-color:var(--reader-soft);background-image:var(--seek-played,linear-gradient(transparent,transparent)),var(--seek-buffered,linear-gradient(transparent,transparent));background-repeat:no-repeat;background-size:100% 100%;}.seek-progress::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-3px;border:0;border-radius:50%;background:var(--reader-accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--reader-accent) 35%,transparent);}.seek-progress:disabled{opacity:.5;cursor:default;}.timeline-labels{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11px;color:var(--reader-muted);}.timeline-labels>span{white-space:nowrap;}.timeline-labels>span>[data-i18n]{margin-right:2px;}.timeline-labels output{color:var(--reader-ink);font-size:11px;}.timeline-labels .remaining{display:inline!important;flex:none;font-size:11px;color:var(--reader-ink);}.timeline-labels .remaining:empty{display:inline!important;}.section-label{margin-left:auto;color:var(--reader-muted);font-size:9px;white-space:nowrap;}.export-note,.export-status{font-size:10px;line-height:1.5;overflow-wrap:anywhere;margin:7px 0;color:var(--reader-muted);}.export-actions{display:flex;gap:6px;flex-wrap:wrap;}.export-actions button{font-size:11px;}.export-meter{width:100%;accent-color:var(--reader-accent);}.export-cancel[hidden],.export-ready[hidden]{display:none!important;}\n    @media(max-width:560px){.reader-controls{display:grid;grid-template-columns:26px 36px 26px minmax(0,1fr) 42px 64px;gap:6px;padding:4px 12px 8px;}.reader-controls>.previous-section{grid-column:1;grid-row:1;}.reader-controls>.primary{grid-column:2;grid-row:1;}.reader-controls>.next-section{grid-column:3;grid-row:1;}.reader-controls>.vol{grid-column:5;grid-row:1;justify-self:end;}.reader-controls>.follow-label{grid-column:6;grid-row:1;justify-self:end;}.reader-controls>.voice{grid-column:1/5;grid-row:2;min-width:0;width:100%;}.reader-controls>.speed-control{grid-column:5/7;grid-row:2;width:auto;justify-self:end;min-width:0;}.reader-controls .speed-control>svg{width:14px;height:14px;}.section-label{max-width:45%;overflow:hidden;text-overflow:ellipsis;}.reader-title{font-size:10px;}.timeline-labels{font-size:11px;gap:4px;}}\n\n  ";shadow.append(style);
  const parityStyle=document.createElement('style');parityStyle.textContent="\n    button,.handle{line-height:1;}button svg,.handle svg{display:block;flex:none;vertical-align:middle;}button:has(svg){display:inline-flex;align-items:center;justify-content:center;}.language-icon{display:flex;align-items:center;justify-content:center;line-height:0;flex:none;}.voice-btn{align-items:center;}.voice-btn>.language-icon svg{width:17px;height:17px;}.vm-item{align-items:center;}.vm-check{display:flex;align-items:center;justify-content:center;line-height:1;flex:none;width:14px;}.speed-control{border:0;padding:0;background:transparent;}.speed-control>svg{display:none;}select[hidden]{display:none!important;}.reader-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.25;}.download-menu{display:none;position:fixed;z-index:8;background:var(--reader-paper);color:var(--reader-ink);border:1px solid var(--reader-line);border-radius:11px;box-shadow:var(--reader-shadow);overflow:hidden;pointer-events:auto;}.download-menu[data-open]{display:block;}.download-content{overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable;padding:6px;border-radius:inherit;}.ui-language-trigger{font-size:12px;}.speed-trigger{font-size:11px;gap:4px;width:auto;padding:4px 6px;}.speed-trigger .reader-value{flex:none;text-align:left;overflow:visible;}.reader-top{gap:5px;}.section-label{flex:0 1 145px;min-width:0;max-width:145px;}.chapter-trigger{min-height:26px;font-size:10px;padding:3px 6px;}.chapter-trigger>svg{width:14px;height:14px;}.reader-title{flex-shrink:1;min-width:0;max-width:90px;overflow:hidden;text-overflow:ellipsis;}.download-trigger{display:inline-flex;align-items:center;justify-content:center;flex:none;width:26px;min-height:26px;padding:0;border-color:transparent;background:transparent;color:var(--reader-muted);}.download-trigger{position:relative;}.download-trigger>svg{width:17px;height:17px;}.download-trigger[aria-expanded=true],.download-trigger[data-running]{color:var(--reader-accent);border-color:var(--reader-line);background:var(--reader-soft);}.download-content{padding:12px 14px;}.download-menu .export-actions button{justify-content:center;}.reader-timeline{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:auto;align-items:center;column-gap:8px;}.timeline-labels{display:contents;}.seek-progress{grid-column:2;grid-row:1;min-width:0;}.timeline-labels>span{min-width:0;white-space:nowrap;line-height:1.3;}.timeline-labels>span:nth-child(1){grid-column:1;grid-row:1;text-align:left;}.timeline-labels>span:nth-child(2){grid-column:3;grid-row:1;text-align:right;}.timeline-labels .remaining{display:inline!important;text-align:right;}\n    @media(max-width:560px){.reader-controls .speed-control{width:auto;}.speed-trigger{padding:4px 6px;gap:4px;}.speed-trigger>svg{width:14px;height:14px;}.reader-top{gap:4px;}.reader-title{max-width:68px;}.section-label{flex-basis:130px;max-width:130px;}.timeline-labels{gap:8px;}}\n  ";shadow.append(parityStyle);const mozRange=document.createElement('style');mozRange.textContent="@supports (-moz-appearance:none){.seek-progress{-moz-appearance:none;appearance:none;background:transparent;height:18px;cursor:pointer}.seek-progress::-moz-range-track{box-sizing:border-box;height:8px;border-radius:4px;background-color:var(--reader-soft);background-image:var(--seek-buffered,linear-gradient(transparent,transparent));background-repeat:no-repeat;border:1px solid color-mix(in srgb,var(--reader-muted) 70%,var(--reader-paper))}.seek-progress::-moz-range-progress{box-sizing:border-box;height:8px;border-radius:4px 0 0 4px;background:var(--reader-accent);border:1px solid var(--reader-accent)}.seek-progress::-moz-range-thumb{box-sizing:border-box;width:16px;height:16px;border:0;border-radius:50%;background:var(--reader-accent)}.seek-progress:disabled{opacity:.5;cursor:default}}";shadow.append(mozRange);const menuStyle=document.createElement('style');menuStyle.textContent="";shadow.append(menuStyle);
  const controls=$('.reader-controls'),play=$('.primary');
  const navigate=(command,value)=>{closeOtherMenus(null);$('.settings-panel').removeAttribute('data-open');$('.settingsToggle').setAttribute('aria-expanded','false');send(command,value);};
  const previous=document.createElement('button');previous.className='previous-section';previous.innerHTML=glyph('previous');previous.disabled=true;play.before(previous);previous.addEventListener('click',()=>navigate('previousSection'));
  const next=document.createElement('button');next.className='next-section';next.innerHTML=glyph('next');next.disabled=true;play.after(next);next.addEventListener('click',()=>navigate('nextSection'));
  const voice=$('.voice-btn');voice.insertAdjacentHTML('afterbegin','<span class="language-icon">'+glyph('language')+'</span>');const voiceChevron=voice.querySelector(':scope>svg');if(voiceChevron){const wrap=document.createElement('span');wrap.className='chevron';voiceChevron.before(wrap);wrap.append(voiceChevron);}
  const speed=$('.speed'),speedControl=document.createElement('span');speedControl.className='speed-control';speed.before(speedControl);speedControl.append(speed);
  const speedUi=createSpeedSlider(speed);speedControl.querySelectorAll('svg,.chevron').forEach(node=>node.remove());
  const follow=$('.follow');follow.innerHTML=glyph('follow');
  const section=document.createElement('span');section.className='section-label';$('.handle').after(section);
  const chapterSelect=document.createElement('select');chapterSelect.className='chapter-select';chapterSelect.disabled=true;section.append(chapterSelect);const CHAPTER_ICON='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h16M2 5h.01M2 12h.01M2 19h.01"/></svg>',chapterUi=createSelect(chapterSelect,'chapter',CHAPTER_ICON,'chooseChapter');let chapterSignature='';chapterUi.button.querySelector('.chevron').insertAdjacentHTML('beforebegin','<span class="reader-fixed-label" data-i18n="chapters"></span>');
  chapterSelect.addEventListener('change',()=>{const [kind,value]=chapterSelect.value.split(':'),index=Number(value);if(Number.isSafeInteger(index)&&index>=0)navigate(kind==='c'?'seekChapter':'seekSection',index);});
  const timeline=document.createElement('div');timeline.className='reader-timeline';timeline.innerHTML='<input class="seek-progress" type="range" min="0" max="1000" step="0.1" value="0" disabled><div class="timeline-labels"><span><span data-i18n="elapsed"></span> <output class="elapsed" role="timer" aria-live="off">—</output></span><span><span data-i18n="remaining"></span> <output class="remaining" role="timer" aria-live="off">—</output></span></div>';controls.after(timeline);const oldRemaining=controls.querySelector('.remaining');oldRemaining?.remove();
  // Control row: voice | previous play next | rest. Transport gaps are 7px; the right-hand icons (speed, volume, Text auswählen, Folgen) sit 4px apart; below 544px the 36px play button makes the row gap 4px; the outer inset is 12px (11px padding + 1px bar border, matching the top-row icons). Equal side tracks keep play on the bar center; the speed control stretches to fill the right track. Below 544px speed stretches in row 1 and leaves 39 px (button 32 + gap 7) for the volume button at the right edge, so the right track stays as wide as the voice track; Folgen and Text auswählen sit in row 2 on the right.
  const controlsLeft=document.createElement('span');controlsLeft.className='controls-left';const controlsRight=document.createElement('span');controlsRight.className='controls-right';controls.prepend(controlsLeft);controls.append(controlsRight);controlsLeft.append(speedControl,$('.vol'),$('.voice'));controlsRight.append(section,$('.follow-label'));
  const seek=$('.seek-progress');let seeking=false,seekDirty=false,seekPending=null,seekTimer=0;
  // Prepared audio is drawn INTO the timeline track (the track colours itself) instead of a separate line below it:
  // paintBuffer sets the segments as one gradient, seekFill sets the played part. Both are plain CSS variables on the slider.
  const seekFill=fraction=>{const pct=(Math.max(0,Math.min(1,Number(fraction)||0))*100).toFixed(2)+'%';seek.style.setProperty('--seek-played','linear-gradient(to right,var(--reader-accent) 0 '+pct+',transparent '+pct+')');};
  const paintBuffer=ranges=>{const list=Array.isArray(ranges)?ranges.filter(r=>Array.isArray(r)&&r[1]>r[0]):[],signature=list.map(r=>r.join(':')).join(',');if(seek.dataset.bufferSignature===signature)return;seek.dataset.bufferSignature=signature;seek.dataset.buffered=String(list.length);if(!list.length){seek.style.removeProperty('--seek-buffered');return;}const c='color-mix(in srgb,var(--reader-accent) 42%,transparent)',pct=v=>(Math.max(0,Math.min(1,v))*100).toFixed(2)+'%';seek.style.setProperty('--seek-buffered','linear-gradient(to right,'+list.flatMap(([a,b])=>['transparent '+pct(a),c+' '+pct(a),c+' '+pct(b),'transparent '+pct(b)]).join(',')+')');};
  const paintSeek=fraction=>{seek.value=String(fraction*1000);seekFill(fraction);seek.setAttribute('aria-valuetext',formats.number(fraction*100,formatPrefs,{maximumFractionDigits:2})+' %');if(Number.isFinite(latest.totalSeconds)){const elapsed=latest.totalSeconds*fraction;$('.elapsed').textContent=formats.duration(elapsed,formatPrefs);$('.remaining').textContent=formats.duration(Math.max(0,latest.totalSeconds-elapsed),formatPrefs);}};
  const commitSeek=()=>{if(seek.disabled||!seekDirty)return;seekDirty=false;seeking=false;const fraction=Math.max(0,Math.min(1,Number(seek.value)/1000));seekPending={fraction,expires:Date.now()+6000};clearTimeout(seekTimer);seekTimer=setTimeout(()=>{seekPending=null;update(latest);},6000);paintSeek(fraction);send('seekProgress',fraction);};
  listen(seek,'pointerdown',()=>{seeking=true;seekDirty=false;});
  listen(seek,'input',()=>{if(seek.disabled)return;seekDirty=true;paintSeek(Number(seek.value)/1000);});
  listen(seek,'change',commitSeek);listen(seek,'blur',()=>{commitSeek();seeking=false;});
  listen(window,'pointerup',()=>{if(seeking)commitSeek();seeking=false;},true);
  listen(window,'pointercancel',()=>{if(!seeking)return;seeking=false;seekDirty=false;paintSeek(seekPending?.fraction??latest.progressFraction??0);},true);
  disposers.push(()=>clearTimeout(seekTimer));
  // The existing status slot reserves the indicator's space. Error details
  // live outside layout flow, so even long messages cannot move the controls.
  let restartPending=null;
  let testErrorTriggered=false;
  $('.restart').addEventListener('click',()=>{clearTimeout(restartPending?.timer);restartPending={signature:[latest.statusKey,latest.playing===true,latest.paused===true].join('|'),timer:setTimeout(()=>{restartPending=null;update(latest);},4000)};update(latest);
    // Trigger test error on restart to verify error button works
    if(!testErrorTriggered){
      testErrorTriggered=true;
      // Simulate an error status directly
      const testErrorMsg={...latest,statusKind:'error',statusKey:'voice_download_failed',status:{code:'voice_download_failed',message:'Test error: Simulated voice download failure. This is a test to verify the error button works.'},statusParams:{code:'voice_download_failed',message:'Test error: Simulated voice download failure. This is a test to verify the error button works.'}};
      update(testErrorMsg);
    }
  });
  const status=$('.status'),statusSlot=document.createElement('span');statusSlot.className='status-slot';status.before(statusSlot);statusSlot.append(status);
  const errorTrigger=document.createElement('button');errorTrigger.type='button';errorTrigger.className='error-trigger';errorTrigger.hidden=true;errorTrigger.setAttribute('aria-haspopup','dialog');errorTrigger.setAttribute('aria-expanded','false');errorTrigger.setAttribute('aria-controls','reader-error-details');errorTrigger.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 10 18H2zM12 9v5m0 3v.01"/></svg><span class="error-trigger-text"></span>';statusSlot.append(errorTrigger);
  const error=document.createElement('div');error.className='reader-error';error.id='reader-error-details';error.setAttribute('role','dialog');error.setAttribute('aria-modal','false');error.setAttribute('aria-describedby','reader-error-text');error.hidden=true;error.innerHTML='<div class="reader-error-content"><div class="reader-error-heading"><strong data-i18n="errorDetails"></strong><button class="error-dismiss" type="button">'+icon('close')+'</button></div><p class="reader-error-text" id="reader-error-text"></p><div class="error-actions"><button class="error-retry" type="button" data-i18n="retryReading"></button><button class="error-voice" type="button" data-i18n="choose_other_voice" hidden></button></div></div>';bar.append(error);const errorContent=error.firstElementChild,errorText=error.querySelector('.reader-error-text'),errorDismiss=error.querySelector('.error-dismiss'),errorRetry=error.querySelector('.error-retry'),errorVoice=error.querySelector('.error-voice');let errorOpen=false;
  placeError=()=>{if(!errorOpen)return;anchorPanel(error,errorTrigger,{width:320,cap:320,preferAbove:true,clear:bar,fit:room=>{errorContent.style.maxHeight=(room-2)+'px';}});};
  closeError=refocus=>{errorOpen=false;error.hidden=true;errorTrigger.setAttribute('aria-expanded','false');if(refocus&&!errorTrigger.hidden)errorTrigger.focus({preventScroll:true});};
  errorTrigger.addEventListener('click',event=>{event.stopPropagation();if(errorOpen){closeError(true);return;}closeOtherMenus(null);$('.settings-panel').removeAttribute('data-open');$('.settingsToggle').setAttribute('aria-expanded','false');errorOpen=true;error.hidden=false;errorTrigger.setAttribute('aria-expanded','true');placeError();errorDismiss.focus({preventScroll:true});centerIcons();});
  errorDismiss.addEventListener('click',()=>closeError(true));errorRetry.addEventListener('click',()=>{closeError(false);play.focus({preventScroll:true});send(Number.isInteger(latest.sectionCount)&&latest.sectionCount>0?'toggle':'restart');});
  errorVoice.addEventListener('click',()=>{closeError(false);voiceUi.open();});
  // ONE polite live region for state changes (errors, voice download, end of reading, export result):
  // the keyboard layer's, or an own one where the surface has no keyboard layer.
  let ownLive=null,liveTimer=0;const spoken={error:'',status:'',job:''};
  const announce=text=>{
    if(!text)return;if(kb){kb.announce(text);return;}
    if(!ownLive){
      ownLive=document.createElement('div');ownLive.className='reader-live';ownLive.setAttribute('role','status');
      ownLive.setAttribute('aria-live','polite');ownLive.setAttribute('aria-atomic','true');bar.append(ownLive);
    }
    clearTimeout(liveTimer);ownLive.textContent='';liveTimer=setTimeout(()=>{ownLive.textContent=text;},30);
  };
  disposers.push(()=>clearTimeout(liveTimer));
  /* Voice card and download line: ONE non-modal panel at the bar (above or below it, never wider than it), drawn from
     the state (voiceCard, voiceDownload). The card names the voice to download, a smaller one and the shipped sample;
     a running download shows its progress with Cancel. */
  const card=document.createElement('div');card.className='voice-card';card.hidden=true;
  card.setAttribute('aria-modal','false');
  card.innerHTML='<div class="vc-head"><strong class="vc-title" id="voice-card-title"></strong>'
    +'<button class="vc-close" type="button">'+icon('close')+'</button></div>'
    +'<div class="vc-actions"><button class="vc-get" type="button"></button>'
    +'<button class="vc-smaller" type="button"></button>'
    +'<button class="vc-sample" type="button" aria-pressed="false"></button>'
    +'<button class="vc-keep" type="button"></button></div><p class="vc-note"></p>'
    +'<div class="vc-progress"><span class="vc-line"></span><button class="vc-cancel" type="button"></button>'
    +'<progress class="vc-meter" max="100" value="0" aria-hidden="true"></progress></div>';
  bar.append(card);
  const cardPart=name=>card.querySelector('.vc-'+name),cardTitle=cardPart('title'),cardGet=cardPart('get');
  const cardSmaller=cardPart('smaller'),cardSample=cardPart('sample'),cardKeep=cardPart('keep');
  const cardClose=cardPart('close');
  const cardLine=cardPart('line'),cardCancel=cardPart('cancel'),cardMeter=cardPart('meter');
  let cardData=null,cardShown='',cardReturn=null,sampleNow={key:'',state:'idle'},onDownloadStart=()=>{};
  const placeCard=()=>{
    if(card.hidden)return;
    const r=bar.getBoundingClientRect(),w=Math.max(0,Math.min(r.width,innerWidth-24)),gap=6;card.style.width=w+'px';
    const h=card.getBoundingClientRect().height,above=r.top-gap-12,below=innerHeight-r.bottom-gap-12;
    /* A running download is a slim strip that always sits right above the bar, whatever the free room says:
       the two progress displays of earlier rounds (panel and line) said different things and looked duplicated. */
    const up=card.dataset.mode==='progress'?above>=h||above>=below:bar.hasAttribute('data-expand-above')?above>=h||above>=below:below<h&&above>below;
    card.style.left=Math.max(12,Math.min(innerWidth-w-12,r.left))+'px';
    card.style.top=(up?Math.max(6,r.top-h-gap):r.bottom+gap)+'px';
    card.toggleAttribute('data-above',up);
  };
  placeExtras.push(placeCard);
  const paintSample=()=>{
    const voice=cardData?.primary,on=!!voice&&sampleNow.key===voice.id&&sampleNow.state!=='idle';
    cardSample.setAttribute('aria-pressed',String(on));
    cardSample.textContent=t(on?'voice_sample_playing':'voice_card_sample');
  };
  const paintOffer=data=>{
    card.setAttribute('role','dialog');card.setAttribute('aria-labelledby','voice-card-title');
    card.removeAttribute('aria-label');
    cardTitle.textContent=t(data.reason==='better'?'voice_card_better':'voice_card_none');
    cardGet.textContent=t('voice_card_get',{name:data.primary.name,mb:data.primary.mb});
    cardGet.dataset.id=data.primary.id;
    cardSmaller.hidden=!data.smaller;
    if(data.smaller){
      const label=t('voice_card_smaller',{mb:data.smaller.mb});
      cardSmaller.textContent=label;cardSmaller.dataset.id=data.smaller.id;
      cardSmaller.title=data.smaller.name+' · '+label;
    }
    cardSample.hidden=!data.primary.sample;paintSample();cardKeep.hidden=data.reason!=='better';
    cardKeep.textContent=t('voice_card_keep');
    cardPart('note').textContent=t('voice_card_note');title(cardClose,'closeMessage');
  };
  /* The running voice download is ONE ring around the voice button, filled clockwise from twelve o'clock
     (owner request: no panel, no second bar). Percent and MB also stay in the bar's status line;
     Cancelling lives in the voice list's row (progress ring there turns into a cancel). */
  const paintRing=download=>{
    const button=$('.voice-btn');if(!button)return;
    if(!download){button.removeAttribute('data-downloading');button.style.removeProperty('--vc-progress');button.removeAttribute('title');return;}
    const percent=Math.max(0,Math.min(100,Math.round(Number(download.percent)||0)));
    const line=t('voice_downloading',{percent,mb:download.mb});
    button.setAttribute('data-downloading','');button.style.setProperty('--vc-progress',String(percent));
    button.title=String(download.name||'')+' · '+line;
  };
  const renderCard=message=>{
    const before_mode=card.dataset.mode||'',wasDownload=bar.hasAttribute('data-downloading');
    const offer=message.voiceCard,progress=message.voiceDownload;
    const download=progress&&typeof progress==='object'?progress:null;
    const data=offer&&typeof offer==='object'&&offer.primary?offer:null;
    const mode=data&&!download?'card':'',focusInside=card.contains(shadow.activeElement);cardData=data;
    card.dataset.mode=mode;card.hidden=!mode;bar.toggleAttribute('data-downloading',!!download);paintRing(download);
    if(download&&!wasDownload){onDownloadStart();announce(t('voice_downloading',{percent:Math.max(0,Math.min(100,Math.round(Number(download.percent)||0))),mb:download.mb}));}
    if(!download&&wasDownload&&message.statusKind!=='error')announce(t('voice_download_done'));
    if(mode==='card')paintOffer(data);
    const key=mode&&mode+'|'+(data?.primary?.id||'');
    if(key!==cardShown){
      const before=cardShown;cardShown=key;
      if(mode==='card'){
        const active=shadow.activeElement;           // focus moves in only from inside the bar, never from the page
        if(active&&!card.contains(active)){cardReturn=active;cardGet.focus({preventScroll:true});}
        announce(cardTitle.textContent);
      }else{
        const back=cardReturn?.isConnected&&cardReturn.getClientRects().length?cardReturn:play;
        if(focusInside)back.focus({preventScroll:true});
        cardReturn=null;
      }
    }
    placeCard();
  };
  cardGet.addEventListener('click',()=>send('voiceCardGet',cardGet.dataset.id));
  cardSmaller.addEventListener('click',()=>send('voiceCardGet',cardSmaller.dataset.id));
  cardSample.addEventListener('click',()=>{if(cardData?.primary)voiceUi.previewSample(cardData.primary);});
  cardKeep.addEventListener('click',()=>send('voiceCardKeep'));
  cardClose.addEventListener('click',()=>send('voiceCardClose'));
  cardCancel.addEventListener('click',()=>{if(cardCancel.dataset.id)send('cancelDownload',cardCancel.dataset.id);});
  const cardStyle=document.createElement('style');cardStyle.textContent=[
    '.reader-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);',
    'white-space:nowrap;border:0}',
    '.voice-card{position:fixed;z-index:9;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;',
    'padding:10px 12px 12px;',
    'background:var(--reader-paper);color:var(--reader-ink);border:1px solid var(--reader-line);border-radius:11px;',
    'box-shadow:var(--reader-shadow);font-size:12px;line-height:1.4;pointer-events:auto;cursor:default}',
    // the card gives way to the panels that sit at the same place
    '.voice-card[hidden],',
    '.bar:has(.voice-menu[data-open],.settings-panel[data-open],.reader-error:not([hidden])) .voice-card[data-mode=card]{display:none}',
    '.vc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}',
    '.vc-title{font-size:12px;font-weight:600;line-height:1.4;padding-top:3px}',
    '.vc-close{display:flex;align-items:center;justify-content:center;flex:none;width:26px;min-height:26px;padding:0;',
    'border-color:transparent;background:transparent;color:var(--reader-muted)}',
    '.vc-close svg{width:16px;height:16px}.vc-close:hover{border-color:var(--reader-muted)}',
    '.vc-actions{display:flex;flex-wrap:wrap;gap:6px}',
    '.vc-actions button{min-height:30px;padding:4px 10px;font-size:12px}',
    '.vc-actions .vc-get{background:var(--reader-accent);border-color:var(--reader-accent);',
    'color:var(--reader-on-accent);font-weight:600}',
    '.vc-actions .vc-get:hover{filter:brightness(1.08)}',
    '.vc-sample[aria-pressed=true]{color:var(--reader-accent);border-color:var(--reader-accent)}',
    '.vc-actions [hidden],.voice-card [hidden]{display:none!important}',
    '.vc-note{margin:0;font-size:11px;color:var(--reader-muted)}',
    '.vc-progress{display:none;flex-wrap:wrap;align-items:center;gap:6px 10px}',
    '.voice-btn{position:relative}',
    // a running voice download: the voice button's outline fills clockwise from twelve o'clock (no panel, no extra bar)
    '.voice-btn[data-downloading]::after{content:\'\';position:absolute;inset:-2px;border-radius:9px;padding:2px;',
    'background:conic-gradient(var(--reader-accent) calc(var(--vc-progress,0)*1%),transparent 0);',
    '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;',
    'mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;pointer-events:none}',
    '.vc-line{flex:1 1 0;min-width:0;font-size:12px;font-variant-numeric:tabular-nums}',
    '.vc-cancel{flex:none;min-height:26px;padding:2px 10px;font-size:11px}',
    '.vc-meter{flex:1 0 100%;display:block;box-sizing:border-box;width:100%;height:4px;margin:0;',
    'border:0;border-radius:2px;',
    'overflow:hidden;-webkit-appearance:none;appearance:none;background:var(--reader-line)}',
    '.vc-meter::-webkit-progress-bar{background:transparent}',
    '.vc-meter::-webkit-progress-value{background:var(--reader-accent)}',
    '.vc-meter::-moz-progress-bar{background:var(--reader-accent)}',
    '.error-actions{display:flex;flex-wrap:wrap;gap:6px}.error-voice{font-size:11px}',
  ].join('');shadow.append(cardStyle);
  card.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||card.dataset.mode!=='card')return;
    event.preventDefault();event.stopPropagation();send('voiceCardClose');
  });
  card.addEventListener('pointerdown',event=>event.stopPropagation());
  error.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeError(true);}});error.addEventListener('pointerdown',event=>event.stopPropagation());error.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
  const outsideError=event=>{if(errorOpen&&!event.composedPath().includes(error)&&!event.composedPath().includes(errorTrigger))closeError(false);};document.addEventListener('pointerdown',outsideError,true);disposers.push(()=>document.removeEventListener('pointerdown',outsideError,true));
  const placeOpenMenus=()=>{placeError();for(const place of placeExtras)place();};shadow.addEventListener('pointermove',placeOpenMenus);disposers.push(()=>shadow.removeEventListener('pointermove',placeOpenMenus));

  const settings=$('.settings-panel');
  const sharedSettings=mountSharedSettings({shadow,settings,t,icon,locales,formats,getLocale:()=>locale,getFormatPrefs:()=>formatPrefs,settingsScope,send,appearanceController,onPlayerTheme,keyboard:kb,makeSwitch,createSelect,listen,disposers,speech:{send,anchorPanel,closeOtherMenus,dropdowns,centerIcons,idPrefix:'svp',css:false,isPlaying:()=>playing,getVolume:()=>({volume:latest.volume,muted:latest.muted}),registryUrl:pickerUrls.registry||'',eloUrl:pickerUrls.elo||'',sampleBase:pickerUrls.samples||''}});   /* round 3: Settings hold settings only; chapters, focus, bookmark, close, summarize and download are actions on the bar and in its More menu */
  const {content,localeSelect,localeUi,appearanceValue}=sharedSettings;
  /* Download menu (round 3): What? (whole page / from here / selection), As? (MP3, WAV, PDF, HTML with benefit and estimate), voice and tempo,
     one Download button, progress with remaining time and Cancel, "Done · Show file" or "Retry" (session/download-menu.mjs, shared with the file view). */
  const exports=document.createElement('section');exports.className='export-settings';const downloadMenu=createDownloadMenu({document,t,number:(value,options)=>formats.number(value,formatPrefs,options),send,announce:text=>announce(text),glyph});exports.append(downloadMenu.root);const downloadMenuCss=document.createElement('style');downloadMenuCss.textContent=DOWNLOAD_MENU_CSS;shadow.append(downloadMenuCss);
  const downloadButton=document.createElement('button');downloadButton.type='button';downloadButton.className='download-trigger';downloadButton.innerHTML=glyph('download')+'<span data-i18n="extDownload"></span>';downloadButton.setAttribute('aria-haspopup','dialog');downloadButton.setAttribute('aria-expanded','false');$('.settingsToggle').before(downloadButton);const downloadPanel=document.createElement('div');downloadPanel.className='download-menu';downloadPanel.setAttribute('role','dialog');downloadPanel.id='reader-download-menu';downloadButton.setAttribute('aria-controls',downloadPanel.id);const downloadContent=document.createElement('div');downloadContent.className='download-content';downloadPanel.append(downloadContent);downloadContent.append(exports);bar.append(downloadPanel);let downloadOpen=false;
  const downloadAnchor=()=>{const more=$('.more-toggle');if(more&&more.getBoundingClientRect().width>0)return more;if(settingsMode!=='inline')return $('.settingsToggle');const r=downloadButton.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight?downloadButton:play;};
  placeDirect=()=>{if(!downloadOpen)return;anchorPanel(downloadPanel,downloadAnchor(),{width:316,cap:400,min:80,fit:room=>{downloadContent.style.maxHeight=(room-2)+'px';}});};
  closeDirect=refocus=>{if(!downloadOpen)return;downloadOpen=false;downloadPanel.removeAttribute('data-open');downloadButton.setAttribute('aria-expanded','false');if(refocus)downloadAnchor().focus();};
  onDownloadStart=()=>{if(downloadOpen)closeDirect(false);};
  downloadButton.addEventListener('click',()=>{if(downloadOpen){closeDirect(false);return;}closeOtherMenus(null);settings.removeAttribute('data-open');$('.settingsToggle').setAttribute('aria-expanded','false');downloadOpen=true;downloadMenu.opened();downloadPanel.setAttribute('data-open','');downloadButton.setAttribute('aria-expanded','true');placeDirect();centerIcons();});
  /* the menu changes height (result -> form with "Another file", progress): it is placed again at its anchor, so it never runs out of the window (round 4) */
  if(typeof ResizeObserver==='function'){const resized=new ResizeObserver(()=>placeDirect());resized.observe(exports);disposers.push(()=>resized.disconnect());}
  downloadPanel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDirect(true);}});downloadPanel.addEventListener('pointerdown',event=>event.stopPropagation());downloadPanel.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});const closeOutsideDownload=event=>{if(downloadOpen&&!event.composedPath().includes(downloadPanel)&&!event.composedPath().includes(downloadButton))closeDirect(false);};document.addEventListener('pointerdown',closeOutsideDownload,true);disposers.push(()=>document.removeEventListener('pointerdown',closeOutsideDownload,true));
  const themeButton=document.createElement('button');themeButton.type='button';themeButton.className='theme-toggle';themeButton.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 14a8 8 0 0 1-10-10 9 9 0 1 0 10 10z"/></svg>';themeButton.setAttribute('aria-pressed','false');const focusButton=document.createElement('button');focusButton.type='button';focusButton.className='focus-toggle';focusButton.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8M8 12h8M8 16h5"/></svg>';const focusCss=document.createElement('style');focusCss.textContent=".focus-toggle[aria-pressed=true]{color:var(--reader-accent);border-color:var(--reader-line);background:var(--reader-soft)}";shadow.append(focusCss);downloadButton.before(themeButton,focusButton);themeButton.addEventListener('click',()=>{closeOtherMenus(null);send('toggleTheme');});focusButton.addEventListener('click',()=>{closeOtherMenus(null);send('openFocus');});
  // Guided explanation (explain/tutor.mjs): one click in the header next to Focus/Dark; the compact mode and narrow windows have no room there, the settings menu offers the same action.
  const explainButton=document.createElement('button');explainButton.type='button';explainButton.className='explain-toggle';explainButton.setAttribute('aria-pressed','false');explainButton.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>';explainButton.addEventListener('pointerdown',event=>event.preventDefault());explainButton.addEventListener('click',()=>{closeOtherMenus(null);send('explainPage');});const explainCss=document.createElement('style');explainCss.textContent=".reader-top .explain-toggle{border:1px solid transparent;background:transparent;color:var(--reader-muted)}.reader-top .explain-toggle svg{width:17px;height:17px}.reader-top .explain-toggle:hover{border-color:var(--reader-muted)}.reader-top .explain-toggle[aria-pressed=true]{color:var(--reader-accent)}.bar[data-overlay-mode=light]>.reader-top .explain-toggle{display:none!important}@media(max-width:453px){.bar[data-overlay-mode=expert]>.reader-top .explain-toggle{display:none!important}}";shadow.append(explainCss);
  /* Error button: red button shown right of AI Summarize (expert) / left of mode switch (light) */
  const errorButtonExpert=document.createElement('button');errorButtonExpert.type='button';errorButtonExpert.className='error-action-button';errorButtonExpert.hidden=true;errorButtonExpert.setAttribute('aria-haspopup','dialog');errorButtonExpert.setAttribute('aria-expanded','false');errorButtonExpert.setAttribute('aria-controls','reader-error-details');errorButtonExpert.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 10 18H2zM12 9v5m0 3v.01"/></svg><span class="error-button-text" data-i18n="errorDetails"></span>';
  const errorButtonLight=document.createElement('button');errorButtonLight.type='button';errorButtonLight.className='error-action-button';errorButtonLight.hidden=true;errorButtonLight.setAttribute('aria-haspopup','dialog');errorButtonLight.setAttribute('aria-expanded','false');errorButtonLight.setAttribute('aria-controls','reader-error-details');errorButtonLight.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 10 18H2zM12 9v5m0 3v.01"/></svg><span class="error-button-text" data-i18n="errorDetails"></span>';
  /* Header, round 3 (owner request): left = drag grip, "More" (Lucide ellipsis) and the quick "Summarize" button (the sparkle, the glyph of the popup's
     card); right = bookmark, compact/expert, close. Focus view, night mode, download and settings moved into the More menu; their original buttons stay in the
     tree with zero size (state, titles, shortcuts and the Settings mirror keep their one implementation) and a menu entry clicks them. The compact bar's menu
     also offers Summarize and Voice (the bar's own voice picker), whose buttons it does not show. */
  /* Summarize (round 4, owner request): an own sparkle, a four-pointed star with a small companion star, drawn in the stroke of the other icons (not the Gemini mark) */
  const SPARKLE='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 5.5Q10.8 12.2 17.5 13Q10.8 13.8 10 20.5Q9.2 13.8 2.5 13Q9.2 12.2 10 5.5z"/><path d="M18 2.5Q18.4 5.1 21 5.5Q18.4 5.9 18 8.5Q17.6 5.9 15 5.5Q17.6 5.1 18 2.5z"/></svg>';explainButton.innerHTML=SPARKLE;
  const moreButton=document.createElement('button');moreButton.type='button';moreButton.className='more-toggle';moreButton.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';moreButton.setAttribute('aria-haspopup','menu');moreButton.setAttribute('aria-expanded','false');
  const moreMenu=document.createElement('div');moreMenu.className='more-menu';moreMenu.setAttribute('role','menu');moreMenu.id='reader-more-menu';moreMenu.hidden=true;moreButton.setAttribute('aria-controls',moreMenu.id);bar.append(moreMenu);
  const displayed=node=>!!node&&node.getClientRects().length>0;let moreOpen=false;
  /* [key, glyph, label, action, offered, source button (its tooltip and aria-keyshortcuts carry the shortcut)] */
  const MORE_ITEMS=[
    ['summarize',()=>SPARKLE,()=>t('tutor_start'),()=>explainButton.click(),()=>!displayed(explainButton),()=>explainButton],
    ['focus',()=>focusButton.innerHTML,()=>focusButton.getAttribute('aria-label')||t('openFocus'),()=>focusButton.click(),()=>!focusButton.disabled,()=>focusButton],
    ['theme',()=>themeButton.innerHTML,()=>t('nightMode'),()=>themeButton.click(),()=>true,()=>themeButton],
    ['download',()=>glyph('download'),()=>t('extDownload'),()=>{downloadButton.click();if(downloadButton.getAttribute('aria-expanded')==='true')requestAnimationFrame(()=>downloadMenu.focusFirst());},()=>true,()=>downloadButton],
    ['voice',()=>glyph('language'),()=>t('languageVoice'),()=>{const button=$('.reader-controls .voice-btn');if(button&&!button.disabled)button.click();},()=>!displayed($('.reader-controls .voice-btn')),()=>$('.reader-controls .voice-btn')],
    ['settings',()=>icon('gear'),()=>t('settings'),()=>$('.settingsToggle').click(),()=>settingsMode!=='inline',()=>$('.settingsToggle')],
  ];
  const moreRows=MORE_ITEMS.map(([key])=>{const row=document.createElement('button');row.type='button';row.className='more-item';row.dataset.more=key;row.tabIndex=-1;row.setAttribute('role',key==='theme'||key==='summarize'?'menuitemcheckbox':'menuitem');row.innerHTML='<span class="more-icon"></span><span class="more-label"></span><span class="more-state" aria-hidden="true"></span>';moreMenu.append(row);return row;});
  const paintMore=()=>{MORE_ITEMS.forEach(([key,glyphOf,labelOf,,offered,sourceOf],i)=>{const row=moreRows[i],show=offered();row.hidden=!show;if(!show)return;const source=sourceOf(),tip=source?.getAttribute('title')||'',keys=source?.getAttribute('aria-keyshortcuts');if(row.title!==tip)row.title=tip;if(keys)row.setAttribute('aria-keyshortcuts',keys);else row.removeAttribute('aria-keyshortcuts');const svg=glyphOf();if(row.dataset.glyph!==svg){row.dataset.glyph=svg;row.querySelector('.more-icon').innerHTML=svg;}const label=labelOf();if(row.querySelector('.more-label').textContent!==label)row.querySelector('.more-label').textContent=label;if(key==='theme'||key==='summarize'){const on=(key==='theme'?themeButton:explainButton).getAttribute('aria-pressed')==='true';row.setAttribute('aria-checked',String(on));row.querySelector('.more-state').textContent=on?'✓':'';}if(key==='download')row.disabled=downloadButton.disabled;});moreButton.title=t('moreMenu');moreButton.setAttribute('aria-label',t('moreMenu'));moreMenu.setAttribute('aria-label',t('moreMenu'));};
  const moreFocusable=()=>moreRows.filter(row=>!row.hidden&&!row.disabled);
  const placeMore=()=>{if(moreOpen)anchorPanel(moreMenu,moreButton,{width:240,cap:340,min:80,fit:room=>{moreMenu.style.maxHeight=room+'px';}});};placeExtras.push(placeMore);
  closeMore=refocus=>{if(!moreOpen)return;moreOpen=false;moreMenu.hidden=true;moreMenu.removeAttribute('data-open');moreButton.setAttribute('aria-expanded','false');if(refocus)moreButton.focus({preventScroll:true});};
  const openMore=focusFirst=>{closeOtherMenus(null);settings.removeAttribute('data-open');$('.settingsToggle').setAttribute('aria-expanded','false');paintMore();moreOpen=true;moreMenu.hidden=false;moreMenu.setAttribute('data-open','');moreButton.setAttribute('aria-expanded','true');placeMore();if(focusFirst)moreFocusable()[0]?.focus({preventScroll:true});};
  moreButton.addEventListener('click',event=>{event.stopPropagation();if(moreOpen)closeMore(false);else openMore(true);});
  moreButton.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();if(!moreOpen)openMore(false);const rows=moreFocusable();rows[event.key==='ArrowUp'?rows.length-1:0]?.focus({preventScroll:true});}else if(event.key==='Escape'&&moreOpen){event.preventDefault();event.stopPropagation();closeMore(true);}});
  moreRows.forEach((row,i)=>row.addEventListener('click',()=>{if(row.disabled)return;const run=MORE_ITEMS[i][3],key=MORE_ITEMS[i][0];closeMore(['theme'].includes(key));run();if(key==='theme')paintMore();}));
  moreMenu.addEventListener('keydown',event=>{const rows=moreFocusable(),at=rows.indexOf(shadow.activeElement);if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMore(true);}else if(event.key==='Tab')closeMore(false);else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();if(!rows.length)return;const next=event.key==='Home'?0:event.key==='End'?rows.length-1:event.key==='ArrowDown'?(at+1)%rows.length:(at<=0?rows.length-1:at-1);rows[next].focus({preventScroll:true});}else event.stopPropagation();});
  moreMenu.addEventListener('pointerdown',event=>event.stopPropagation());
  const closeOutsideMore=event=>{if(moreOpen&&!event.composedPath().includes(moreMenu)&&!event.composedPath().includes(moreButton))closeMore(false);};document.addEventListener('pointerdown',closeOutsideMore,true);disposers.push(()=>document.removeEventListener('pointerdown',closeOutsideMore,true));
  const moreCss=document.createElement('style');moreCss.textContent=".reader-top .more-toggle{border:1px solid transparent;background:transparent;color:var(--reader-muted)}.reader-top .more-toggle svg{width:17px;height:17px}.reader-top .more-toggle:hover{border-color:var(--reader-muted)}.reader-top .more-toggle[aria-expanded=true]{color:var(--reader-ink)}"+
    ".reader-row-hidden{display:flex;width:0;height:0;overflow:hidden}.reader-row-hidden>button{width:0!important;min-width:0!important;max-width:0!important;height:0!important;min-height:0!important;padding:0!important;border:0!important;margin:0!important;overflow:hidden}"+
    ".more-menu{position:fixed;z-index:8;display:flex;flex-direction:column;gap:2px;box-sizing:border-box;min-width:200px;padding:6px;overflow:auto;overscroll-behavior:contain;background:var(--reader-paper);color:var(--reader-ink);border:1px solid var(--reader-line);border-radius:11px;box-shadow:var(--reader-shadow);font:13px/1.3 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:default}.more-menu[hidden]{display:none}"+
    ".more-item{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;padding:6px 10px;border:0;border-radius:7px;background:transparent;color:var(--reader-ink);font:inherit;text-align:left;cursor:pointer}.more-item[hidden]{display:none}.more-item:disabled{opacity:.5;cursor:default}"+
    ".more-item:hover:not(:disabled),.more-item:focus-visible{background:var(--reader-option-hover,var(--reader-soft));box-shadow:inset 0 0 0 2px var(--reader-option-ring,var(--reader-accent));outline:none}"+
    ".more-icon{display:inline-flex;flex:none;width:17px;height:17px;color:var(--reader-muted)}.more-icon svg{width:17px;height:17px}.more-label{flex:1 1 auto;min-width:0}.more-state{flex:none;min-width:12px;color:var(--reader-accent);font-weight:700}";
  shadow.append(moreCss);
  const appearanceCss=document.createElement('style');appearanceCss.textContent=".theme-toggle,.focus-toggle{display:flex;align-items:center;justify-content:center;flex:none;width:26px;min-height:26px;padding:0;border-color:transparent;background:transparent;color:var(--reader-muted)}.theme-toggle svg,.focus-toggle svg{width:17px;height:17px}.theme-toggle[aria-pressed=true]{color:var(--reader-accent);border-color:var(--reader-line);background:var(--reader-soft)}@supports (-moz-appearance:none){input[type=range]:not(.vol-range):not(.seek-progress){accent-color:#0075ff}}@media(max-width:420px){.reader-top{gap:4px}.reader-top .reader-title{max-width:44px}.reader-top .section-label{flex:1 1 80px;max-width:100px}.status-slot{flex:0 0 18px;min-width:18px}.theme-toggle,.focus-toggle{width:24px}}";shadow.append(appearanceCss);
  // One header row, left to right: brand "beNotable!" (never replaced by state), state word in a fixed-width slot (ellipsis, so its length never moves anything), chapter dropdown pushed to the right end. Dropdown position depends on no state text.
  const headerCss=document.createElement('style');headerCss.textContent=".reader-top .reader-title{flex:none!important;max-width:none!important;overflow:visible!important}.reader-top .status-slot{flex:0 0 64px!important;width:64px!important;min-width:0!important;max-width:64px!important;overflow:hidden}.reader-top .status{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reader-top .section-label{flex:0 1 150px!important;min-width:84px!important;max-width:170px!important;margin:0!important}.reader-top .status-slot{margin-right:auto!important}@media(max-width:420px){.reader-top .status-slot{flex-basis:50px!important;width:50px!important;max-width:50px!important}.reader-top .section-label{flex:0 1 112px!important;min-width:84px!important;max-width:112px!important}.reader-top .chapter-trigger{padding:3px 5px!important;gap:3px!important}}";shadow.append(headerCss);
  const compactStyle=document.createElement('style');compactStyle.textContent="\n    .reader-timeline{padding-top:2px;padding-bottom:7px}.seek-progress{height:18px;margin:0}\n";shadow.append(compactStyle);
  const loadingStyle=document.createElement('style');loadingStyle.textContent=speechControls.RANGE_CSS;shadow.append(loadingStyle);const verticalCenterStyle=document.createElement('style');verticalCenterStyle.textContent=".speed-trigger .reader-value,.chapter-trigger .reader-value{position:relative;top:1px}.reader-top .reader-title{padding-top:2px}.reader-top .status{padding-top:5px;padding-bottom:3px}.vol-btn>svg,.speed-trigger>svg:first-child,.voice-btn>.language-icon svg{transform:translateY(-.5px)!important}";shadow.append(verticalCenterStyle);
  const regroupStyle=document.createElement('style');regroupStyle.textContent=".retired-controls{display:none!important}.download-content{padding:12px 12px 10px}";shadow.append(regroupStyle);
  {const top=$('.reader-top'),right=document.createElement('span');right.className='top-right';let hit=false;for(const el of [...top.children]){if(hit)right.append(el);else if(el.classList.contains('reader-title'))hit=true;}top.append(right);const bookmarkHost=document.createElement('span');bookmarkHost.className='reader-bookmark-slot';downloadButton.before(bookmarkHost);}
  /* the download trigger is reached through the More menu (round 3); it waits with zero size in the header's hidden holder */
  /* The guided explanation is started from category 1 by the mirror of the bar's own explain button (shared settings, actions); no second trigger. */
  // A mode is a presentation of this one original player, never a second renderer.
  const modeHost=document.createElement('span');modeHost.className='reader-mode-slot';const modeButton=document.createElement('button');modeButton.type='button';modeButton.className='overlay-mode-toggle';modeHost.append(modeButton);$('.closeReader').before(modeHost);let modeChoice=null;
  const renderBrand=()=>{const brand=$('.reader-title');if(!brand.querySelector('.reader-title-kind'))brand.innerHTML='<span class="reader-title-product">beNotable!</span> <span class="reader-title-kind">Reader</span>';brand.setAttribute('aria-label','beNotable! Reader');if(!brand.parentElement.classList.contains('reader-brand')){const group=document.createElement('span');group.className='reader-brand';brand.before(group);group.innerHTML='<svg class="reader-brand-logo" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#256249"/><g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 10.5C11.5 8.5 8.5 8.5 5.5 9.5v13c3-1 6-1 9 1 1.8-1.2 3.8-1.6 5.5-1.4V12.5M14.5 10.5v13"/><path stroke="#9ad0b4" d="M23 11.5c2 2 2 5 0 7M26 8.5c3.5 3.7 3.5 9.3 0 13"/></g></svg>';group.append(brand);}};
  const paintMode=value=>{const mode=value==='light'?'light':'expert',isLight=mode==='light',changed=bar.dataset.overlayMode!==mode;bar.dataset.overlayMode=mode;const bookmark=$('.reader-bookmark-slot'),bookmarkParent=isLight?$('.follow-label'):$('.top-right');if(bookmark&&bookmark.parentElement!==bookmarkParent){const active=shadow.activeElement;bookmarkParent.insertBefore(bookmark,isLight?$('.select-text'):modeHost);if(active&&bookmark.contains(active))active.focus({preventScroll:true});}renderBrand();const volumeHeading=$('.vol-pop>.fx-title');if(volumeHeading)volumeHeading.textContent=t(isLight?'volume':'fxSound');const label=t(isLight?'overlayModeToExpert':'overlayModeToLight');modeButton.title=label;modeButton.setAttribute('aria-label',label);const name=isLight?'expert':'light';if(modeButton.dataset.icon!==name){modeButton.dataset.icon=name;modeButton.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24">'+(isLight?'<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>':'<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>')+'</svg>';}if(changed){kb?.applyAll();relayout();}};
  modeButton.addEventListener('click',()=>{const value=bar.dataset.overlayMode==='light'?'expert':'light';modeChoice={value,version:Number(latest.preferenceVersion)||0};closeOtherMenus(null);settings.removeAttribute('data-open');$('.settingsToggle').setAttribute('aria-expanded','false');paintMode(value);send('overlayMode',value);});
  {const top=$('.reader-top'),left=document.createElement('span');left.className='top-left';top.prepend(left);left.append($('.handle'),moreButton,explainButton,errorButtonExpert);const hidden=document.createElement('span');hidden.className='reader-row-hidden';hidden.setAttribute('aria-hidden','true');for(const button of [$('.settingsToggle'),focusButton,themeButton,downloadButton]){button.tabIndex=-1;hidden.append(button);}left.append(hidden);const right=$('.top-right');right.append($('.status-slot'),$('.reader-bookmark-slot'),errorButtonLight,modeHost,$('.closeReader'));}
  /* Error button click handler - opens error details dialog */
  const openErrorDialog=()=>{if(errorOpen){closeError(true);return;}closeOtherMenus(null);$('.settings-panel').removeAttribute('data-open');$('.settingsToggle').setAttribute('aria-expanded','false');errorOpen=true;error.hidden=false;errorButtonExpert.setAttribute('aria-expanded','true');errorButtonLight.setAttribute('aria-expanded','true');placeError();errorDismiss.focus({preventScroll:true});centerIcons();};
  errorButtonExpert.addEventListener('click',event=>{event.stopPropagation();openErrorDialog();});
  errorButtonLight.addEventListener('click',event=>{event.stopPropagation();openErrorDialog();});
  const modeStyle=document.createElement('style');modeStyle.textContent=`
/* Shared toolbar sizes; keep the original round Play and balanced side groups. */
.bar{--reader-control-size:30px;--reader-control-gap:2px}
.bar[data-overlay-mode=expert]{width:430px}
.bar>.reader-top{position:relative;display:grid;grid-template-columns:minmax(0,1fr) max-content minmax(0,1fr);gap:var(--reader-control-gap);align-items:center;padding:6px 10px 2px}
.reader-top>.top-left,.reader-top>.top-right{display:flex;align-items:center;gap:var(--reader-control-gap);min-width:0}
.reader-top>.top-left{grid-column:1;justify-self:start}.reader-top>.top-right{grid-column:3;justify-self:end}
.reader-top button,.reader-top .handle,.bar>.reader-controls :is(.speed-trigger,.vol-btn,.voice-btn,.chapter-trigger,.previous-section,.primary,.next-section,.select-text,.follow,.bookmark-current){display:inline-flex;align-items:center;justify-content:center;flex:none;width:var(--reader-control-size);min-width:var(--reader-control-size);max-width:var(--reader-control-size);height:var(--reader-control-size);min-height:var(--reader-control-size);max-height:var(--reader-control-size);margin:0;padding:3px;border-radius:7px}
.reader-top :is(.settingsToggle,.closeReader){background:transparent;color:var(--reader-muted)}
.reader-top .settingsToggle{border:1px solid transparent}
.reader-top .closeReader{border:1px solid transparent}
.reader-top :is(.settingsToggle,.focus-toggle,.theme-toggle,.closeReader):hover{border-color:var(--reader-muted)}
.reader-top .reader-brand{grid-column:2;grid-row:1;justify-self:center;display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;width:max-content}
.reader-brand>.reader-brand-logo{width:24px;height:24px;stroke:none;fill:none}
.reader-brand>.reader-title{display:flex;flex-direction:column;align-items:flex-start;text-align:left;line-height:1.12;font-size:11px;padding:0;white-space:nowrap}
.reader-title-product{font-weight:700}.reader-title-kind{font-weight:400}
/* The state word takes the free room of the right group (at 11 px "Loading…" needs 51 px, the old slot had 48): the
   group spans its grid column with the buttons at its outer edge, the word fills what is left (6 px from the brand,
   at most 72 px) and ends with an ellipsis. */
.reader-top>.top-right{justify-self:stretch;justify-content:flex-end}
.reader-top .status-slot{flex:1 1 0!important;width:auto!important;max-width:72px!important;min-width:0!important;
  margin:0 0 0 6px!important}
.reader-top .status{padding:4px 0}
.reader-mode-slot,.reader-bookmark-slot{display:flex;align-items:center;justify-content:center;width:var(--reader-control-size);min-width:var(--reader-control-size)}
.overlay-mode-toggle{border:1px solid transparent;background:transparent;color:var(--reader-muted)}
.overlay-mode-toggle svg{width:17px;height:17px}.overlay-mode-toggle:hover{border-color:var(--reader-muted)}
/* An error gets its own space, including when the bar is dragged to the top. */
.bar>.reader-top:has(.status-slot[data-error]){padding-bottom:36px}
.reader-top .status-slot[data-error]{position:absolute;left:10px;right:10px;bottom:3px;top:auto;width:auto!important;
  max-width:none!important;height:var(--reader-control-size);margin:0!important}
.reader-top .status-slot[data-error]>.status{display:none}
.reader-top .error-trigger{position:relative;inset:auto;width:auto;max-width:100%;height:var(--reader-control-size);
  padding:0 8px 0 7px;gap:5px;border:1px solid var(--reader-line);border-radius:7px;background:var(--reader-paper);
  font-size:11px}
/* Error action button: red button right of AI Summarize (expert) / left of mode switch (light) */
.error-action-button{display:inline-flex;align-items:center;gap:5px;height:var(--reader-control-size);min-height:var(--reader-control-size);padding:0 8px;border:1px solid var(--reader-error,#c0392b);border-radius:7px;background:var(--reader-error,#c0392b);color:var(--reader-on-error,#fff);font-size:11px;font-weight:600;white-space:nowrap}
.error-action-button svg{width:14px;height:14px;flex:none}
.error-action-button:hover{border-color:color-mix(in srgb,var(--reader-error,#c0392b) 80%,black);background:color-mix(in srgb,var(--reader-error,#c0392b) 80%,black)}
.error-action-button:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}
.error-action-button[hidden]{display:none!important}
/* Expert mode: show error button right of explain button in top-left */
.bar[data-overlay-mode=expert] .top-left .error-action-button{display:inline-flex}
/* Light mode: show error button left of mode switch in top-right */
.bar[data-overlay-mode=light] .top-right .error-action-button{display:inline-flex}
.settings-panel .download-trigger{display:inline-flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;min-height:34px;padding:6px 10px;border:1px solid var(--reader-line);border-radius:7px;font-size:12px;background:var(--reader-paper)}
.bar>.reader-controls{display:grid;grid-template-columns:minmax(0,1fr) var(--reader-control-size) 36px var(--reader-control-size) minmax(0,1fr);column-gap:var(--reader-control-gap);row-gap:var(--reader-control-gap);align-items:center;padding:2px 10px 6px}
.bar>.reader-controls>.controls-left{grid-column:1;grid-row:1;display:flex;align-items:center;justify-content:flex-start;gap:var(--reader-control-gap);min-width:0}
.bar>.reader-controls>.previous-section{grid-column:2;grid-row:1}.bar>.reader-controls>.primary{grid-column:3;grid-row:1;justify-self:center;width:36px;min-width:36px;max-width:36px;height:36px;min-height:36px;max-height:36px;padding:0;border-radius:50%}.bar>.reader-controls>.next-section{grid-column:4;grid-row:1}
.bar>.reader-controls>.controls-right{grid-column:5;grid-row:1;display:flex;align-items:center;justify-content:flex-end;gap:var(--reader-control-gap);min-width:0}
.bar>.reader-controls .speed-control{width:40px;min-width:40px;height:var(--reader-control-size);min-height:var(--reader-control-size);flex:none;padding:0;margin:0;border:0}
.bar>.reader-controls .speed-trigger{width:40px;min-width:40px;max-width:40px;gap:0;padding:0;font-size:11px;border-color:var(--reader-line);background:var(--reader-paper)}
.bar>.reader-controls .speed-trigger:hover{border-color:var(--reader-muted)}
.bar>.reader-controls .speed-trigger .reader-value{flex:none;overflow:visible;text-align:center;top:0}
.bar>.reader-controls .speed-trigger>:not(.reader-value){display:none!important}
.bar>.reader-controls .vol{width:var(--reader-control-size);flex:none;margin:0}
.bar>.reader-controls .voice{flex:none;width:78px;min-width:0;max-width:78px;padding:0;margin:0}
.bar>.reader-controls .voice-btn.voice-btn{gap:4px;padding:4px 6px;min-width:78px;max-width:78px;width:78px;border-color:var(--reader-line);background:var(--reader-paper)}
.bar>.reader-controls .voice-btn:hover{border-color:var(--reader-muted)}
.bar>.reader-controls .voice-btn>:not(.vn):not(.language-icon){display:none!important}
.bar>.reader-controls .voice-btn>.language-icon{display:inline-flex!important;flex:none;align-items:center;justify-content:center;width:17px;height:17px}
.bar>.reader-controls .voice-btn .vn{mask-image:none;-webkit-mask-image:none;text-overflow:ellipsis}
.bar>.reader-controls .section-label{flex:none;min-width:0;max-width:88px;width:88px;margin:0;padding:0}
.bar>.reader-controls .chapter-trigger{min-width:88px;max-width:88px;width:88px;padding:4px 6px;gap:4px}
.bar>.reader-controls .chapter-trigger>svg{width:14px;height:14px}.bar>.reader-controls .chapter-trigger>.chevron{display:none}
.bar>.reader-controls .chapter-trigger .reader-value{display:none}.bar>.reader-controls .chapter-trigger .reader-fixed-label{flex:1;min-width:0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar>.reader-controls .follow-label{display:flex;flex:none;align-items:center;gap:var(--reader-control-gap);margin:0}
.bar>.reader-controls :is(.speed-trigger,.vol-btn,.voice-btn,.chapter-trigger)[aria-expanded=true]{border-color:var(--reader-accent)}
.bar[data-overlay-mode=light]{width:292px}
.bar[data-overlay-mode=light]>.reader-controls{grid-template-columns:72px 30px 36px 30px 94px}
.bar[data-overlay-mode=light]>.reader-top .reader-brand{transform:translateX(-11px)}
.bar[data-overlay-mode=light]>.reader-top :is(.focus-toggle,.theme-toggle),.bar[data-overlay-mode=light]>.reader-top .status-slot:not([data-error]){display:none!important}
.bar[data-overlay-mode=light]>.reader-controls .voice,.bar[data-overlay-mode=light]>.reader-controls .section-label,.bar[data-overlay-mode=light]>.reader-timeline{display:none!important}
.bar[data-overlay-mode=light] :is(.vol-pop,.speed-pop):not(.settings-pop) :is(.fx-sep,.fx-grid,.fx-foot),.bar[data-overlay-mode=light] .speed-pop:not(.settings-pop)>.fx-title:not(:first-child){display:none!important}
.bar[data-overlay-mode=light] :is(.vol-pop,.speed-pop).has-fx:not(.settings-pop){--fx-label:30px;--fx-out:54px;width:min(260px,calc(100vw - 24px))!important;padding:10px 12px;max-height:120px}
@media(max-width:453px){
.bar[data-overlay-mode=expert]>.reader-top .top-left{display:grid;grid-template-columns:repeat(2,var(--reader-control-size));gap:var(--reader-control-gap)}
.bar[data-overlay-mode=expert]>.reader-top .status-slot:not([data-error]){display:none!important}
.bar[data-overlay-mode=expert]>.reader-controls>.controls-left,.bar[data-overlay-mode=expert]>.reader-controls>.controls-right{display:contents}
.bar[data-overlay-mode=expert]>.reader-controls .speed-control{grid-column:1;grid-row:1;justify-self:start;margin:0}
.bar[data-overlay-mode=expert]>.reader-controls .vol{grid-column:1;grid-row:1;justify-self:start;margin-left:42px}
.bar[data-overlay-mode=expert]>.reader-controls .voice{grid-column:1/3;grid-row:2;justify-self:start}
.bar[data-overlay-mode=expert]>.reader-controls .section-label{grid-column:4/6;grid-row:2;justify-self:end}
.bar[data-overlay-mode=expert]>.reader-controls .follow-label{grid-column:5;grid-row:1;justify-self:end}
}
`;shadow.append(modeStyle);paintMode('expert');
  if(settingsMode==='inline'){settings.dataset.inline='';bar.dataset.settingsInline='';$('.settingsToggle').hidden=true;$('.settingsToggle').setAttribute('aria-hidden','true');$('.settingsToggle').tabIndex=-1;}
  const syncAppearanceTheme=()=>{const value=appearanceValue(),effective=appearanceController?.snapshot(),dark=value.mode==='dark'||value.mode==='auto'&&effective?.systemDark;const state=value.mode||'off';themeButton.dataset.state=state;themeButton.setAttribute('aria-pressed',String(Boolean(dark)));const paths=state==='light'?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>':state==='auto'?'<circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 3a9 9 0 0 1 0 18"/>':dark?'<path d="M20 14a8 8 0 0 1-10-10 9 9 0 1 0 10 10zM14 14l2 2 4-4"/>':'<path d="M20 14a8 8 0 0 1-10-10 9 9 0 1 0 10 10z"/>';if(themeButton.dataset.icon!==paths){themeButton.dataset.icon=paths;themeButton.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24">'+paths+'</svg>';}const label=t(dark?'disablePageAppearance':'enableDarkAppearance');themeButton.title=label;themeButton.setAttribute('aria-label',label);};
  sharedSettings.setAppearanceCallback(()=>{syncAppearanceTheme();const focusOn=latest.focusOpen===true,focusLabel=t(focusOn?'closeFocus':'openFocus');focusButton.title=focusLabel;focusButton.setAttribute('aria-label',focusLabel);focusButton.setAttribute('aria-pressed',String(focusOn));});
  const title=(element,key)=>{if(!element)return;element.title=t(key);element.setAttribute('aria-label',t(key));};
  const staticLabels=()=>{
    shadow.host.lang=locale;for(const element of shadow.querySelectorAll('[data-i18n]')){const value=t(element.dataset.i18n);if(element.textContent!==value)element.textContent=value;}
    const placeholder=speed.querySelector('option[value=""]');if(placeholder)placeholder.textContent='—';
    if(settingsMode!=='inline'){
      settings.setAttribute('role','dialog');settings.setAttribute('aria-modal','false');
      settings.setAttribute('aria-label',t('settings'));settings.tabIndex=-1;
    }
    renderBrand();title(bar,'reader');title($('.handle'),'moveBar');$('.handle').title=t('moveHint');title($('.settingsToggle'),'settings');title($('.closeReader'),'closeReader');title(previous,'previousSection');title(next,'nextSection');title(speed,'speed');title(follow,follow.checked?'followOn':'followOff');title(seek,'seekProgress');title(localeSelect,'uiLanguage');title(downloadButton,'extDownload');title(explainButton,'tutor_start');title(moreButton,'moreMenu');moreMenu.setAttribute('aria-label',t('moreMenu'));if(moreOpen)paintMore();downloadPanel.setAttribute('aria-label',t('extDownload'));downloadMenu.update(latest);$('.voice-menu').setAttribute('aria-label',t('languageVoice'));
    content.querySelector('h2').textContent=t('settings');const click=content.querySelector('.click-seek,.clickseek'),row=click.closest('label');for(const node of [...row.childNodes])if(node.nodeType===3)node.remove();row.prepend(document.createTextNode(t('clickSeek')));row.title=t('clickSeekHint');content.querySelector('.settings-main-note').textContent=t('settingsNote');
    for(const [cls,key] of [['.jump','selection'],['.restart','restart'],['.stop','stop']]){const button=content.querySelector(cls);for(const node of [...button.childNodes])if(node.nodeType===3)node.remove();button.append(document.createTextNode(t(key)));title(button,key);}content.querySelector('.jump').title=t('selectionHint');
    if(voice.hasAttribute('data-static')){voice.querySelector('.vn').textContent=t('voice');voice.querySelector('small').textContent='';title(voice,'chooseVoice');}
  };
  const duration=seconds=>formats.duration(seconds,formatPrefs);
  const prepareRegional=(message,optimistic=false)=>{
    const confirmed=formats.preferences(message);if(!optimistic)for(const [field,pending] of regionalPending){if(message.statusKind==='error'&&message.statusKey==='save_failed'||confirmed[field]===pending.value||Number(message.preferenceVersion)>pending.version)regionalPending.delete(field);}
    formatPrefs={...confirmed,...Object.fromEntries([...regionalPending].map(([field,pending])=>[field,pending.value]))};onFormats?.(value=>formats.number(value,formatPrefs,{maximumFractionDigits:2}));
  };
  const prepare=message=>{
    const requested=message.uiLanguage;if(localChoice&&requested===localChoice.code)localChoice=null;else if(localChoice&&Number.isFinite(message.preferenceVersion)&&message.preferenceVersion>localChoice.version)localChoice=null;
    const wanted=localChoice?.code||requested;if(dictionary[wanted]&&wanted!==locale){locale=wanted;onLocale(locale);}
    localeSelect.value=locale;
    prepareRegional(message);
  };
  const updateChapters=(message,index,count)=>{
    const chapters=(Array.isArray(message.chapters)?message.chapters:[]).map((item,originalIndex)=>({item,originalIndex})).filter(({item})=>item&&typeof item.label==='string'&&item.label.trim()&&Number.isInteger(item.sectionIndex)&&item.sectionIndex>=0&&item.sectionIndex<count);
    const signature=JSON.stringify([locale,formats.locale(formatPrefs),count,chapters.map(({item,originalIndex})=>[originalIndex,item.label,item.level])]);
    if(signature!==chapterSignature){chapterSignature=signature;chapterSelect.replaceChildren();if(chapters.length){const placeholder=new Option(t('chooseChapter'),'none');placeholder.disabled=true;chapterSelect.add(placeholder);for(const {item,originalIndex} of chapters){const option=new Option(item.label,'c:'+originalIndex);option.dataset.level=String(Number.isFinite(item.level)?Math.max(1,item.level):1);chapterSelect.add(option);}}else if(count){for(let n=0;n<count;n++)chapterSelect.add(new Option(t('section',{current:n+1,count}),'s:'+n));}else{const option=new Option(t('noDocument'),'none');option.disabled=true;chapterSelect.add(option);}}
    /* Per entry its length (chapters, at the current tempo) or its position (sections), and whether the reading has passed it: flags on the options, the rows keep their place while reading. */
    {const total=Number(message.elapsedSeconds)+Number(message.remainingSeconds),entries=[...chapterSelect.options].filter(option=>option.value!=='none'),starts=entries.map(option=>{const [kind,value]=option.value.split(':'),n=Number(value);if(kind==='s')return {section:n,at:count?n/count:0};const item=message.chapters?.[n];return {section:item?.sectionIndex??0,at:Number.isFinite(item?.at)?item.at:count?(item?.sectionIndex??0)/count:0};});
     entries.forEach((option,i)=>{const start=starts[i],next=starts[i+1],seconds=Number.isFinite(total)&&total>0?((next?next.at:1)-start.at)*total:NaN,meta=chapters.length&&Number.isFinite(seconds)?(seconds<60?t('chapterUnderMinute'):t('chapterMinutes',{n:Math.round(seconds/60)})):formats.number(Math.round(Math.max(0,Math.min(1,start.at))*100),formatPrefs)+' %',done=chapters.length?!!next&&next.section<=index:start.section<index;if(option.dataset.meta!==meta)option.dataset.meta=meta;if(option.dataset.done!==(done?'1':''))option.dataset.done=done?'1':'';});
     const fixed=chapterUi.button.querySelector('.reader-fixed-label'),fixedKey=chapters.length||!count?'chapters':'sections';if(fixed&&fixed.dataset.i18n!==fixedKey){fixed.dataset.i18n=fixedKey;fixed.textContent=t(fixedKey);}}
    chapterSelect.disabled=!count;chapterSelect.value=chapters.length?'c:'+message.chapterIndex:'s:'+index;if(!chapterSelect.value)chapterSelect.value='none';chapterUi.setLabel(chapters.length?'chooseChapter':'chooseSection');chapterUi.render();if(!chapters.length&&count)chapterUi.button.title=t('noChapters')+' · '+t('section',{current:index+1,count});sharedSettings.syncChapters?.();
  };
  const update=(message,optimistic=false)=>{
    latest=message;if(!optimistic)prepare(message);else prepareRegional(message,true);staticLabels();sharedSettings.update(message);if(modeChoice&&(message.overlayMode===modeChoice.value||Number(message.preferenceVersion)>modeChoice.version||message.statusKind==='error'&&message.statusKey==='save_failed'))modeChoice=null;paintMode(modeChoice?.value||message.overlayMode||'expert');
    title(play,message.paused?'resume':message.loading===true?'loadingPause':message.playing?'pause':'play');
    const count=Number.isInteger(message.sectionCount)&&message.sectionCount>0?message.sectionCount:0,index=Number.isInteger(message.sectionIndex)?message.sectionIndex:0;
    const can=message.controls||{};previous.disabled=!count||(typeof can.canPreviousSection==='boolean'?!can.canPreviousSection:index<=0);next.disabled=!count||(typeof can.canNextSection==='boolean'?!can.canNextSection:index>=count-1);updateChapters(message,index,count);section.title=count?t('section',{current:Math.min(count,index+1),count}):'';
    const fraction=message.progressFraction;seek.disabled=!count||!Number.isFinite(fraction)||fraction<0||fraction>1;if(seek.disabled)seek.value='0';else if(!seeking&&!seekDirty){if(seekPending&&(Math.abs(fraction-seekPending.fraction)<.0001||Date.now()>=seekPending.expires)){seekPending=null;clearTimeout(seekTimer);}seek.value=String((seekPending?.fraction??fraction)*1000);}seek.setAttribute('aria-valuetext',!seek.disabled?formats.number(Math.round(fraction*100),formatPrefs)+' %':t('unknownDuration'));seekFill(seek.disabled?0:Number(seek.value)/1000);
    $('.elapsed').textContent=duration(message.elapsedSeconds);$('.remaining').textContent=duration(message.remainingSeconds);timeline.title=message.remainingEstimated?t('estimated'):'';paintBuffer(seek.disabled?null:message.buffered);if(!seek.disabled&&(seeking||seekDirty||seekPending))paintSeek(seekPending&&!seeking&&!seekDirty?seekPending.fraction:Number(seek.value)/1000);
    const signature=[message.statusKey,message.playing===true,message.paused===true].join('|');if(restartPending&&signature!==restartPending.signature){clearTimeout(restartPending.timer);restartPending=null;}
    const key=message.statusKey,translated=typeof key==='string'&&dictionary[locale][key]?t(key,message.statusParams||{}):null;
    const stateWord=message.statusKind==='error'?null:restartPending?'statusRestarts':key==='preparing'||message.loading===true||message.documentState?.state==='loading'?'statusLoads':message.paused===true?'statusPaused':message.playing===true?'statusReads':null;
    const statusText=stateWord?t(stateWord):translated||String(message.status||t('ready'));
    const hasError=message.statusKind==='error',errorMessage=hasError?translated||t('error')+': '+String(message.status||''):'';
    /* The full error text stands once in the tree (details dialog) and is announced once; the trigger says it short. */
    status.textContent=hasError?'':statusText;status.title=hasError?'':statusText;
    if(!hasError){const focusInside=shadow.activeElement===errorTrigger||error.contains(shadow.activeElement);closeError(false);if(focusInside)play.focus({preventScroll:true});}
    statusSlot.toggleAttribute('data-error',hasError);errorTrigger.hidden=!hasError;
    errorButtonExpert.hidden=!hasError;errorButtonLight.hidden=!hasError;
    if(hasError){
      const short='err_short_'+key,named=t(dictionary[locale][short]?short:'err_short_error');
      errorTrigger.querySelector('.error-trigger-text').textContent=t('error_trigger',{short:named});
      errorTrigger.title=t('errorDetails');
    }
    if(errorText.textContent!==errorMessage)errorText.textContent=errorMessage;
    error.setAttribute('aria-label',t('errorDetails'));
    title(errorDismiss,'closeMessage');errorRetry.disabled=message.exportState?.state==='running';
    // the voice menu opens at its button, which Compact hides; text and export errors are no voice problem
    const voiceShown=!!$('.voice-btn')?.getClientRects().length;
    const textError=['no_readable_text','pdf_viewer','prepare_failed','export_failed'].includes(key);
    errorVoice.hidden=!hasError||!voiceShown||textError;
    if(hasError&&errorMessage!==spoken.error)announce(errorMessage);spoken.error=errorMessage;
    if(key==='completed'&&spoken.status!=='completed')announce(t('completed'));spoken.status=key;
    renderCard(message);

    {const on=message.tutorActive===true;if(explainButton.getAttribute('aria-pressed')!==String(on))explainButton.setAttribute('aria-pressed',String(on));}   // Summarize is a toggle: pressed while the tour runs, a second press ends it
    const job=message.exportState||{},running=job.state==='running';
    downloadButton.disabled=!count&&!running;downloadButton.toggleAttribute('data-running',running);if(running)downloadButton.setAttribute('aria-label',t('extDownload')+' · '+formats.number(Math.round(Number(job.percent)||0),formatPrefs)+' %');
    downloadMenu.update(message);
    for(const option of speed.options){if(option.value&&Number.isFinite(Number(option.value))){const label=formats.number(Number(option.value),formatPrefs,{maximumFractionDigits:2})+'×';if(option.textContent!==label)option.textContent=label;}}
    speedUi.render();localeUi.render();relayout();placeSettings();for(const dropdown of dropdowns)dropdown.place();placeDirect();placeError();for(const place of placeExtras)place();centerIcons();
  };
  const placeSettings=()=>{if(settingsMode==='inline'||!settings.hasAttribute('data-open'))return;anchorPanel(settings,$('.more-toggle')||$('.settingsToggle'),{width:480,cap:560,min:48,important:true,fit:room=>{settings.style.setProperty('max-height',room+'px');content.style.maxHeight=(room-2)+'px';}});};
  /* the Settings copies of the bar controls are built when the popover opens (after this placement): place it again whenever its size changes */
  try{const settingsSize=new ResizeObserver(()=>placeSettings());settingsSize.observe(settings);settingsSize.observe(content);disposers.push(()=>settingsSize.disconnect());}catch{}
  $('.settingsToggle').addEventListener('click',placeSettings);
  const afterInteraction=()=>queueMicrotask(centerIcons);shadow.addEventListener('click',afterInteraction);disposers.push(()=>shadow.removeEventListener('click',afterInteraction));const resizeMenus=()=>{for(const dropdown of dropdowns)dropdown.place();placeDirect();placeError();for(const place of placeExtras)place();};window.addEventListener('resize',resizeMenus);disposers.push(()=>window.removeEventListener('resize',resizeMenus));
  localeSelect.addEventListener('change',()=>{locale=localeSelect.value;localChoice={code:locale,version:Number(latest.preferenceVersion)||0};onLocale(locale);send('uiLanguage',locale);update({...latest,uiLanguage:locale},true);});
  follow.addEventListener('change',()=>title(follow,follow.checked?'followOn':'followOff'));
  // Settings actions added here do not dismiss the settings popover.
  exports.addEventListener('click',event=>event.stopPropagation());
  // Until the first native state arrives the status line is a neutral "loading" text (never a stale or
  // invented playing/paused). The first update() replaces it; bridge hands over the last known UI language/theme.
  if(typeof initialLocale==='string'&&dictionary[initialLocale]&&initialLocale!==locale){locale=initialLocale;onLocale(locale);}
  if(['system','light','dark'].includes(initialTheme))onPlayerTheme(initialTheme);
  {const waiting=t('statusLoads');status.textContent=waiting;status.title=waiting;}
  staticLabels();centerIcons();return {voiceSample(state){sampleNow=state&&typeof state==='object'?state:{key:'',state:'idle'};paintSample();},speedPanel:speedUi.panel,closeSpeed:()=>speedUi.close(false),prepare,update,renderSelects(){speedUi.render();chapterUi.render();localeUi.render();},appearanceStatus(info){sharedSettings.appearanceStatusChanged(info);syncAppearanceTheme();},openDownload(){if(!downloadOpen&&!downloadButton.disabled)downloadButton.click();},focusDownload(){if(downloadOpen)downloadMenu.focusFirst();},closePopovers(){closeOtherMenus(null);settings.removeAttribute('data-open');$('.settingsToggle').setAttribute('aria-expanded','false');},destroy(){sharedSettings.destroy();centerObserver.disconnect();for(const dispose of disposers)dispose();}};
}

  const icon=name=>{const paths={close:'<path d="m6 6 12 12M18 6 6 18"/>',vol0:'<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>',vol1:'<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9.5a4 4 0 0 1 0 5"/>',vol2:'<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9.5a4 4 0 0 1 0 5M19 7a8 8 0 0 1 0 10"/>',play:'<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',pause:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',loading:'<path d="M12 4.5a7.5 7.5 0 1 0 7.5 7.5" stroke-width="2.6" stroke-linecap="round"/>',grip:'<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>',gear:'<path d="m9 3-.5 3-2 1-3-.5-2 3 2.5 2v2l-2.5 2 2 3 3-.5 2 1 .5 3h4l.5-3 2-1 3 .5 2-3-2.5-2v-2l2.5-2-2-3-3 .5-2-1-.5-3z"/><circle cx="11" cy="12" r="3"/>',down:'<path d="m6 9 6 6 6-6"/>',restart:'<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',stop:'<rect x="6" y="6" width="12" height="12" rx="1"/>',selection:'<path d="M4 3v18M8 6h12M8 12h8M8 18h12"/>',tap:'<path d="M9 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M12 11.5a1.5 1.5 0 0 1 3 0V12a1.5 1.5 0 0 1 3 0v3.5c0 3-2 5.5-5.5 5.5H11c-2 0-3-.8-4-2l-3-3.6a1.5 1.5 0 0 1 2.3-1.9L9 15"/><path d="M5.5 5a4 4 0 0 1 1.7-2.6M15.5 5a4 4 0 0 0-1.7-2.6"/>'};return '<svg aria-hidden="true" viewBox="0 0 24 24">'+paths[name]+'</svg>';};
  // texts in attributes of the markup below (the language is set again by staticLabels)
  const attr=text=>String(text).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  shadow.innerHTML=`<style>
    :host{color-scheme:light dark;--reader-paper:#fff;--reader-ink:#000000;--reader-muted:#4d554f;--reader-line:#dfe4df;--reader-soft:#f5f6f3;--reader-accent:#256249;--reader-on-accent:#fff;--reader-shadow:0 12px 44px #172c2426;font:12px/1.4 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--reader-ink);}
    *{box-sizing:border-box;}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;flex:none;}
    .bar{position:fixed;display:flex;flex-direction:column;gap:0;width:510px;max-width:calc(100vw - 24px);background:var(--reader-paper);border:1px solid var(--reader-line);border-radius:12px;box-shadow:var(--reader-shadow);pointer-events:auto;color:var(--reader-ink);font:12px/1.4 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:default;}
    .reader-top{display:flex;align-items:center;gap:7px;min-width:0;padding:7px 10px 2px;}.reader-title{font-size:11px;font-weight:600;white-space:nowrap;}.reader-controls{display:flex;align-items:center;gap:9px;padding:4px 13px 10px;min-width:0;}.voice{font-size:12px;white-space:nowrap;padding:0 3px;}.voice small{font-size:10px;color:var(--reader-muted);margin-left:4px;}
    button,select{font:inherit;color:inherit;background:var(--reader-paper);border:1px solid var(--reader-line);border-radius:7px;min-height:30px;padding:4px 8px;cursor:pointer;}button:hover,select:hover{border-color:var(--reader-muted);}button:focus-visible,select:focus-visible,input:focus-visible,.handle:focus-visible,.status:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px;}button:disabled,select:disabled{opacity:.5;cursor:default;}
    button.primary{display:flex;align-items:center;justify-content:center;flex:none;width:38px;height:38px;min-width:38px;padding:0;border:0;border-radius:50%;background:var(--reader-accent);color:var(--reader-on-accent);}.primary svg{width:18px;height:18px;}.speed{font-size:11px;max-width:82px;min-width:66px;padding:4px 5px;}.handle{display:flex;align-items:center;justify-content:center;flex:none;width:19px;height:25px;border-radius:5px;color:var(--reader-muted);cursor:grab;user-select:none;touch-action:none;}.handle svg{width:14px;height:18px;}.handle:hover{background:var(--reader-soft);}.handle:active,.bar[data-dragging] .handle{cursor:grabbing;}.status{flex:1;min-width:0;font-size:11px;color:var(--reader-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;padding:4px 2px;border-radius:4px;}.status:hover{background:var(--reader-soft);}.closeReader{flex:none;display:flex;align-items:center;justify-content:center;width:26px;min-height:26px;padding:0;border-color:transparent;background:transparent;color:var(--reader-muted);}
    .remaining{display:none;flex:1;min-width:0;white-space:nowrap;font-size:10px;color:var(--reader-muted);text-align:right;}.remaining:empty{display:none!important;}label{display:flex;align-items:center;gap:5px;white-space:nowrap;cursor:pointer;font-size:11px;}input{accent-color:var(--reader-accent);margin:0;}input[type=checkbox]{width:12px;height:12px;}.follow-label{margin-left:auto;display:flex;align-items:center;gap:2px;color:var(--reader-muted);font-size:10px;}
    .voice{min-width:0;}.voice-btn{display:inline-flex;align-items:center;gap:4px;max-width:100%;min-height:30px;padding:3px 7px;font-size:12px;white-space:nowrap;}.voice-btn .vn{overflow:hidden;text-overflow:ellipsis;}.voice-btn small{margin-left:0;font-size:10px;color:var(--reader-muted);}.voice-btn svg{width:11px;height:11px;color:var(--reader-muted);transition:transform .12s;}.voice-btn[aria-expanded=true]{border-color:var(--reader-accent);}.voice-btn[aria-expanded=true] svg{transform:rotate(180deg);}.voice-btn[data-static]{border-color:transparent;background:transparent;cursor:default;padding:3px 0;}.voice-btn[data-static] svg{display:none;}
    .voice-menu{display:none;position:absolute;left:10px;top:100%;margin-top:8px;width:min(300px,calc(100% - 20px));max-height:min(340px,calc(100vh - 24px));overflow:auto;overscroll-behavior:contain;background:var(--reader-paper);border:1px solid var(--reader-line);border-radius:11px;padding:6px;box-shadow:var(--reader-shadow);font-size:12px;color:var(--reader-ink);scrollbar-width:thin;z-index:4;cursor:default;white-space:normal;}.voice-menu[data-open]{display:block;}.voice-menu[data-above]{top:auto;bottom:100%;margin:0 0 8px;}.vm-h{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--reader-muted);padding:6px 8px 3px;}.vm-h:not(:first-child){border-top:1px solid var(--reader-line);margin-top:5px;padding-top:9px;}.vm-item{display:flex;align-items:flex-start;gap:8px;width:100%;min-height:32px;padding:5px 8px;text-align:left;border-color:transparent;background:transparent;border-radius:7px;white-space:normal;}.vm-item:hover,.vm-item:focus-visible{background:var(--reader-soft);}.vm-item[aria-checked=true]{color:var(--reader-accent);font-weight:600;}.vm-check{flex:none;width:14px;line-height:1.4;}.vm-text{min-width:0;}.vm-dl{padding-top:0;margin:-3px 0 2px;min-height:26px;font-size:11px;color:var(--reader-accent);}.vm-dl[data-busy]{color:var(--reader-muted);cursor:progress;}.vm-item small{display:block;font-size:10px;font-weight:400;color:var(--reader-muted);}

    @media(prefers-color-scheme:dark){:host{--reader-paper:#1c1f1d;--reader-ink:#e8eee8;--reader-muted:#a0aca2;--reader-line:#414c43;--reader-soft:#272b28;--reader-accent:#a5d3b3;--reader-on-accent:#173020;--reader-shadow:0 12px 44px #0006;}}
    .voice-menu,.vol-pop{position:fixed!important;right:auto!important;bottom:auto!important;margin:0!important;max-width:none!important;}
    @media(max-width:420px){.voice-menu{left:auto;right:auto;width:auto;}.reader-controls{display:grid;grid-template-columns:38px minmax(45px,1fr) 32px 74px;gap:7px;padding:4px 10px 10px;}.reader-controls .primary{grid-column:1;grid-row:1;}.voice{grid-column:2;grid-row:1;}.vol{grid-column:3;grid-row:1;}.speed{grid-column:4;grid-row:1;}.remaining{grid-column:1/4;grid-row:2;text-align:left;}.follow-label{grid-column:4;grid-row:2;}.vol-pop{width:auto;max-width:none;}.reader-title{font-size:10px;}.reader-top{gap:4px;}.voice{font-size:11px;}.voice small{font-size:9px;}.remaining{font-size:9px;}.follow-label{font-size:9px;}.speed{font-size:10px;min-width:62px;}.primary{margin-right:2px;}}
    .layer{position:fixed;inset:0;pointer-events:none;}.mark{position:absolute;background:rgba(255,215,35,.48);border:1px solid #c68b00;border-radius:3px;pointer-events:none}.hits{pointer-events:none}.hits[data-active] .hit{pointer-events:auto}.hit{position:absolute;background:transparent;cursor:pointer}
</style><div class="bar" role="region" aria-label="Artikel vorlesen">
    <div class="reader-top"><span class="handle" role="button" tabindex="0" aria-label="${attr(uiText('moveBar'))}" title="${attr(uiText('moveHint'))}">${icon('grip')}</span><span class="reader-title">Vorlesen</span><span class="status" title="Bereit">Bereit</span><button class="settingsToggle" aria-expanded="false" aria-controls="reader-settings" aria-label="Einstellungen" title="Einstellungen">${icon('gear')}</button><button class="closeReader" title="${attr(uiText('closeReader'))}" aria-label="${attr(uiText('closeReader'))}">${icon('close')}</button></div>
    <div class="reader-controls"><button class="primary" data-command="toggle" title="Vorlesen / Pause" aria-label="Vorlesen">${icon('play')}</button><span class="voice"><button class="voice-btn" type="button" data-static aria-label="Stimme wählen" title="Stimme wählen" tabindex="-1"><span class="vn">Stimme</span><small></small>${icon('down')}</button><div class="voice-menu" role="menu" aria-label="Sprache und Stimme"></div></span><select class="speed" aria-label="Vorlesetempo" title="Vorlesetempo" disabled><option value="" selected disabled>Tempo</option>${Array.from({length:71},(_,i)=>{const n=(.5+i*.05).toFixed(2);return `<option value="${n}">${n.replace('.',',')}×</option>`}).join('')}</select><span class="vol"></span><span class="remaining" role="timer" aria-label="Restdauer unbekannt" title="Geschätzte Restdauer beim gewählten Tempo"></span><span class="follow-label"><button class="select-text" type="button" aria-pressed="true" title="Text auswählen" aria-label="Text auswählen">${icon('tap')}</button><button class="follow" type="button" aria-pressed="true" title="Text verfolgen" aria-label="Text verfolgen"></button></span></div>
    ${settingsPanelMarkup(icon)}
  </div>`;

  const makeSwitch=(node,on=false)=>{node.type='button';node.setAttribute('role','switch');node.classList.add('switch-input');node.setAttribute('aria-checked',String(on));Object.defineProperty(node,'checked',{configurable:true,get:()=>on,set:value=>{on=value===true;node.setAttribute('aria-checked',String(on));}});node.addEventListener('click',()=>{if(node.disabled)return;node.checked=!on;node.dispatchEvent(new Event('change',{bubbles:true}));});return node;};
  installReaderScrollbars(shadow,{ownPage});
  const bar=shadow.querySelector('.bar'),toggle=shadow.querySelector('.primary'),restart=shadow.querySelector('.restart'),selectionButton=shadow.querySelector('.jump'),stop=shadow.querySelector('.stop'),speed=shadow.querySelector('.speed'),follow=shadow.querySelector('.follow'),selectText=shadow.querySelector('.select-text'),clickseek=makeSwitch(shadow.querySelector('.click-seek'),true),status=shadow.querySelector('.status'),remaining=shadow.querySelector('.remaining'),handle=shadow.querySelector('.handle');const syncSelectText=()=>{const on=clickseek.checked===true;selectText.setAttribute('aria-pressed',String(on));selectText.title=uiText(on?'selectTextOn':'selectTextOff');selectText.setAttribute('aria-label',selectText.title);};syncSelectText();
  /* Klicksprung-Schalter gilt in jedem Modus (Bridge/PDF/HTML/Popup): Klick kippt die Checkbox, 'change' löst send/Bridge-Handler aus; programmatische Zustände aus der Statusrückmeldung halten aria-pressed synchron. */
  {const d=Object.getOwnPropertyDescriptor(clickseek,'checked');Object.defineProperty(clickseek,'checked',{configurable:true,get(){return d.get.call(this);},set(v){d.set.call(this,v);syncSelectText();}});}
  listen(selectText,'click',()=>{clickseek.checked=!clickseek.checked;clickseek.dispatchEvent(new Event('change'));});listen(clickseek,'change',syncSelectText);
  const settingsToggle=shadow.querySelector('.settingsToggle'),settingsPanel=shadow.querySelector('.settings-panel');
  const closeSettings=()=>{settingsPanel.removeAttribute('data-open');settingsToggle.setAttribute('aria-expanded','false');};
  const refreshLayout=()=>{if(destroyed)return;if(managed){const r=bar.getBoundingClientRect();if(variant==='popup'){bar.style.position='relative';bar.style.left='0';bar.style.top='0';bar.style.width='100%';bar.style.maxWidth='100%';}else{bar.style.left=(localPosition.x*Math.max(0,innerWidth-r.width))+'px';bar.style.top=(localPosition.y*Math.max(0,innerHeight-r.height))+'px';}const after=bar.getBoundingClientRect();bar.toggleAttribute('data-expand-above',after.top>innerHeight-after.bottom);}onLayout();};
  // The same voice picker factory supplies overlay, file reader and popup settings.
  const pickerUrls=typeof VOICE_PICKER_URLS==='undefined'?{}:VOICE_PICKER_URLS;
  const voiceUi=createVoicePicker({shadow,send,uiText,getLocale:()=>uiLocale,listen,disposers,settingsToggle,place:(menu,button)=>anchorPanel(menu,button,{width:variant==='popup'?520:500,cap:540,min:120,fit:room=>{menu.style.maxHeight=room+'px';}}),isPlaying:()=>playing,getVolume:()=>({volume:latest.volume,muted:latest.muted}),registryUrl:pickerUrls.registry||'',eloUrl:pickerUrls.elo||'',sampleBase:pickerUrls.samples||'',onSample:state=>polish?.voiceSample(state)});
  placeExtras.push(voiceUi.place);
  // The same original tempo / sound / pause controls also mount without a player in Settings.
  const speechControls=createSpeechControls(),fxUi=speechControls.createFxRows({doc:document,send,uiText,formatNumber:v=>formatNumber(v)}),fxStyle=document.createElement('style');fxStyle.textContent=speechControls.FX_CSS;shadow.append(fxStyle);

  disposers.push(()=>fxUi.dispose());
  // Volume: speaker button + small popover. Only mpv's own `volume` is driven (player side); local choice beats delayed states.
  const volumeUi=speechControls.createSoundControls({wrap:shadow.querySelector('.vol'),send,uiText,formatNumber:v=>formatNumber(v),icon,anchorPanel,fxUi,doc:document,settingsToggle,onOpen:()=>{polish?.closeSpeed?.();},onPlace:place=>placeExtras.push(place)});
  disposers.push(()=>volumeUi.destroy());

  const mountPolish=options=>{
    if(polish)return polish;
    const {onLocale,onFormats,relayout,...rest}=options||{};
    polish=mountPlayerPolish({shadow,bar,send,icon,locales,formattingFactory,appearanceController,...rest,fxUi,onPlayerTheme:applyPlayerTheme,onLocale:code=>{uiLocale=code;syncSelectText();voiceUi.refreshLocale();volumeUi.refreshLocale();fxUi.refreshLocale();onLocale?.(code);},onFormats:format=>{formatNumber=format;onFormats?.(format);},relayout:()=>{refreshLayout();relayout?.();}});return polish;
  };
  const updateSelection=()=>{selectionButton.disabled=!(onSelection()||latest.selectionAvailable===true);};
  if(managed){
    let followsText=true;Object.defineProperty(follow,'checked',{get:()=>followsText,set:value=>{followsText=value===true;follow.setAttribute('aria-pressed',String(followsText));follow.title=uiText(followsText?'followOn':'followOff');follow.setAttribute('aria-label',follow.title);}});follow.checked=true;
    listen(follow,'click',()=>{follow.checked=!follow.checked;follow.dispatchEvent(new Event('change'));});
    listen(settingsToggle,'click',()=>{const open=!settingsPanel.hasAttribute('data-open');settingsPanel.toggleAttribute('data-open',open);settingsToggle.setAttribute('aria-expanded',String(open));refreshLayout();});
    // The settings dialog takes the focus when it opens (Escape gives it back to the More button that opened it, or the gear).
    const focusSettings=()=>{
      if(!settingsPanel.hasAttribute('data-open')||settingsPanel.contains(shadow.activeElement))return;   // a shortcut that already focused a row inside (interface language) keeps it
      const stops=[...settingsPanel.querySelectorAll('button,input,select,[tabindex]')];
      const first=stops.find(n=>n.tabIndex>=0&&!n.disabled&&n.getClientRects().length);
      (first||settingsPanel).focus({preventScroll:true});
    };
    listen(settingsToggle,'click',()=>{
      if(settingsPanel.hasAttribute('data-open'))requestAnimationFrame(focusSettings);
    });
    listen(settingsPanel,'click',event=>{if(event.target.closest('.jump,.restart,.stop'))closeSettings();});
    listen(bar,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'&&settingsPanel.hasAttribute('data-open')){closeSettings();const more=settingsToggle.getRootNode().querySelector?.('.more-toggle');(more&&more.getClientRects().length?more:settingsToggle).focus();}});listen(bar,'pointerdown',event=>event.stopPropagation());
    listen(document,'pointerdown',event=>{const path=event.composedPath();if(!path.includes(settingsPanel)&&!path.includes(settingsToggle)&&!path.some(n=>n.classList?.contains('reader-select-menu')))closeSettings();},true);
    listen(selectionButton,'pointerdown',event=>event.preventDefault());listen(selectionButton,'click',()=>{if(!selectionButton.disabled)send('selection');});
    listen(toggle,'click',()=>send('toggle',!playing&&onSelection()?{explicitSelection:true}:undefined));listen(restart,'click',()=>send('restart'));listen(stop,'click',()=>send('stop'));
    listen(speed,'change',()=>{speedChoice=Number(speed.value);send('speed',speedChoice);});listen(follow,'change',()=>{followChoice=follow.checked;send('follow',follow.checked);onLocalChange('follow',follow.checked);});listen(clickseek,'change',()=>{clickSeekChoice=clickseek.checked;send('clickseek',clickseek.checked);onLocalChange('clickseek',clickseek.checked);syncSelectText();});
    listen(shadow.querySelector('.closeReader'),'click',()=>onClose());listen(document,'selectionchange',updateSelection);listen(window,'resize',refreshLayout);
    if(variant!=='popup'){
      const move=(x,y)=>{localPosition={x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};refreshLayout();onLocalChange('barPosition',{...localPosition});};
      listen(handle,'pointerdown',event=>{if(event.button!==0)return;const r=bar.getBoundingClientRect();dragging={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left,top:r.top};try{handle.setPointerCapture(event.pointerId);}catch{}event.preventDefault();});
      listen(handle,'pointermove',event=>{if(!dragging||dragging.id!==event.pointerId)return;const r=bar.getBoundingClientRect();move((dragging.left+event.clientX-dragging.x)/Math.max(1,innerWidth-r.width),(dragging.top+event.clientY-dragging.y)/Math.max(1,innerHeight-r.height));});
      const end=event=>{if(dragging?.id!==event.pointerId)return;try{handle.releasePointerCapture(event.pointerId);}catch{}dragging=null;};listen(handle,'pointerup',end);listen(handle,'pointercancel',end);
      listen(handle,'dblclick',event=>{event.preventDefault();move(.5,1);});listen(handle,'keydown',event=>{if(event.key==='Home'){event.preventDefault();move(.5,1);return;}const steps={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]},step=steps[event.key];if(!step)return;event.preventDefault();const r=bar.getBoundingClientRect();move((r.left+step[0])/Math.max(1,innerWidth-r.width),(r.top+step[1])/Math.max(1,innerHeight-r.height));});
    }
    if(variant==='popup'){const style=document.createElement('style');style.textContent=".bar{position:relative;width:100%;max-width:100%;}.bar .handle{display:none!important}.bar.bar>.reader-top>.section-label{margin-left:-3px!important}@media(max-width:543px){.bar.bar>.reader-top>.section-label{margin-left:-2px!important}}";shadow.append(style);handle.tabIndex=-1;handle.setAttribute('aria-hidden','true');}
    // eslint-disable-next-line no-self-assign -- The checked setter refreshes translated Follow labels without changing the saved preference.
    const applyHints=()=>{if(destroyed||!kb)return;syncSelectText();voiceUi.refreshLocale();volumeUi.refreshLocale();fxUi.refreshLocale();follow.checked=follow.checked;if(Object.keys(latest).length)polish?.update(latest);kb.applyAll();};
    {
      const click=element=>{if(element&&!element.disabled)element.click();},hasText=()=>Number(latest.sectionCount)>0,say=(key,args)=>kb.announce(uiText(key,args));
      const nav=(command,value)=>()=>{if(hasText())send(command,value);};
      const stepSpeed=direction=>{if(speed.disabled)return;const current=Number(speed.value);if(!Number.isFinite(current)||current<.5)return;const next=Math.max(.5,Math.min(4,Math.round((current+direction*.1)*20)/20));if(next===current)return;speed.value=next.toFixed(2);speed.dispatchEvent(new Event('change',{bubbles:true}));polish?.renderSelects();say('kbAnnounceSpeed',{value:formatNumber(next)+'×'});};
      const stepVolume=delta=>{const value=volumeUi.adjust(delta);if(value!==null)say('kbAnnounceVolume',{value:formatNumber(value)+' %'});};
      const focusIn=panel=>{const target=panel.querySelector('.reader-select-trigger:not([disabled]),button:not([disabled]),input:not([disabled])');(target||panel).focus({preventScroll:true});};
      const openSettings=()=>{if(bar.hasAttribute('data-settings-inline'))return;if(!settingsPanel.hasAttribute('data-open'))settingsToggle.click();};
      kb=createKeyboard({shadow,bar,uiText,icon,ownPage,extra:keyboardActions,isHidden:()=>hiddenDisplay!==null,onSettings:typeof onKeyboardSettings==='function'?onKeyboardSettings:null,onEnabled:()=>{applyHints();onKeyboardChange();},actions:{
        playPause:()=>click(toggle),stop:()=>click(stop),restart:()=>click(restart),selection:()=>click(selectionButton),
        previousSection:()=>click(shadow.querySelector('.previous-section')),nextSection:()=>click(shadow.querySelector('.next-section')),
        previousBlock:nav('previousBlock'),nextBlock:nav('nextBlock'),previousChapter:nav('previousChapter'),nextChapter:nav('nextChapter'),seekBack:nav('seekRelative',-10),seekForward:nav('seekRelative',10),
        volumeUp:()=>stepVolume(10),volumeDown:()=>stepVolume(-10),mute:()=>{const result=volumeUi.muteToggle();if(result)say('kbAnnounceVolume',{value:result.muted?uiText('muted'):formatNumber(result.volume)+' %'});},speedDown:()=>stepSpeed(-1),speedUp:()=>stepSpeed(1),
        voiceMenu:()=>voiceUi.open(),voicePrev:()=>{const name=voiceUi.cycleVoice(-1);if(name)say('kbAnnounceVoice',{name});},voiceNext:()=>{const name=voiceUi.cycleVoice(1);if(name)say('kbAnnounceVoice',{name});},
        languagePrev:()=>{const name=voiceUi.cycleLanguage(-1);if(name)say('kbAnnounceLanguage',{name});},languageNext:()=>{const name=voiceUi.cycleLanguage(1);if(name)say('kbAnnounceLanguage',{name});},
        theme:()=>click(shadow.querySelector('.theme-toggle')),focus:()=>click(shadow.querySelector('.focus-toggle')),follow:()=>click(follow),clickSeek:()=>click(selectText),
        settings:()=>{if(bar.hasAttribute('data-settings-inline')){focusIn(settingsPanel);return;}if(settingsPanel.hasAttribute('data-open')){closeSettings();const more=shadow.querySelector('.more-toggle');(more&&more.getClientRects().length?more:settingsToggle).focus({preventScroll:true});return;}openSettings();},   // the dialog's own focus step (after its lazily built voice / speed / volume rows) puts the focus on its first control
        uiLanguage:()=>{openSettings();const trigger=shadow.querySelector('.ui-language-trigger');if(trigger&&trigger.getClientRects().length)trigger.focus({preventScroll:true});else focusIn(settingsPanel);},
        export:()=>{const button=shadow.querySelector('.download-trigger');if(!button||button.disabled)return;polish?.openDownload();if(button.getAttribute('aria-expanded')==='true'){shadow.querySelector('.download-menu').tabIndex=-1;polish?.focusDownload();}},
        help:()=>kb.toggleHelp(),close:()=>click(shadow.querySelector('.closeReader'))}});
    }
    mountPolish();updateSelection();refreshLayout();
  }
  const update=message=>{
    if(destroyed)return;if(!message||typeof message!=='object')return;latest=message;
    if(!managed){polish?.update(message);return;}
    polish.prepare(message);if(Array.isArray(message.catalog))voiceUi.update(message);volumeUi.update(message);fxUi.update(message);
    const version=Number.isSafeInteger(message.preferenceVersion)&&message.preferenceVersion>=0?message.preferenceVersion:null,current=version===null?lastPreferenceVersion<0:version>=lastPreferenceVersion;
    if(version!==null&&version>lastPreferenceVersion){if(lastPreferenceVersion>=0){followChoice=null;clickSeekChoice=null;speedChoice=null;}lastPreferenceVersion=version;}
    if(current&&clickSeekChoice===null&&typeof message.clickSeek==='boolean')clickseek.checked=message.clickSeek;syncSelectText();
    playing=message.playing===true;{const busy=message.loading===true&&message.playing!==true&&message.paused!==true,glyphName=busy?'loading':playing&&!message.paused?'pause':'play';if(toggle.dataset.glyph!==glyphName){toggle.dataset.glyph=glyphName;toggle.innerHTML=icon(glyphName);}toggle.toggleAttribute('aria-busy',busy);}
    if(current&&speedChoice===null&&Number.isFinite(message.speed)&&message.speed>=.5&&message.speed<=4){speed.value=(Math.round(message.speed*100)/100).toFixed(2);speed.disabled=false;}
    if(current&&followChoice===null&&typeof message.follow==='boolean')follow.checked=message.follow;
    // A disconnected/empty adapter cannot offer a nonfunctional Play action.
    toggle.disabled=message.controls?.canToggle===false||message.exportState?.state==='running';restart.disabled=message.exportState?.state==='running';stop.disabled=message.exportState?.state==='running';
    polish.update(message);updateSelection();refreshLayout();kb?.applyAll();
  };
  return {host,shadow,bar,icon,voiceUi,volumeUi,mountPolish,update,setOverlayColors,refreshLayout,updateSelection,setVisibility,getActualVisible,openDownload(focus=false){polish?.openDownload();if(focus)polish?.focusDownload?.();},keyboard:kb,refs:{get bookmarkHost(){return shadow.querySelector('.reader-bookmark-slot');},toggle,restart,selectionButton,stop,speed,follow,clickseek,status,remaining,handle,settingsToggle,settingsPanel},closePopovers(){polish?.closePopovers();},destroy(){if(destroyed)return;destroyed=true;kb?.destroy();polish?.destroy();if(ownsAppearance)appearanceController?.destroy();for(const dispose of disposers)dispose();if(!providedShadow)host.remove();}};
}
