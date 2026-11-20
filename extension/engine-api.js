import {askFrame,prepareFrame,frameBinding,frameAccess} from './frame-session.mjs';
// Local engine API (own code, MIT): everything happens inside the extension (the old companion client reader-api.js with its loopback address was removed in 2.5.2).
// The "document" is the reading session that the content script (session/page-session.mjs) keeps in the selected tab;
// status/control/settings are forwarded to it with tabs.sendMessage. No network, no companion, no document text leaves the page.
export {appearanceDefaults, validAppearance, cleanAppearance} from './appearance-schema.js';
import {FREE_CAPABILITIES} from './premium-browser.mjs';
import {marksFrom} from './session/mark-settings.mjs';
import {loadConfig, coupleTheme, cleanKeyboard, CONFIG_KEY} from './config.mjs';
import {cleanStyle} from './session/mark-style.mjs';
import {cleanOverlayTheme} from './session/overlay-theme.mjs';
import {ERROR_STATUS_KEYS} from './engine/error-keys.mjs';
import {errorText} from './i18n.js';
const MESSAGES = Object.freeze({
  unavailable: 'Der Leser ist in dieser Ansicht nicht erreichbar. Öffne den Artikel in einem normalen Tab.',
  timeout: 'Das Dokument wurde nicht rechtzeitig bereit. Bitte erneut versuchen.',
  busy: 'Ein Dokument wird bereits vorbereitet. Bitte kurz warten.',
  request_conflict: 'Die Anfrage konnte nicht eindeutig zugeordnet werden. Bitte erneut versuchen.',
  unsupported: 'Diese Ansicht enthält keinen unterstützten Artikel. Öffne eine normale Webseite oder die Dateiansicht der Erweiterung für PDFs.',
  ambiguous: 'Mehrere gleiche Tabs gefunden. Aktiviere das gewünschte Dokument und versuche es erneut.',
  tab_changed: 'Der gewählte Tab wurde inzwischen geändert oder geschlossen.',
  browser_unavailable: 'Der Browser verweigert den Zugriff auf diese Seite.',
  bridge_failed: 'Die Vorleseleiste konnte in diesem Dokument nicht geöffnet werden.',
  prepare_failed: 'Die Textstellen konnten nicht vorbereitet werden. Bitte lade das Dokument vollständig.',
  save_failed: 'Die Einstellungen konnten nicht gespeichert werden. Bitte erneut versuchen.',
  closed: 'Die Vorleseleiste wurde geschlossen.',
  forbidden: 'Diese Aktion ist nicht erlaubt.',
  protocol: 'Die Antwort der Seite war unvollständig. Bitte erneut versuchen.',
  invalid: 'Diese Anfrage wird nicht unterstützt.',
  embedded_permission_required: 'Der Text liegt in einer eingebetteten Website. Erlaube den Zugriff im Reader-Menü.',
});
/* Codes whose text lives only in the locale catalog (six languages); read once the worker loaded it. */
const CATALOG_MESSAGES = new Set(['pdf_viewer', 'no_readable_text']);
export class ReaderError extends Error {
  constructor(code, status = null) {
    super(MESSAGES[code] || (CATALOG_MESSAGES.has(code) ? errorText(code) : '') ||
      'Die Aktion konnte nicht abgeschlossen werden.');
    this.code = code; this.status = status;
  }
}
/* Frame and browser failures carry a plain `code`; keep it (and its details) instead of a generic error. */
export function readerError(error, fallback = 'unavailable') {
  if (error instanceof ReaderError) return error;
  const code = typeof error?.code === 'string' && /^[a-z_]{2,40}$/.test(error.code) ? error.code : fallback;
  const wrapped = new ReaderError(code);
  for (const key of ['access', 'pdf']) if (error?.[key]) wrapped[key] = error[key];
  return wrapped;
}
const api = globalThis.chrome?.runtime?.id ? globalThis.chrome : globalThis.browser;
const SETTINGS_KEY = CONFIG_KEY, TAB_KEY = 'sessionTab';

