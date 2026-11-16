// Local transport shared by the toolbar and its settings page through the worker.
const ENDPOINT = 'http://127.0.0.1:43187';
export const appearanceDefaults=Object.freeze({mode:'off',brightness:100,contrast:100,sepia:0,grayscale:0,background:'#181a1b',text:'#e8e6e3',link:'#8ab4f8',lightBackground:'#ffffff',lightText:'#202124',lightLink:'#0969da',imageMode:'preserve',imageBrightness:100,fontFamily:'serif',fontSize:18,lineHeight:1.7,contentWidth:760,focus:false,hidePageNumbers:true,pdfDpi:144});
export function validAppearance(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length)return false;
  const enums={mode:['off','dark','light','auto'],imageMode:['preserve','dim','invert','smart'],fontFamily:['serif','sans','system','mono'],pdfDpi:[96,144,192]};
  const ranges={brightness:[50,150],contrast:[50,150],sepia:[0,100],grayscale:[0,100],imageBrightness:[25,150],fontSize:[12,32],lineHeight:[1.2,2.4],contentWidth:[480,1200]};
  return Object.entries(value).every(([key,item])=>Object.hasOwn(appearanceDefaults,key)&&(enums[key]?enums[key].includes(item):ranges[key]?Number.isFinite(item)&&item>=ranges[key][0]&&item<=ranges[key][1]:['focus','hidePageNumbers'].includes(key)?typeof item==='boolean':typeof item==='string'&&/^#[0-9a-f]{6}$/i.test(item)));
}
export const cleanAppearance=value=>validAppearance(value)?{...appearanceDefaults,...value}:{...appearanceDefaults};
const MESSAGES = Object.freeze({
  unavailable: 'Der Hintergrundleser ist nicht erreichbar. Öffne die Hilfe zur Verbindung.',
  timeout: 'Das Dokument wurde nicht rechtzeitig bereit. Bitte erneut versuchen.',
  busy: 'Ein Dokument wird bereits vorbereitet. Bitte kurz warten.',
  request_conflict: 'Die Anfrage konnte nicht eindeutig zugeordnet werden. Bitte erneut versuchen.',
  unsupported: 'Diese Ansicht enthält keinen unterstützten Artikel oder PDF-Text. Öffne das Dokument selbst und versuche es erneut.',
  ambiguous: 'Mehrere gleiche Tabs gefunden. Aktiviere das gewünschte Dokument und versuche es erneut.',
  tab_changed: 'Der gewählte Tab wurde inzwischen geändert oder geschlossen.',
  browser_unavailable: 'Der Leser läuft, aber seine Verbindung zu Brave ist nicht erreichbar.',
  bridge_failed: 'Die Vorleseleiste konnte in diesem Dokument nicht geöffnet werden.',
  prepare_failed: 'Die Textstellen konnten nicht vorbereitet werden. Bitte lade das Dokument vollständig.',
  save_failed: 'Die Einstellungen konnten nicht gespeichert werden. Bitte erneut versuchen.',
  closed: 'Der Hintergrundleser wurde beendet.',
  forbidden: 'Der Hintergrundleser hat den Erweiterungszugriff abgewiesen. Bitte Erweiterung und Leser gemeinsam aktualisieren.',
  protocol: 'Erweiterung und Hintergrundleser verwenden unterschiedliche Versionen. Bitte beide aktualisieren.',
  invalid: 'Diese Anfrage wird vom Hintergrundleser nicht unterstützt.',
});

export class ReaderError extends Error {
  constructor(code, status = null) {
    super(MESSAGES[code] || 'Die Aktion konnte nicht abgeschlossen werden.');
    this.code = code;
    this.status = status;
  }
}

async function post(path, body, timeout = 7000) {
  let response;
  try {
    response = await fetch(ENDPOINT + path, {
      method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw new ReaderError(error?.name === 'TimeoutError' ? 'timeout' : 'unavailable');
  }
  if (response.status === 403) throw new ReaderError('forbidden');
  if (response.status === 400) throw new ReaderError('invalid');
  let value;
  try { value = await response.json(); }
  catch { throw new ReaderError('protocol'); }
  if (!value || value.version !== 1) throw new ReaderError('protocol');
  return {response, value};
}

async function operation(path, fields, timeoutMs, onPending) {
  const requestId = crypto.randomUUID().replaceAll('-', '');
  const deadline = Date.now() + timeoutMs;
  const body = {version: 1, requestId, ...fields};
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ReaderError('timeout');
    const {response, value} = await post(path, body, Math.min(7000, remaining));
    if (value.requestId !== requestId) throw new ReaderError('protocol');
    if (response.status === 202 && value.code === 'pending' && value.ok === false) {
      onPending?.();
      await new Promise(resolve => setTimeout(resolve, 200));
      continue;
    }
    if (!response.ok || value.ok !== true) throw new ReaderError(value.code, value);
    if (value.code !== (path === '/v1/show' ? 'ready' : 'applied')) throw new ReaderError('protocol');
    return value;
  }
}

export async function status() {
  const {response, value} = await post('/v1/status', {version: 1}, 3500);
  if (!response.ok || value.ok !== true || value.code !== 'status') throw new ReaderError(value.code);
  return value;
}

export async function documentView(refresh=false){
  if(typeof refresh!=='boolean')throw new ReaderError('invalid');
  const deadline=Date.now()+90000;
  let first=true;
  for(;;){
    const remaining=deadline-Date.now();if(remaining<=0)throw new ReaderError('timeout');
    const {response,value}=await post('/v1/document',{version:1,...(first&&refresh?{refresh:true}:{})},Math.min(7000,remaining));first=false;
    if(response.status===202&&value.ok===false&&value.code==='pending'){await new Promise(resolve=>setTimeout(resolve,300));continue;}
    if(!response.ok||value.ok!==true)throw new ReaderError(value.errorKey||value.code||'unavailable');
    if(value.code!=='document')throw new ReaderError('protocol');
    return value.document;
  }
}

export function settings(values) {
  let normalized=values;
  if(typeof values?.voice==='string'){
    if(typeof values.language!=='string'||!/^[a-z]{2}(?:-[a-z]{2})?$/.test(values.language)||!/^[a-z0-9_:.-]{1,64}$/.test(values.voice))throw new ReaderError('invalid');
    normalized={...values,voice:{language:values.language,id:values.voice}};
  }
  return operation('/v1/settings', {settings: normalized}, 6500);
}

export function validControl(command, value) {
  if (['stop','restart','resetBar','previousSection','nextSection','cancelExport','toggle','authorizeExport'].includes(command)) return value === undefined;
  if(command==='setOverlayVisible')return typeof value==='boolean';
  if (['seekChapter','seekSection'].includes(command)) return Number.isSafeInteger(value) && value >= 0;
  if (command === 'seekProgress') return Number.isFinite(value) && value >= 0 && value <= 1;
  if (command === 'export') return ['mp3','wav'].includes(value);
  if (command === 'exportDocument') return ['pdf','html'].includes(value)||!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&Object.keys(value).every(key=>['format','view'].includes(key))&&['pdf','html'].includes(value.format)&&['focus','source'].includes(value.view);
  if (['toggleTheme','openFocus'].includes(command)) return value === undefined;
  if (command === 'activatePremium') return typeof value === 'string' && /^[A-Za-z0-9._-]{8,1800}$/.test(value);
  return false;
}
export function control(command, value, sourceGeneration) {
  if (!validControl(command,value)) throw new ReaderError('invalid');
  if(sourceGeneration!==undefined&&(typeof sourceGeneration!=='string'||!/^[a-f0-9-]{16,64}$/i.test(sourceGeneration)))throw new ReaderError('invalid');
  return operation('/v1/control', {command, ...(value === undefined ? {} : {value}),...(sourceGeneration===undefined?{}:{sourceGeneration})}, command === 'activatePremium' ? 20000 : 6500);
}

function tabOperation(path, tab, onPending) {
  try {
    const url = new URL(tab?.url);
    if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password ||
        typeof tab?.title !== 'string' || tab.title.length > 512 || tab.url.length > 8192)
      throw new Error();
  } catch { throw new ReaderError('unsupported'); }
  return operation(path, {tab: {url: tab.url, title: tab.title}}, path === '/v1/show' ? 105000 : 15000, onPending);
}

export function show(tab, onPending) { return tabOperation('/v1/show', tab, onPending); }
export function hide(tab, onPending) { return tabOperation('/v1/hide', tab, onPending); }