/* The tab whose session answers status/control (set by show). Kept in storage.session so a suspended worker still knows it. */
export async function currentTab() { try { return (await api.storage.session.get(TAB_KEY))[TAB_KEY] ?? null; } catch { return null; } }
async function setCurrentTab(id) { try { await api.storage.session.set({[TAB_KEY]: id}); } catch {} }
const ask = (tabId,message,timeout=4000)=>askFrame(tabId,message,timeout);
// Only these failures prove the session is gone; a slow or frozen page keeps its place.
const GONE = /receiving end does not exist|could not establish connection|no tab with id|invalid tab id/i;
const sessionGone = error => error?.code === 'document_changed' || GONE.test(String(error?.message || ''));
export {frameAccess};

export function validControl(command, value) {
  if (['stop', 'restart', 'resetBar', 'previousSection', 'nextSection', 'previousBlock', 'nextBlock', 'previousChapter', 'nextChapter', 'cancelExport', 'toggle', 'authorizeExport', 'explainPage', 'prepare'].includes(command)) return value === undefined;
  if (command === 'seekRelative') return Number.isFinite(value) && Math.abs(value) <= 600;
  if (command === 'setOverlayVisible') return typeof value === 'boolean';
  if (['seekChapter', 'seekSection'].includes(command)) return Number.isSafeInteger(value) && value >= 0;
  if (command === 'seekProgress') return Number.isFinite(value) && value >= 0 && value <= 1;
  if (['downloadVoice', 'removeVoice', 'cancelDownload', 'voiceCardGet'].includes(command)) {
    return typeof value === 'string' && /^[a-z0-9_:.-]{1,64}$/.test(value);
  }
  if (['voiceCardClose', 'voiceCardKeep'].includes(command)) return value === undefined;
  if (command === 'export') return ['mp3', 'wav'].includes(value);
  if (command === 'exportDocument') return ['pdf', 'html'].includes(value);
  if (['toggleTheme', 'openFocus'].includes(command)) return value === undefined;
  return false;
}

/* The popup shows `lastError.code` instead of the status key. A session error that has its own status text (no WebGPU / no network: cause and remedy in the catalog) must not be flattened to "the toolbar could not be opened":
   those keys travel as statusKey only (the popup then reads the same text as the bar), a failed preparation keeps its own code. */
const OWN_STATUS = new Set(ERROR_STATUS_KEYS.filter(key => !['prepare_failed', 'reader_error'].includes(key)));
const sessionError = value => !value ? null : OWN_STATUS.has(value) ? null : value === 'prepare_failed' ? {code: 'prepare_failed'} : {code: 'bridge_failed'};
/* Companion-shaped status value built from the live session (or an idle value when no session exists). */
async function build(session, tabId) {
  const stored = await loadConfig(api.storage.local);   // the central configuration, migrated
  if (!session?.ok) {   // no document: show the stored value or the product default (1.6.24 showed 1.0x here, never a dash)
    return {ready: false, settings: {overlayMode: stored.overlayMode==='light'?'light':'expert', speed: stored.speed ?? 1, follow: stored.follow ?? true, clickSeek: stored.clickSeek ?? true, autoShow: stored.autoShow ?? false, focusMotion: stored.focusMotion===true, muted: stored.muted ?? false, uiLanguage: stored.uiLanguage, playerTheme: stored.playerTheme, formatLocale: stored.formatLocale, timeFormat: stored.timeFormat, language: stored.language || 'auto', voices: stored.voices || {}, volume: stored.volume ?? 100, pitch: stored.pitch ?? 0, bass: stored.bass ?? 0, treble: stored.treble ?? 0, sectionPause: stored.sectionPause ?? 0, reading: stored.reading, appearance: stored.appearance || undefined, ...marksFrom(stored), markVersion: 2, normalizeSpeech: stored.normalizeSpeech ?? true, markStyle: cleanStyle(stored.markStyle), overlayTheme: cleanOverlayTheme(stored.overlayTheme), keyboard: cleanKeyboard(stored.keyboard), followPosition: stored.followPosition, followMode: stored.followMode, followMargin: stored.followMargin, bar: stored.bar ?? null, online: stored.online === true},
      engine: {ready: false}, capabilities: FREE_CAPABILITIES, components: {extensionApi: true, bridge: true, watcher: true}, statusKey: 'ready', documentState: {state: 'idle'}};
  }
  const snap = session.snapshot, s = session.settings;
  // The answering tab, not its URL or title, identifies the bound document (same-document navigation keeps it).
  return {...snap, sourceTitle:session.title, ready: session.ready, sourceContext: {bound: true, kind: 'html', generation: session.generation, overlayVisible: session.overlayVisible, overlayPending: false, focusOpen: false, ...(Number.isSafeInteger(tabId) ? {tabId} : {})},
    documentState: {state: session.ready ? 'ready' : 'error', sectionCount: session.chunkCount, imageCount: 0, generation: session.generation, errorKey: session.ready ? '' : 'document_unavailable'},
    settings: {overlayMode: s.overlayMode==='light'?'light':'expert', speed: s.speed, follow: s.follow, clickSeek: s.clickSeek, autoShow: s.autoShow, focusMotion:s.focusMotion===true, muted: s.muted, uiLanguage: s.uiLanguage, playerTheme: s.playerTheme, formatLocale: s.formatLocale, timeFormat: s.timeFormat, language: s.language, voices: s.voices, volume: s.volume, pitch: s.pitch ?? 0, bass: s.bass ?? 0, treble: s.treble ?? 0, sectionPause: s.sectionPause ?? 0, reading: s.reading, appearance: s.appearance || snap.appearance, followPosition: s.followPosition, followMode: s.followMode, followMargin: s.followMargin, ...marksFrom(s), markVersion: 2, normalizeSpeech: s.normalizeSpeech !== false, markStyle: cleanStyle(s.markStyle), overlayTheme: cleanOverlayTheme(s.overlayTheme), keyboard: cleanKeyboard(s.keyboard), bar: s.bar ?? null, online: s.online === true},
    engine: session.engine, playback: session.playback, capabilities: FREE_CAPABILITIES, exportState: snap.exportState, lastError: sessionError(session.lastError), components: {extensionApi: true, bridge: true, watcher: true}};
}

/* catalog=false leaves the voice catalog in the page (status polls of surfaces that never show voices). */
export async function status({catalog = true} = {}) {
  const tabId = await currentTab();
  if (tabId === null) return build(null);
  try { return await build(await ask(tabId, catalog ? {t: 'status'} : {t: 'status', catalog: false}), tabId); }
  catch (error) { if (sessionGone(error)) await setCurrentTab(null); return build(null); }
}

function tabId(tab) { if (!Number.isInteger(tab?.id) || tab.id < 0) throw new ReaderError('tab_changed'); try { const url = new URL(tab.url); if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw 0; } catch { throw new ReaderError('unsupported'); } return tab.id; }

/* Starts (or re-opens) the reading session in the selected tab. activeTab is granted by the user's click on the toolbar button. */
export async function show(tab,onPending,{overlay=true,allowEmpty=false,rediscover=false}={}){
 const id=tabId(tab);
 try{const binding=await frameBinding(id);if(binding&&!rediscover&&(!allowEmpty||binding.frameId===0)){const existing=await ask(id,{t:overlay?'show':'status'},800);if(existing?.ok&&(existing.ready||allowEmpty)){await setCurrentTab(id);return {ok:true,code:'ready'};}}}catch{}
 try{const result=await prepareFrame(tab,{overlay,allowEmpty,onPending});await setCurrentTab(id);return result;}
 catch(error){throw readerError(error,'browser_unavailable');}
}

export async function hide(tab) {
  const id = tabId(tab);
  try { await ask(id, {t: 'hide'}); } catch { throw new ReaderError('closed'); }
  return {ok: true, code: 'applied'};
}
/* Starting playback can wait for a voice confirmation, download or cold engine inside the page. The command is
   acknowledged after a short wait; its progress and any later failure appear in the session's own status. */
const START_COMMANDS = new Set(['toggle', 'restart']), ACK_MS = 2500;
export const PENDING = Symbol('pending');
export function acknowledged(request, ms = ACK_MS) {
  let timer;
  request.catch(() => {});
  const waited = new Promise(resolve => { timer = setTimeout(() => resolve(PENDING), ms); });
  return Promise.race([request, waited]).finally(() => clearTimeout(timer));
}
export async function control(command, value, sourceGeneration) {
  if (!validControl(command, value)) throw new ReaderError('invalid');
  if (command === 'authorizeExport') return {...await status(), authorized: true};
  if (command === 'openFocus') {   // popup: while the reader tab is the active tab, "focus" is the way back to the page tab
    try { const [active] = await api.tabs.query({active: true, currentWindow: true}); if (active && await isFocusTab(active.id)) { await closeFocus(active.id); return build(null); } } catch {}
  }
  const id = await currentTab();
  if (id === null) throw new ReaderError('document_unavailable');
  let answer;
  try {
    const fence = sourceGeneration !== undefined ? {sourceGeneration} : {};
    const request = ask(id, {t: 'control', command, value, ...fence}, 15000);
    answer = START_COMMANDS.has(command) ? await acknowledged(request) : await request;
  } catch (error) { throw readerError(error); }
  if (answer === PENDING) return {pending: true};
  if (!answer?.ok) throw new ReaderError('bridge_failed');
  if (sourceGeneration !== undefined && answer.generation !== sourceGeneration) throw new ReaderError('document_changed');
  return build(answer, id);
}
export async function settings(values) {
  const id = await currentTab(), normalized = {...values};
  if (normalized.voice && typeof normalized.voice === 'string') normalized.voice = {id: normalized.voice, language: values.language};
  if (id !== null) { try { const answer = await ask(id, {t: 'settings', values: normalized}, 8000); if (answer?.ok) return build(answer, id); } catch {} }
  const stored = await loadConfig(api.storage.local);   // old shapes first (marks, shortcuts key, two theme controls), then the new values
  for (const [k, v] of Object.entries(normalized)) { if (k === 'voice') stored.voices = {...(stored.voices || {}), [v.language]: v.id}; else if (k === 'markSection') stored.markTint = stored.markCorners = v !== 'off'; else if (k === 'markStyle') stored.markStyle = cleanStyle(v); else if (k === 'overlayTheme') stored.overlayTheme = cleanOverlayTheme(v); else if (k === 'keyboard') stored.keyboard = cleanKeyboard(v); else stored[k] = v; }
  coupleTheme(stored, Object.keys(normalized));   // overlay theme, page mode and the dark/light button are one state
  try { await api.storage.local.set({[SETTINGS_KEY]: stored}); } catch { throw new ReaderError('save_failed'); }
  return build(null);
}
/* Page session exports use a free capability contract. Source and job tokens still bind each hand-off. */
const sourceUrl=value=>{try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol))return '';url.username='';url.password='';return url.href.slice(0,2000);}catch{return '';}};
const INCOMING = 'notable-incoming-', INCOMING_TTL = 300000, INCOMING_BYTES = 9 * 1024 * 1024;
/* A hand-off the reader tab never consumed (closed early, failed to open) must not keep filling session storage. */
async function purgeIncoming(now = Date.now()) {
  try {
    const all = await api.storage.session.get(null);
    const stale = Object.keys(all).filter(key => key.startsWith(INCOMING) && !(now - all[key]?.created < INCOMING_TTL));
    if (stale.length) await api.storage.session.remove(stale);
  } catch {}
}
async function openInReader(doc, extra, placement = {}) {
  const text = typeof doc?.text === 'string' ? doc.text : '';
  if (!text.trim()) throw new ReaderError('document_unavailable');
  if (text.length > 6e6) throw new ReaderError('document_too_large');
  const chapters = (Array.isArray(doc.chapters) ? doc.chapters : []).slice(0, 2000).filter(c => typeof c?.label === 'string' && Number.isSafeInteger(c.charStart) && c.charStart >= 0).map(c => ({label: c.label.slice(0, 200), level: Number.isSafeInteger(c.level) ? c.level : 1, charStart: c.charStart}));
  const id = crypto.randomUUID(), key = INCOMING + id;
  const value = {text, title: String(doc.title || '').slice(0, 300), language: String(doc.language || '').slice(0, 20), chapters,
    created: Date.now(), ...extra};
  // storage.session holds about 10 MB of UTF-8: refuse an oversized hand-off before writing it.
  const oversized = () => new TextEncoder().encode(JSON.stringify(value)).length > INCOMING_BYTES;
  if (text.length * 3 > INCOMING_BYTES && oversized()) throw new ReaderError('document_too_large');
  await purgeIncoming();
  try { await api.storage.session.set({[key]: value}); } catch { throw new ReaderError('document_too_large'); }
  try { return await api.tabs.create({url: api.runtime.getURL('tools/reader/reader.html#incoming=' + id), ...placement}); }
  catch { await api.storage.session.remove(key).catch(() => {}); throw new ReaderError('tab_changed'); }
}
export async function openExport(doc, format, originTab, placement = {}) {
  if (!['mp3', 'wav', 'pdf', 'html'].includes(format)) throw new ReaderError('invalid');
  const exportToken = crypto.randomUUID();   // binds the asking page to this one job: state goes back to it, cancel / download come from it
  const source=Number.isSafeInteger(originTab)?await api.tabs.get(originTab).catch(()=>null):null;
  // The reader tab would keep a private page in normal storage.
  if (source?.incognito) throw new ReaderError('private_window');
  await openInReader(doc, {autoExport: format,sourceURL:sourceUrl(source?.url), ...(Number.isSafeInteger(originTab) ? {originTab, exportToken} : {})}, placement);
  return {ok: true, token: exportToken};
}
/* Focus reading view: ONE reader tab per page tab. The origin (tab, window, url) is kept in storage.session (a suspended worker forgets nothing):
   a second "open focus" from the page re-activates that tab instead of opening another; "focus" inside the reader tab closes it and brings the
   origin tab back (closeFocus). Origin tab gone: its url is opened again in the same window (http/https only); without a url the reader tab just closes. */
const FOCUS_KEY = 'focusTabs';
async function focusMap() { try { return (await api.storage.session.get(FOCUS_KEY))[FOCUS_KEY] || {}; } catch { return {}; } }
async function saveFocusMap(map) { try { await api.storage.session.set({[FOCUS_KEY]: map}); } catch {} }
const alive = async id => { try { return Number.isSafeInteger(id) ? await api.tabs.get(id) : null; } catch { return null; } };
const raise = async tab => { try { await api.tabs.update(tab.id, {active: true}); if (Number.isSafeInteger(tab.windowId)) await api.windows.update(tab.windowId, {focused: true}); } catch {} };
export async function openFocus(doc, origin) {
  if (origin?.incognito) throw new ReaderError('private_window');   // see openExport
  const map = await focusMap();
  if (origin && Number.isSafeInteger(origin.id)) {
    for (const [id, entry] of Object.entries(map)) {
      if (entry.tabId !== origin.id) continue;
      const open = await alive(Number(id));
      if (open) { await raise(open); return {ok: true, reused: true}; }
      delete map[id];
    }
  }
  const entry = origin && Number.isSafeInteger(origin.id) ? {tabId: origin.id, windowId: Number.isSafeInteger(origin.windowId) ? origin.windowId : null, url: /^https?:\/\//.test(origin.url || '') ? String(origin.url).slice(0, 2000) : ''} : null;
  const tab = await openInReader(doc, {focus: true,sourceURL:sourceUrl(entry?.url), ...(entry ? {focusOrigin: true} : {}), ...(Number.isSafeInteger(doc?.charStart) && doc.charStart >= 0 ? {resumeChar: doc.charStart} : {})}, entry ? {openerTabId: origin.id, ...(Number.isSafeInteger(origin.index) ? {index: origin.index + 1} : {}), ...(entry.windowId !== null ? {windowId: entry.windowId} : {})} : {});
  if (entry && Number.isSafeInteger(tab?.id)) { map[tab.id] = entry; for (const id of Object.keys(map)) if (!(await alive(Number(id)))) delete map[id]; await saveFocusMap(map); }
  return {ok: true};
}
/* The reader tab closes and the origin comes back. `focusTab` is the reader tab's own id (sender of the message or the active tab). */
export async function closeFocus(focusTabId, charStart) {
  const map = await focusMap(), entry = map[focusTabId];
  if (!entry) return {ok: false, code: 'no_origin'};
  delete map[focusTabId]; await saveFocusMap(map);
  let back = await alive(entry.tabId);
  if (back) { if (back.id === entry.tabId && Number.isSafeInteger(charStart) && charStart >= 0) { try { await ask(back.id, {t: 'control', command: 'seekChar', value: charStart}, 2500); } catch {} } await raise(back); }
  else if (entry.url) { try { back = await api.tabs.create({url: entry.url, active: true, ...(entry.windowId !== null && await api.windows.get(entry.windowId).then(() => true, () => false) ? {windowId: entry.windowId} : {})}); } catch {} }
  try { await api.tabs.remove(focusTabId); } catch {}
  return {ok: true, returned: back ? (back.id === entry.tabId ? 'origin' : 'reopened') : 'closed'};
}
async function isFocusTab(id) { return Number.isSafeInteger(id) && !!(await focusMap())[id]; }
