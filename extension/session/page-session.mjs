import {installBookmarkAction} from './bookmarks.mjs';
import {libraryText} from '../library/i18n.mjs';
import {mountExplainPanel} from '../explain/controller.mjs';
import {createTutor, TUTOR_PORT} from '../explain/tutor.mjs';
import {createTimelineMap} from './timeline-seek.mjs';
import {scopedChunks, pickChapter, chapterTarget, WORKFLOW_TEXT} from './workflows.mjs';
import {installQuickActions} from './quick-actions.mjs';
import {pageSnapshot} from './page-snapshot.mjs';
import {cleanReading,READING_FILTER_KEYS,readingBlockSkipped} from '../playback/reading-rules.js';
/* beNotable! Reader session · the reading session of one page (content script module, own code MIT).
   Collects the visible article text, shows the original player bar (mountPlayerSurface), plays through a Pipeline
   (system voices in the page, local AI voices in the engine host), marks the spoken word and follows it.
   Everything stays on the device: text goes page -> host only inside the extension, the network is used only for model downloads.
   ONE session for every view: the page bar AND the file view / Focus Reader (tools/reader/reader.html) run this class. The file view only supplies its text through `options.source`
   (collect() -> blocks/textNodes/blockEls/title/language/fingerprint, optional block.base = absolute offset of the block in the document text) and its layout through
   `options.mount/ownPage/keyboardActions/appearanceController`; playback, pause, position, tempo, volume, voices, models, marks, follow and keyboard are this code. */
import {collectHtmlBlocks, documentLanguage} from './html-content.mjs';
import {buildChunks, createRangeMapper} from './text-map.mjs';
import {createReadingMarks} from './reading-marks.mjs';
import {installMarkSettings} from './mark-settings.mjs';
import {installSettingsExtras} from './settings-extras.mjs';
import {installSettingsLayout} from './settings-layout.mjs';
import {deriveBoth, cleanOverlayTheme} from './overlay-theme.mjs';
import {defaults as configDefaults, loadConfig, coupleTheme, cleanKeyboard, EXPORT_KEYS, CONFIG_KEY} from '../config.mjs';
import {cleanStyle} from './mark-style.mjs';
import {createPageWatch} from './page-watch.mjs';
import {RemotePipeline, SpeechPipeline, PIPE_PORT, createProgressInterpolator, createWordTracker, createResumePoints} from '../playback/index.js';
import {mountPlayerSurface} from '../player-surface.mjs';
import {createFormatting} from '../formatting.mjs';
import {createAppearanceController} from '../appearance.mjs';
import {MODELS, modelBytes, recommendTier} from '../models/registry.js';
import {recommendVoices, firstRunVoice, deviceStartVoice} from '../voice-picker.mjs';
import {voiceName, voiceNote, tierLabel, uiText} from '../playback/voice-labels.js';
import {createReadingHistory,historyFailureText} from './reading-history.mjs';
import {errorKey, ERROR_KEYS as ENGINE_ERROR_KEYS, ERROR_STATUS_KEYS} from '../engine/error-keys.mjs';

/* The bar's appearance controller must color the real page (document.body), not the detached placeholder the surface falls back to (F1). */
const pageAppearance = options => createAppearanceController({...options, contentRoot: document.body || document.documentElement});
const api = globalThis.chrome?.runtime?.id ? globalThis.chrome : globalThis.browser;
/* Firefox uses its packaged single-thread engine; every export is free on both browsers. */
const IS_FIREFOX = String(api?.runtime?.getURL?.('')).startsWith('moz-extension:');
const SETTINGS_KEY = CONFIG_KEY;
/* "GPU" / "CPU" (+ the chip vendor the browser reports) for the status line */
const backendLabel = info => info?.backend === 'webgpu' ? 'GPU' + (info.gpu?.vendor ? ' · ' + info.gpu.vendor : '') : 'CPU';
/* Engine error code -> status line key: one table for every surface (engine/error-keys.mjs, cause and remedy in the
   catalog). GPU codes are named apart because a voice that cannot run here is refused before any download. */
const GPU_STATUS = Object.fromEntries(['webgpu-unavailable', 'jspi-unavailable', 'webgpu-failed']
  .map(code => [code, errorKey(code)]));
/* Errors the bar names with their own text; anything else is the generic reading error. */
const ERROR_KEYS = new Set(ERROR_STATUS_KEYS);
/* Cleared as soon as the listener picks another voice: they were about the old one. */
const VOICE_ERRORS = new Set([...Object.values(ENGINE_ERROR_KEYS), 'voice_none_chosen']);
/* A voice this device computes slower than it speaks (stops while reading that nobody asked for): the faster voices the bar OFFERS instead (it asks, nothing
   switches by itself), best first per language. Measured 20.11.2026 on a weaker machine (browser on 4 logical cores with a quota of 2, hardwareConcurrency 4):
   real-time factor Kokoro FP32 0.95, Kokoro compact (q8) 0.85-0.92 (no real gain), Kitten nano 0.27, Piper LJSpeech medium 0.13; Thorsten medium (German) 0.14. Kokoro voices of other languages (German Kerstin) offer Thorsten. */
const FASTER_VOICES = {en: ['kitten-nano', 'piper-en_us-ljspeech-medium'], de: ['piper-medium']};
const STALL_WINDOW_MS = 120000, STALLS_TO_OFFER = 3, STALL_MS_TO_OFFER = 6000;
/* DOM left behind by the copy of an updated extension (another isolated world): bar, marks, quick actions, panels. */
const ORPHAN_HOSTS = [
  '[data-notable-reader-surface="overlay"]', '[data-notable-reader-ui="highlight"]',
  '[data-notable-reader-ui="chapter-picker"]', '[data-notable-quick-actions]', '[data-reader-explain-panel]', '[data-reader-tutor-marks]',
  '[data-notable-appearance]', '[data-notable-reader-update]',
].join(',');
const norm = v => { const m = String(v || '').replace('_', '-').match(/^([a-z]{2,3})(?:-([a-z]{2}))?/i); return m ? (m[2] ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : m[1].toLowerCase()) : ''; };
const base = v => norm(v).split('-')[0];
const hash = value => { let h = 2166136261; for (const c of value) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const defaults = configDefaults;   // ONE schema: extension/config.mjs
const mbOf = model => Math.round(modelBytes(model) / 1e6);
const TUTOR_COMMANDS = {toggle: 'toggle', previousSection: 'previous', nextSection: 'next', previousBlock: 'previous', nextBlock: 'next', stop: 'cancel'};
/* blocks the guided explanation reads as context only, never as a key sentence */
const TUTOR_CONTEXT_ONLY = ['footnote', 'citation', 'header', 'footer', 'code', 'math', 'table', 'caption'];

/* A start that failed must not leave a session without a bar behind: every later click would only call show() on it
   until the page is reloaded. The broken session is taken down and the error goes to the caller (content loader). */
export async function start({test = null, hidden = false} = {}) {
  const running = globalThis.__notableSession;
  if (running) { await running.ready; if (!hidden) running.show(); return running; }
  const session = new PageSession({...(test || {}), hidden});
  globalThis.__notableSession = session;
  session.ready = session.init();
  try { await session.ready; }
  catch (error) {
    session.destroy();
    if (globalThis.__notableSession === session) globalThis.__notableSession = null;
    throw error;
  }
  return session;
}

export class PageSession {
  constructor(options) {
    this.options = options; this.settings = defaults(); this.generation = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');   // no crypto.randomUUID: it is missing on plain-http pages (not a secure context)
    this.chunks = []; this.blocks = []; this.chapters = []; this.timings = new Map(); this.timingKind = 'none';
    this.pipeline = null; this.pipelineKind = null; this.state = 'idle'; this.lastError = ''; this.busy = false; this.download = null; this.dlRunning = ''; this.dlQueue = []; this.cancelRequested = ''; this.version = 0; this.visible = !options.hidden;
    this.exportState = {state: 'idle', kind: 'audio'};
    this.voiceCard = null; this.errorParams = null; this.suspended = false;
    this.installed = new Set(); this.installedKnown = false; this.usedModels = new Set(); this.systemVoices = []; this.voiceMap = new Map(); this.catalog = []; this.voiceId = ''; this.lang = 'en';
    this.interp = createProgressInterpolator(); this.prefix = []; this.totalChars = 0; this.position = {chunk: 0, word: 0};
    this.tracker = createWordTracker({timingsFor: c => this.timings.get(c) ?? null, onWord: ({chunk, word}) => this.onWord(chunk, word), onChunk: c => { this.position = {chunk: c, word: 0}; this.changed(); }});
  }
  async init() {
    Object.assign(this.settings, await loadConfig(api.storage.local));   // the central configuration: older shapes (marks, shortcuts key, two theme controls) are migrated without loss, see config.mjs
    this.locales = await fetch(api.runtime.getURL('ui-locales.json')).then(r => r.json());
    if (!this.settings.uiLanguage) { const l = base(navigator.language); this.settings.uiLanguage = this.locales.messages[l] ? l : 'en'; }
    this.updateText = this.text('reader_updated');   // shown by an orphaned copy, which has no extension API
    if(!this.options.ownPage || /^(chrome|moz)-extension:$/.test(location.protocol))this.readingHistory=createReadingHistory({api,onBookmarksChanged:()=>this.bookmarkUi?.refresh(),onError:()=>this.workflowNotice(historyFailureText(this.settings.uiLanguage))});
    this.collect();
    this.explainUi?.setFocusEnabled(this.settings.focusMotion===true);
    this.resume = createResumePoints({storage: {get: async k => (await api.storage.local.get(k))[k], set: (k, v) => api.storage.local.set({[k]: v})}});
    await api.runtime.sendMessage({t: 'ensureHost'}).catch(() => {}); if (!(await this.refreshInstalled())) void this.refreshInstalled(20000).then(known => { if (known && !this.destroyed) { this.buildCatalog(); this.pickVoice(); this.changed(); this.prewarm(); } });   // cold host: keep asking in the background, the voice list corrects itself
    this.loadSystemVoices(); this.pickVoice();
    this.mountBar(); if (!this.visible) this.surface.setVisibility(false);
    /* Marks, follow policy of 1.6.24 and click-to-seek: ONE wiring shared with the file view / Focus Reader (reading-marks.mjs). */
    const surfaceHost = () => this.surface?.shadow?.host;
    this.readingMarks = createReadingMarks({chunks: this.chunks, blocks: this.blocks, textNodes: this.textNodes, blockEls: bi => this.blockEls[bi], settings: () => this.settings, getBar: () => this.surface?.shadow?.querySelector('.bar'), ownHost: surfaceHost, onSeek: (c, w) => void this.seekTo(c, w, true), onFollowOff: () => this.followOff()});
    this.highlight = this.readingMarks.highlight; this.zone = this.readingMarks.zone;
    this.watch = this.createWatch();
    this.onRuntimeMessage = (m, sender, respond) => this.onMessage(m, respond, sender);
    api.runtime.onMessage.addListener(this.onRuntimeMessage);
    api.storage.onChanged?.addListener(this.onStorage = (changes, area) => { if (area === 'local' && changes?.[SETTINGS_KEY]) this.mergeExternal(changes[SETTINGS_KEY].newValue); });   // another tab / the options page changed a setting: this session follows (keyboard, marks, theme ...)
    this.timer = setInterval(() => this.tick(), 60);
    this.bridgeVisibility(); this.bridgeActivity();
    if (!this.options.ownPage) {
      this.ensureQuickActions();
      try {const r=await api.runtime.sendMessage({t:'getChapter'});this.chapterRecipe=r?.recipe||null;}catch{}
      await this.restore();
    }
    this.changed();
    this.prewarm();
    return this;
  }
  text(key, params) { return uiText(this.locales, base(this.settings.uiLanguage) || 'en', key, params); }
  createWatch() {
    if (this.options.source) return null;
    return createPageWatch({onChange: () => this.rescan() !== false, isEmpty: () => !this.chunks.length});
  }
  /* Quick actions also host the popup's area selection: created again on demand after a closed bar took them down. */
  ensureQuickActions() {
    if (this.options.ownPage || this.quickActions || this.destroyed) return this.quickActions;
    const onArea = scope => void (scope.mode === 'ocr' ? this.captureScope(scope) : this.readScoped(scope));
    this.quickActions = installQuickActions({document, language: () => this.settings.uiLanguage,
      enabled: this.settings.reading?.quickActions === true, onRead: scope => void this.readScoped(scope, {play: true}), onArea});   // the listen button beside a selection is a play action; a drawn area opens paused
    return this.quickActions;
  }
  /* A bar closed while nothing is read must leave the page alone: no click-to-start, no hand cursor, no word mark, no
     page watching, no timers. Opening it again (or a start from the popup while it is closed) brings everything
     back and reads the page again if it changed meanwhile. The file view IS the document: its text stays clickable. */
  syncActivity() {
    if (this.destroyed || !this.surface || this.options.source) return;
    const active = this.visible || this.areaPending || ['playing', 'loading'].includes(this.state) || this.busy
      || this.starting === true;
    if (active === !this.suspended) return;
    this.suspended = !active;
    if (this.suspended) {
      clearInterval(this.timer); this.timer = 0; clearTimeout(this.visTimer);
      this.watch?.stop(); this.watch = null; this.visObserver?.disconnect(); this.visObserver = null;
      this.highlight?.setClickSeek(false); this.highlight?.clear(); this.highlight?.setEnabled?.(false);
      // switched-on quick actions are a page feature of their own and stay
      if (this.settings.reading?.quickActions !== true) { this.quickActions?.destroy(); this.quickActions = null; }
      /* One observer only notes "something changed" and disconnects at once: the next open rescans only if needed. */
      this.pageChanged = false; this.hiddenUrl = location.href; this.dirtyWatch?.disconnect();
      this.dirtyWatch = new MutationObserver(() => { this.pageChanged = true; this.dirtyWatch?.disconnect(); });
      this.dirtyWatch.observe(document.documentElement, {subtree: true, childList: true, characterData: true});
      return;
    }
    this.dirtyWatch?.disconnect(); this.dirtyWatch = null;
    this.timer ||= setInterval(() => this.tick(), 60);
    this.highlight?.setEnabled?.(true);
    this.ensureQuickActions(); this.highlight?.setClickSeek(this.settings.clickSeek);
    if (!this.watch) this.watch = this.createWatch();
    if (this.pageChanged || location.href !== this.hiddenUrl) this.rescan();
    if (!this.visObserver) this.watchVisible();
    const {chunk, word} = this.position;
    if (this.state === 'paused' || chunk > 0 || word > 0) this.markAt(chunk, word);
  }
  /* -- text ------------------------------------------------------------------------------------------------------------------------------ */
  collect() {
    this.checkpointReadingHistory();
    if (this.options.source) return this.collectSource();
    const collected = collectHtmlBlocks({cites: true,reading:this.settings.reading}), blocks = collected.blocks || [];
    this.blocks = blocks.filter(b => b.text); this.textNodes = collected.textNodes.filter((_, i) => blocks[i].text); this.blockEls = (collected.nodes || []).filter((_, i) => blocks[i]?.text); this.zone?.reset();
    this.pageLang = norm(documentLanguage(collected)) || norm(document.documentElement.lang) || norm(navigator.language) || 'en';
    this.chunks = scopedChunks(buildChunks(this.blocks, undefined, this.pageLang,this.settings.reading),this.blocks,this.textNodes,this.readScope);
    this.scans = (this.scans || 0) + 1; this.urlKey = location.origin + location.pathname + location.search; this.title = document.title || '';
    this.fingerprint = hash(location.origin + location.pathname + '|' + this.chunks.length + '|' + (this.chunks[0]?.text.slice(0, 80) || ''));
    this.prefix = []; let sum = 0; for (const c of this.chunks) { this.prefix.push(sum); sum += c.text.length + 1; } this.totalChars = sum;
    this.chapters = [];
    this.blocks.forEach((b, bi) => { for (const h of b.headings || []) { const ci = this.chunks.findIndex(c => c.block === bi && h.charStart < c.start + c.text.length + 1 && h.charStart >= c.start - 1); if (ci >= 0) this.chapters.push({label: h.label, sectionIndex: ci, level: h.level}); } });
    this.chapters.sort((a, b) => a.sectionIndex - b.sectionIndex);
    this.explainUi?.sourceChanged(); this.tutor?.sourceChanged(); this.watchVisible(); this.bindReadingHistory();
  }
  /* A view that owns its text (file view): the source hands over what the page collector would have found. */
  collectSource() {
    const c = this.options.source.collect({reading:this.settings.reading});
    this.blocks = c.blocks; this.textNodes = c.textNodes; this.blockEls = c.blockEls || []; this.zone?.reset();
    this.pageLang = norm(c.language) || norm(navigator.language) || 'en';
    this.chunks = scopedChunks(buildChunks(this.blocks, undefined, this.pageLang,this.settings.reading).filter(chunk=>!readingBlockSkipped(this.blocks[chunk.block],this.settings.reading)).map((chunk,id)=>({...chunk,id})),this.blocks,this.textNodes,this.readScope);
    if(this.settings.reading?.paragraphPause>0)for(let i=0;i<this.chunks.length;i++){const current=this.chunks[i],next=this.chunks[i+1],paragraph=this.blocks[current.block].paragraph??current.block;current.paragraphEnd=!next||(this.blocks[next.block].paragraph??next.block)!==paragraph;}
    this.scans = (this.scans || 0) + 1; this.urlKey = ''; this.title = c.title || '';
    this.fingerprint = c.fingerprint || hash(this.chunks.length + '|' + (this.chunks[0]?.text.slice(0, 80) || ''));
    this.prefix = []; let sum = 0; for (const ch of this.chunks) { this.prefix.push(sum); sum += ch.text.length + 1; } this.totalChars = sum;
    this.chapters = [];
    this.blocks.forEach((b, bi) => { for (const h of b.headings || []) { const ci = this.chunks.findIndex(ch => ch.block === bi && h.charStart < ch.start + ch.text.length + 1 && h.charStart >= ch.start - 1); if (ci >= 0) this.chapters.push({label: h.label, sectionIndex: ci, level: h.level}); } });
    this.chapters.sort((a, b) => a.sectionIndex - b.sectionIndex);
    this.explainUi?.sourceChanged(); this.tutor?.sourceChanged(); this.watchVisible(); this.bindReadingHistory();
  }
  bindReadingHistory() {
    if(!this.readingHistory)return;
    const source=this.options.source?.collect?.()||{},own=!!this.options.ownPage;
    if(source.noHistory===true){this.readingHistory.bind(null);return;}      // the popup's sample text is no reading
    const text=typeof source.text==='string'?source.text:this.documentText().text;
    this.readingHistory.bind({title:this.title,text,semanticRanges:source.semanticRanges,url:own?(source.url||''):(window===window.top?location.href:this.options.sourceURL||location.href),navigationURL:own?(source.navigationURL||source.url||''):(window===window.top?location.href:this.options.sourceURL||location.href),kind:own?(source.kind||'file'):'web',fileName:source.fileName||'',mimeType:source.mimeType||(own?'text/plain':'text/html'),fingerprint:this.fingerprint,language:this.pageLang,chunks:this.chunks,generation:this.generation});
  }
  historyPosition() {return {...this.position,char:this.charOfPosition()};}
  async addBookmark(name='') {if(!this.readingHistory||!this.chunks.length)return {ok:false,code:'document_unavailable'};try{const result=await this.readingHistory.bookmark(this.historyPosition(),name,this.chapters.filter(c=>c.sectionIndex<=this.position.chunk).at(-1)?.label||'');this.workflowNotice(libraryText(this.settings.uiLanguage,result?.private?'bookmarkPrivate':result?.ok?'bookmarkSaved':'bookmarkFailed'));this.bookmarkUi?.sync();return result;}catch{this.workflowNotice(libraryText(this.settings.uiLanguage,'bookmarkFailed'));return {ok:false,code:'bookmark_failed'};}}
  async toggleBookmark() {if(!this.readingHistory||!this.chunks.length)return {ok:false,code:'document_unavailable'};try{const result=await this.readingHistory.toggleBookmark(this.historyPosition(),'',this.chapters.filter(c=>c.sectionIndex<=this.position.chunk).at(-1)?.label||'');this.workflowNotice(libraryText(this.settings.uiLanguage,result?.private?'bookmarkPrivate':result?.ok?(result.saved?'bookmarkSaved':'bookmarkRemoved'):'bookmarkChangeFailed'));return result;}catch{this.workflowNotice(libraryText(this.settings.uiLanguage,'bookmarkChangeFailed'));return {ok:false,code:'bookmark_failed'};}}
  checkpointReadingHistory(completed=false) {return this.readingHistory?.checkpoint(this.historyPosition(),{completed:completed&&!this.readScope});}
  /* The view rendered a new document (or re-rendered): read it again, keep the listeners, forget the old pipeline. */
  async setDocument({chunk = 0, word = 0, char = null} = {}) {
    this.stop(); this.disposePipeline(); this.collect();
    this.readingMarks?.update({chunks: this.chunks, blocks: this.blocks, textNodes: this.textNodes}, null);
    this.position = Number.isSafeInteger(char)&&char>=0?this.positionAtChar(char):{chunk: Math.max(0, Math.min(chunk, this.chunks.length - 1)), word}; this.lastError = ''; this.errorClass = ''; this.exportState = {state: 'idle', kind: 'audio'};
    this.pickVoice(); this.buildCatalog(); this.changed();
  }
  /* The place saved for this document (resume points) -> position + mark; returns it or null. */
  async restore() {
    const fingerprint=this.fingerprint,chunks=this.chunks,position=this.position,playIntent=this.playIntent;
    let saved = await this.resume.get(fingerprint).catch(() => null);
    if(!saved){const entry=await this.readingHistory?.restore();if(entry&&!entry.completed){if(Number.isSafeInteger(entry.position?.char)){const chunk=this.chunkOfChar(entry.position.char),offsets=this.timeline().offsetsFor(chunk)||[];let word=0;for(let i=0;i<offsets.length;i++){if(offsets[i].start<=entry.position.char-this.charOfChunk(chunk))word=i;else break;}saved={chunk,word};}else saved=entry.position;}}
    if(fingerprint!==this.fingerprint||chunks!==this.chunks||position!==this.position||playIntent!==this.playIntent||['playing','loading'].includes(this.state))return null;
    if(saved&&Number.isSafeInteger(saved.char)&&saved.char>=0)saved={...saved,...this.positionAtChar(saved.char)};
    if (saved && saved.chunk < this.chunks.length) { this.position = {chunk: saved.chunk, word: saved.word}; this.markAt(saved.chunk, saved.word); this.changed(); return this.position; }
    return null;
  }
  /* The page changed under the session (late render, SPA route, appended text): read it again without losing what is still valid.
     Another URL = another document: stop and start from its beginning. Same URL while audio is running: keep reading what is loaded, apply when it stops. */
  rescan(fromUser = false) {
    if (this.destroyed) return false;
    const urlChanged = location.origin + location.pathname + location.search !== this.urlKey, live = ['playing', 'loading'].includes(this.state) || this.busy;
    /* A running voice download counts as live: a new chunk list would replace the pipeline and its port. */
    const downloading = !!this.download || !!this.dlRunning;
    if ((live || downloading) && !urlChanged && !fromUser) { this.rescanPending = true; return false; }
    this.rescanPending = false;
    const old = this.chunks, at = this.position, atText = old[at.chunk]?.text;
    if (urlChanged && this.state !== 'idle') { this.pipeline?.stop(); this.highlight?.clear(); this.state = 'idle'; }
    if (urlChanged) this.voiceCard = null;
    this.collect();
    const same = old.length === this.chunks.length && old.every((c, i) => c.text === this.chunks[i].text);
    const paused = this.state === 'paused' && !urlChanged, nextAt = () => { const keep = atText != null ? this.chunks.findIndex(c => c.text === atText) : -1; return keep >= 0 ? {chunk: keep, word: at.word} : null; };
    this.readingMarks?.update({chunks: this.chunks, blocks: this.blocks, textNodes: this.textNodes}, paused ? (same ? at : nextAt()) : null);   // N2: a rescan applied at the moment of Pause must not wipe the word mark
    if (!same) {
      this.disposePipeline();                                  // the loaded chunk list is stale
      const keep = !urlChanged && atText != null ? this.chunks.findIndex(c => c.text === atText) : -1;
      this.position = keep >= 0 ? {chunk: keep, word: at.word} : {chunk: 0, word: 0};
      if (this.state !== 'idle' && this.state !== 'paused') this.state = 'idle';
      this.lastError = ''; this.errorClass = '';
    }
    this.changed();
    return !same;
  }
  /* -- visible sections (look-ahead priority) ------------------------------------------------------------------------------------------- */
  /* The sections on screen are prepared right after the next three (1.6.24 rule): the page reports them (IntersectionObserver on the block elements, only indices, no text) and the engine host
     orders its background work accordingly. Block granularity is enough: a long code block reports all of its sections. */
  watchVisible() {
    this.visObserver?.disconnect(); this.visObserver = null; this.visBlocks = new Set();
    if (this.suspended || !globalThis.IntersectionObserver || !this.blockEls?.length) return;
    const index = new Map(); this.blockEls.forEach((el, bi) => { if (el) index.set(el, bi); });
    this.visObserver = new IntersectionObserver(entries => {
      for (const e of entries) { const bi = index.get(e.target); if (bi === undefined) continue; if (e.isIntersecting) this.visBlocks.add(bi); else this.visBlocks.delete(bi); }
      this.scheduleVisible();
    });
    for (const el of index.keys()) this.visObserver.observe(el);
  }
  visibleChunks() { const out = []; if (!this.visBlocks?.size) return out; for (let i = 0; i < this.chunks.length && out.length < 400; i++) if (this.visBlocks.has(this.chunks[i].block)) out.push(i); return out; }
  scheduleVisible() { clearTimeout(this.visTimer); this.visTimer = setTimeout(() => this.sendVisible(), this.options.visibleDebounceMs ?? 150); }
  sendVisible() { if (this.destroyed || this.pipelineKind !== 'neural') return; try { this.pipeline?.setVisible?.(this.visibleChunks()); } catch {} }
  /* -- voices ---------------------------------------------------------------------------------------------------------------------------- */
  /* Asks the host for the voices on this device. Returns true only when the host ANSWERED (an empty list is an answer, no answer is not).
     The host page may be cold: Chrome closes an offscreen document 30 s after the last audio and the next message finds nobody (or a page whose listener is not registered yet),
     Firefox unloads its event page. So: ask again, start the host again between attempts, for up to `budgetMs`; the list stays as it was when nobody answers. */
  async refreshInstalled(budgetMs = 1200, {fresh = false} = {}) {
    const until = Date.now() + budgetMs;
    for (let attempt = 0; ; attempt++) {
      try { const r = await api.runtime.sendMessage({target: 'host', t: 'models', ...(fresh ? {fresh: true} : {})}); if (r?.ok) { this.installed = new Set(r.installed); this.installedKnown = true; if (r.caps) this.caps = r.caps; return true; } } catch {}
      if (Date.now() >= until) return false;
      await new Promise(resolve => setTimeout(resolve, Math.min(150 * (attempt + 1), 1000)));
      if (attempt % 3 === 2) await api.runtime.sendMessage({t: 'ensureHost'}).catch(() => {});
    }
  }
  loadSystemVoices() {
    const load = () => { this.systemVoices = (globalThis.speechSynthesis?.getVoices?.() || []).filter(v => v.localService !== false); this.buildCatalog(); this.pickVoice(); this.changed(); };
    load(); globalThis.speechSynthesis?.addEventListener?.('voiceschanged', this.onVoicesChanged = load);
  }
  buildCatalog() {
    const groups = new Map(), ui = base(this.settings.uiLanguage) || 'en'; this.voiceMap.clear();
    const add = (lang, id, label, note, ref, engine, extra = {}) => { const code = norm(lang); if (!code) return; let g = groups.get(code); if (!g) { g = {code, label: code, default: id, voices: []}; groups.set(code, g); } g.voices.push({id, label, note, engine, ...extra}); this.voiceMap.set(id, ref); };
    for (const v of this.systemVoices) add(v.lang, 'system:' + hash(v.voiceURI + '|' + v.lang + '|' + v.name), v.name, voiceNote(this.locales, ui, 'device'), {kind: 'system', id: v.voiceURI, lang: v.lang}, 'system');
    this.offer = this.computeOffer();
    for (const m of Object.values(MODELS)) {
      if (m.experimental) continue;   // Experimental voices are deliberately absent from every selection surface.
      const mb = Math.round(modelBytes(m) / 1e6), installed = this.installed.has(m.id), tier = tierLabel(this.locales, ui, m.tier), progress = this.download?.modelId === m.id ? Math.min(100, Math.round(100 * this.download.loaded / Math.max(1, this.download.total))) : undefined;
      add(m.lang, m.voiceURI, voiceName(this.locales, ui, m.name), tier + ' · ' + (installed ? voiceNote(this.locales, ui, 'local') : voiceNote(this.locales, ui, 'download', {mb})), {kind: 'neural', id: m.id, lang: m.lang, model: m}, 'neural',
        {tier: m.tier, installed, mb, ...(m.experimental ? {experimental: true, needs: m.needs, notes: m.notes, ...(this.gpuProblem(m) ? {unavailable: this.gpuProblem(m)} : {})} : {}), ...(progress !== undefined ? {progress} : {}), ...(this.dlQueue.includes(m.id) ? {queued: true} : {}), ...(this.offer?.id === m.id ? {recommended: true} : {})});
    }
    this.catalog = [...groups.values()];
  }
  /* The best voice for this device (Chromium with threads, >= 8 cores and 8 GB: Kokoro FP32 for English, Piper high for German) that is not on the device yet.
     Offered, never downloaded silently; gone once the user chose any voice for the language or declined the offer. */
  computeOffer() {
    const lang = this.lang, caps = this.caps || {}, memory = caps.memoryGB ?? navigator.deviceMemory, cores = caps.cores ?? navigator.hardwareConcurrency;
    if (this.settings.offerDeclined?.[lang] || Object.keys(this.settings.voices || {}).some(key => base(key) === lang)) return null;
    if (recommendTier({memory, cores, threads: caps.threads === true}) !== 'best') return null;      // only capable devices get an offer
    const model = firstRunVoice(Object.values(MODELS), lang, memory);       // the language's first-run voice
    if (!model || this.installed.has(model.id)) return null;
    if ([...this.installed].some(i => MODELS[i]?.languages.includes(lang) && MODELS[i].tier === 'best' && !MODELS[i].experimental)) return null;
    return {id: model.id, mb: mbOf(model), name: model.name};
  }
  /* The current voice can read now: a device voice, a voice on the device, or one the host already synthesized with. */
  voiceUsable() {
    const voice = this.voice;
    return !!voice && (voice.kind !== 'neural' || this.installed.has(voice.id) || this.usedModels.has(voice.id));
  }
  /* What the voice card offers: the voice the listener chose (a stored choice is never replaced), else the
     recommendation that suits this device, plus the next smaller recommended voice. Both come from recommendVoices,
     the rule the voice picker shows as "Recommended for you". */
  voiceChoices(wanted = null) {
    const caps = this.caps || {}, memory = caps.memoryGB ?? navigator.deviceMemory;
    const cores = caps.cores ?? navigator.hardwareConcurrency, threads = caps.threads === true;
    const picks = recommendVoices(Object.values(MODELS), this.lang, memory), order = ['small', 'balanced', 'best'];
    // a capable device starts with the language's first-run voice (FIRST_RUN_VOICES: German Thorsten medium), others with their tier's recommendation (voice-picker deviceStartVoice, the welcome page uses the same rule)
    const start = deviceStartVoice(Object.values(MODELS), this.lang, {tier: recommendTier({memory, cores, threads}), memoryGB: memory});
    const fitting = start ? {model: start} : null;
    const stored = Object.entries(this.settings.voices || {}).filter(([key]) => base(key) === this.lang);
    const chosen = !!wanted && stored.some(entry => entry[1] === wanted.voiceURI);
    const primary = wanted && (chosen || !fitting) ? wanted : fitting?.model || wanted;
    if (!primary || primary.experimental) return null;
    const smaller = picks.map(pick => pick.model).filter(m => m.id !== primary.id && mbOf(m) < mbOf(primary)).at(-1);
    return {reason: this.voiceUsable() ? 'better' : 'none', primary: primary.id, smaller: smaller?.id || null};
  }
  /* Play met a voice that is not on the device: auto-download the best recommended voice and start reading.
     No voice card is shown - the recommended voice is downloaded immediately. */
  askVoice(at, wanted = null) {
    if (globalThis.navigator?.onLine === false) {
      this.errorParams = null; this.fail('offline_download'); return false;
    }
    const card = this.voiceChoices(wanted);
    if (!card) { this.fail('voice_none_chosen'); return false; }
    if (VOICE_ERRORS.has(this.lastError)) this.lastError = '';
    // Auto-download the primary (recommended) voice and start playing
    this.voiceCard = {...card, at: {chunk: at.chunk, word: at.word}, downloading: ''};
    this.changed();
    void this.takeVoice(card.primary);
    return false;
  }
  /* Stops while reading that nobody asked for (playing -> loading without a command): the device computes this voice slower than it speaks. After
     STALLS_TO_OFFER stops or STALL_MS_TO_OFFER ms of such silence within STALL_WINDOW_MS the bar offers a faster voice, once per voice and page; "keep" is
     remembered per voice. Reading goes on meanwhile. */
  noteStall(next) {
    const now = Date.now();
    if (this.state === 'playing' && next === 'loading' && !this.starting && now - (this.userMoveAt || 0) > 1500) { this.stallFrom = now; return; }
    if (!this.stallFrom || next === 'loading') return;
    const ms = now - this.stallFrom; this.stallFrom = 0;
    if (next !== 'playing') return;
    this.stalls = [...(this.stalls || []).filter(stall => now - stall.at < STALL_WINDOW_MS), {at: now, ms}];
    if (this.stalls.length >= STALLS_TO_OFFER || this.stalls.reduce((sum, stall) => sum + stall.ms, 0) >= STALL_MS_TO_OFFER) this.offerFasterVoice();
  }
  /* The first voice of FASTER_VOICES for this language that is not the current one and has not stopped on this page itself. */
  fasterVoice() {
    const seen = this.slowSeen || new Set();
    return (FASTER_VOICES[this.lang] || []).map(id => MODELS[id]).find(model => model && !model.experimental && model.id !== this.voice?.id && !seen.has(model.id)) || null;
  }
  offerFasterVoice() {
    const from = this.voice?.id; if (this.voice?.kind !== 'neural' || !from || this.voiceCard || this.tutor?.owns) return;
    this.slowSeen ??= new Set(); if (this.slowSeen.has(from) || this.settings.slowDeclined?.[from]) return;
    this.slowSeen.add(from); this.stalls = [];
    const faster = this.fasterVoice(); if (!faster) return;
    this.voiceCard = {reason: 'slow', primary: faster.id, smaller: null, from, at: {chunk: this.position.chunk, word: this.position.word}, downloading: ''};
    this.changed();
  }
  /* "Download" on the card: the card turns into the progress line, the voice is selected once it is on the device and
     reading starts where Play was pressed. */
  async takeVoice(id) {
    const card = this.voiceCard; if (!card || card.downloading || ![card.primary, card.smaller].includes(id)) return;
    card.downloading = id; this.changed();
    await this.downloadVoice(id);
    if (this.voiceCard !== card) return;       // closed, stopped or replaced meanwhile: no surprise audio
    const model = MODELS[id];
    if (card.reason === 'slow' && model && this.installed.has(model.id) && this.voice?.id !== model.id) await this.applySettings({voice: {language: model.lang, id: model.voiceURI}});
    if (this.voiceCard !== card) return;
    this.voiceCard = null;
    if (this.installed.has(id) && !this.destroyed) await this.play(card.at.chunk, card.at.word); else this.changed();
  }
  /* Card closed (X, Esc) or "read with the current voice". Only a card that was really shown can be declined, and only
     an offer next to a usable voice is remembered as declined. */
  async closeVoiceCard(keepReading = false) {
    const card = this.voiceCard; if (!card) return;
    this.voiceCard = null;
    if (card.downloading) { this.changed(); return; }       // the download goes on, its progress line has a Cancel
    if (card.reason === 'slow') {       // reading goes on with the current voice; "keep" means: do not ask again for this voice
      if (keepReading) { this.settings.slowDeclined = {...(this.settings.slowDeclined || {}), [card.from]: true}; await this.save(); }
      this.changed(); return;
    }
    if (card.reason === 'better') {
      this.settings.offerDeclined = {...(this.settings.offerDeclined || {}), [this.lang]: true}; this.offer = null;
      await this.save(); this.buildCatalog();
    } else this.fail('voice_none_chosen');
    this.changed();
    if (keepReading && card.reason === 'better') await this.play(card.at.chunk, card.at.word);
  }
  /* The download button of a voice row: the click is the consent (size is on the button). The voice is selected once it is on the device.
     ONE download runs at a time (the model store, the engine and the cache write lock are single-slot, and two multi-gigabyte transfers would only slow each other down);
     every further click is put in a queue (the row shows "waiting"), runs when the one before has ended (finished, failed or cancelled), and can be taken out again (cancelDownload).
     Earlier a second click was refused ("a download is already running"), so a large voice clicked after a small one could never be started. */
  async downloadVoice(id) {
    const model = Object.values(MODELS).find(m => m.voiceURI === id || m.id === id);
    if (!model || this.installed.has(model.id)) return;
    if (this.dlRunning || this.download) { if (this.dlRunning !== model.id && this.download?.modelId !== model.id && !this.dlQueue.includes(model.id)) { this.dlQueue.push(model.id); this.buildCatalog(); this.changed(); } return; }
    this.dlRunning = model.id; this.cancelRequested = ''; this.lastError = ''; this.buildCatalog(); this.changed();
    /* A refusal or a failure is always shown (status line, and the voice list names a missing WebGPU itself) and never leaves `download` set: a stale value made every later click on a download arrow do nothing, silently. */
    try { if (await this.needModel(model, true) && !this.dlQueue.length) await this.applySettings({voice: {language: model.lang, id: model.voiceURI}}); }
    catch (error) {
      this.download = null; this.errorClass = [error?.name, String(error?.message || '').slice(0, 80)].join(': ');
      this.errorParams = {mb: mbOf(model)}; this.fail(this.failureKey(error?.code) || 'prepare_failed');
    }
    this.dlRunning = ''; this.cancelRequested = '';
    const next = this.dlQueue.shift(); this.buildCatalog(); this.changed();
    if (next && !this.destroyed) void this.downloadVoice(next);
    else if (this.rescanPending && !['playing', 'loading'].includes(this.state) && !this.busy) this.rescan();
  }
  /* Takes ONE download out: a waiting one leaves the queue, the running one is aborted in the engine (the others go on). */
  async cancelDownload(id) {
    const model = Object.values(MODELS).find(m => m.voiceURI === id || m.id === id);
    if (!model) return;
    const at = this.dlQueue.indexOf(model.id);
    if (at >= 0) { this.dlQueue.splice(at, 1); this.buildCatalog(); this.changed(); return; }
    if (this.dlRunning !== model.id) return;
    this.cancelRequested = model.id;
    try { await api.runtime.sendMessage({target: 'host', t: 'cancelInstall'}); } catch {}
  }
  /* Releases the files of one voice from the device (Cache API; Kitten siblings share one file set and go with it). The row button asked twice; never while a download runs. */
  async removeVoice(id) {
    const model = Object.values(MODELS).find(m => m.voiceURI === id || m.id === id);
    if (!model || !this.installed.has(model.id) || this.download) return;
    if (this.voice?.id === model.id) { this.stop(); this.disposePipeline(); }
    try { await api.runtime.sendMessage({target: 'host', t: 'removeVoice', modelId: model.id}); } catch {}
    await this.refreshInstalled();
    /* siblings that shared the files went with it: a stored choice must not point at a voice that is no longer on the device */
    const gone = new Set(Object.values(MODELS).filter(m => m.voiceURI === model.voiceURI || !this.installed.has(m.id) && m.files.length === model.files.length && m.files.every(f => model.files.some(g => g.url === f.url))).map(m => m.voiceURI));
    const voices = Object.fromEntries(Object.entries(this.settings.voices || {}).filter(([, value]) => !gone.has(value)));
    this.buildCatalog(); this.pickVoice(); await this.applySettings({voices});
  }
  pickVoice() {
    if (!this.catalog.length) this.buildCatalog();
    const code = this.settings.language === 'auto' ? this.pageLang : this.settings.language, b = base(code);
    this.lang = b || 'en';
    const entries = [...this.voiceMap].filter(([, r]) => base(r.lang) === b);
    const stored = Object.entries(this.settings.voices || {}).filter(([key]) => base(key) === b).map(([, id]) => id);
    let pick = entries.find(([id]) => stored.includes(id));
    /* Stage "Experimentell" is never chosen automatically: only an explicit choice (stored) selects such a voice. */
    const auto = entries.filter(([, r]) => !r.model?.experimental);
    /* nothing on the device yet: the voice Play downloads (voiceChoices' recommendation for this device), so the bar names it and its size before the click */
    const recommended = () => { try { const id = this.voiceChoices()?.primary; return id ? auto.find(([, r]) => r.kind === 'neural' && r.id === id) : null; } catch { return null; } };
    if (!pick) pick = auto.find(([, r]) => r.kind === 'neural' && this.installed.has(r.id)) || auto.find(([, r]) => r.kind === 'system') || recommended() || auto.find(([, r]) => r.kind === 'neural' && r.model.tier === 'fast') || auto[0] || entries[0];
    this.voiceId = pick?.[0] || ''; this.voice = pick?.[1] || null;
    if (this.computeOffer()?.id !== this.offer?.id) this.buildCatalog();
  }
  /* -- pipeline -------------------------------------------------------------------------------------------------------------------------- */
  async ensurePipeline() {
    const kind = this.voice?.kind === 'neural' ? 'neural' : 'system';
    /* The pipeline carries the voice it was loaded with. pickVoice() can switch this.voice without disposing it (the first Play downloads the
       recommended voice through a pipeline built for the voice shown before; afterwards the new voice is picked): reusing that pipeline made the
       host answer "model-missing" and the bar hung in "Loading" until the 60 s start timeout. A running download keeps its pipeline. */
    if (this.pipeline && this.pipelineKind === kind && (this.download || this.dlRunning || this.pipelineVoiceKey === JSON.stringify(this.pipelineVoice()))) return this.pipeline;
    /* One build at a time: prewarm and Play can ask at the same moment (two pipelines would load the chunk list twice and one port would leak). */
    if (this.pipelineBuild) { await this.pipelineBuild.catch(() => {}); return this.ensurePipeline(); }
    const build = this.buildPipeline(kind); this.pipelineBuild = build;
    try { return await build; } finally { if (this.pipelineBuild === build) this.pipelineBuild = null; }
  }
  async buildPipeline(kind) {
    this.disposePipeline({preserveIntent:true});
    if (kind === 'neural') {
      await api.runtime.sendMessage({t: 'ensureHost'});
      const port = api.runtime.connect({name: PIPE_PORT});
      this.pipeline = new RemotePipeline({port});
    } else this.pipeline = new SpeechPipeline();
    this.pipelineKind = kind; this.pipelineVoiceKey = JSON.stringify(this.pipelineVoice());
    const pipeline=this.pipeline;
    for (const type of ['state', 'timings', 'progress', 'download', 'word']) this.pipeline.addEventListener(type, e => {if(this.pipeline===pipeline)this.onPipeline(type,e.detail);});
    this.pipeline.addEventListener('computing', () => { if(this.pipeline!==pipeline)return;this.computing = true; this.changed(); });      // slower-than-real-time voice (stage "Experimentell"): status "Berechnung laeuft, Wiedergabe startet gleich" while the state is loading
    this.pipeline.addEventListener('state', e => { if(this.pipeline!==pipeline)return;if (e.detail.state !== 'loading') this.computing = false; });
    this.pipeline.addEventListener('engine', e => { if(this.pipeline!==pipeline)return;this.engineInfo = e.detail; this.changed(); });      // backend of the loaded voice (GPU/CPU) for the status line and the diagnosis
    this.pipeline.addEventListener('prefetch', e => { if (this.pipeline === pipeline) this.onPrefetch(e.detail); });      // what the host holds: the prepared bar of the timeline
    await this.pipeline.load({chunks: this.chunks, lang: this.lang, voice: this.pipelineVoice(), startChunk: this.position.chunk, normalize: this.settings.normalizeSpeech !== false,reading:this.settings.reading, compute: this.settings.computePath || 'auto'});
    if (document.visibilityState === 'hidden') pipeline.setActivity?.({hidden: true});
    pipeline.setRate?.(this.settings.speed); pipeline.setVolume?.(this.settings.muted ? 0 : this.settings.volume / 100); pipeline.setFx?.(this.fx());       // AFTER load (the host drops commands before it): every NEW pipeline (voice switch, prewarm, host loss) starts with the session's values: Play after a switch while paused only resumes it and never pushes them
    this.sendVisible();
    return this.pipeline;
  }
  /* voice shaping of the settings -> the pipeline's {pitch, bass, treble, gapMs} */
  fx() { const s = this.settings; return {pitch: s.pitch ?? 0, bass: s.bass ?? 0, treble: s.treble ?? 0, gapMs: s.sectionPause ?? 0}; }
  pipelineVoice() { return this.voice?.kind === 'neural' ? {kind: 'neural', id: this.voice.id, lang: this.voice.lang, ...(this.voice.model?.experimental ? {experimental: true} : {})} : {kind: 'system', id: this.voice?.id || 'default', lang: this.voice?.lang || this.lang}; }
  disposePipeline({preserveIntent=false}={}) { if(!preserveIntent)this.playIntent=(this.playIntent||0)+1;this.downloadAbort?.abort();try { this.pipeline?.dispose?.(); } catch {} this.pipeline = null; this.pipelineKind = null; this.prepared = null; this.timings.clear(); this.interp.reset(); this.tracker.reset(); }
  onPipeline(type, d) {
    if(this.seekFence&&['state','progress','word'].includes(type))return;
    if (type !== 'timings' || d?.chunk === this.position.chunk) this.armStart();      // word times of sections made in the background (the open bar's look-ahead) are no progress of the start: they must not keep a silent start alive
    if (type === 'state') {
      if (d.state === 'error' && d.code === 'host-lost') {          // host page was unloaded (Firefox idle suspend, Chrome offscreen closed): drop the dead port, reconnect on demand
        const was = this.state; this.disposePipeline();
        if (was === 'paused' || was === 'idle') { this.changed(); return; }       // nothing audible lost: the next Play opens a fresh port
        if (this.wantPause) { this.wantPause = false; this.state = 'paused'; void this.savePosition(true); this.changed(); return; }       // the user paused while the section loaded: losing the host must not turn that into a Play
        if (Date.now() - (this.lostAt || 0) > 10000) { this.lostAt = Date.now(); this.state = 'paused'; void this.play(this.position.chunk, this.position.word); return; }
      }
      if (d.state === 'playing' && this.wantPause) { this.wantPause = false; this.pipeline?.pause(); return; }       // Pause pressed while the section was still loading: the audio never becomes audible
      if (d.state !== 'loading') this.wantPause = false;
      if (['playing', 'paused', 'ended', 'preempted'].includes(d.state) || d.state === 'error' && d.code !== 'model-missing') { this.starting = false; clearTimeout(this.startTimer); }
      this.noteStall(d.state);
      this.state = d.state; if(d.state==='playing')void this.readingHistory?.heard(this.historyPosition()); this.lastError = d.state === 'error' ? (GPU_STATUS[d.code] || d.code === 'host-failed' && (this.failureKey(d.reason) || (this.offlineMissingModel() ? 'offline_download' : '')) || errorKey(d.code) || d.code || 'error') : '';
      if (d.state === 'error' && d.code === 'model-missing') this.lastError = '';
      if (d.state === 'error' && d.code === 'model-missing' && this.starting && !this.download && !this.dlRunning && !this.modelMissingRetry) {
        this.modelMissingRetry = true; const at = this.position; this.disposePipeline({preserveIntent: true}); this.state = 'paused'; this.changed(); void this.play(at.chunk, at.word); return;
      }
      if (d.state === 'playing') this.modelMissingRetry = false;
      if (d.state === 'ended') { void this.checkpointReadingHistory(true); this.options.onEnded?.(); if(this.chapterRecipe&&!this.readScope)void this.continueChapter(); this.highlight.clear(); void this.resume.forget(this.fingerprint); }
      if (['paused', 'idle', 'ended', 'error', 'preempted'].includes(d.state)) void this.savePosition(true);
      if (this.rescanPending && !['playing', 'loading'].includes(this.state) && !this.busy) this.rescan();
      this.changed();
    } else if (type === 'timings') {
      if (d.chunk < 0) return;
      this.timings.set(d.chunk, d.kind === 'none' ? null : d.words.map(w => ({start: w.s, end: w.e}))); this.timingKind = d.kind;
    } else if (type === 'progress') this.interp.push(d);
    else if (type === 'word') this.onWord(d.chunk, d.word);
    else if (type === 'download') this.onDownload(d);
  }
  /* Download progress reaches the page up to 8 times a second; each event used to rebuild the catalog and repaint the whole bar (50 ms with the voice list open).
     Only a change of the whole percent (or of the phase) is shown, at most 4 times a second (trailing), the end (ready/error) at once. */
  onDownload(d) {
    const end = d.phase === 'ready' || d.phase === 'error';
    clearTimeout(this.downloadTimer); this.downloadTimer = 0;
    this.download = end ? null : d;
    if (d.phase === 'ready') { this.shownDownload = ''; void this.refreshInstalled().then(() => { this.buildCatalog(); this.pickVoice(); this.changed(); }); this.changed(); return; }
    const key = end ? 'end' : d.modelId + '|' + d.phase + '|' + Math.round(100 * d.loaded / Math.max(1, d.total));
    if (key === this.shownDownload) return;
    const show = () => { this.downloadTimer = 0; if (this.destroyed) return; this.shownDownload = key; this.shownAt = performance.now(); this.buildCatalog(); this.changed(); };
    const wait = end ? 0 : Math.max(0, 250 - (performance.now() - (this.shownAt || 0)));
    if (wait > 0) this.downloadTimer = setTimeout(show, wait); else show();
  }
  explainSource() {
    return {epoch:this.generation+'|'+this.scans+'|'+this.fingerprint,blocks:this.blocks.map((b,i)=>({id:'b'+i,text:b.text,element:this.blockEls[i]}))};
  }
  ensureExplain() {
    if(!this.explainUi)this.explainUi=mountExplainPanel({document,extensionBase:api.runtime.getURL(''),getSource:()=>this.explainSource(),language:this.settings.uiLanguage});
    const enabled=this.settings.focusMotion===true;if(this.explainFocusEnabled!==enabled){this.explainFocusEnabled=enabled;this.explainUi.setFocusEnabled(enabled);}
    return this.explainUi;
  }
  /* Guided explanation (explain/tutor.mjs): the text, word ranges, voices and settings of THIS session; no second text map. */
  ensureTutor() {
    if (this.tutor) return this.tutor;
    const mappers = new Map(); let mappedFor = null;
    const blockIndex = id => /^b\d+$/.test(id) ? Number(id.slice(1)) : -1;
    const mapper = bi => { if (mappedFor !== this.textNodes) { mappers.clear(); mappedFor = this.textNodes; } if (!mappers.has(bi)) mappers.set(bi, createRangeMapper(this.textNodes[bi] || [], this.blocks[bi].text)); return mappers.get(bi); };
    this.tutor = createTutor({document, shadow: () => this.surface?.shadow || null, text: (k, p) => this.text(k, p), uiLanguage: () => this.settings.uiLanguage, pageLanguage: () => this.pageLang, settings: () => this.settings,
      source: () => ({epoch: this.generation + '|' + this.fingerprint, title: this.title || '', blocks: this.blocks.map((b, i) => ({id: 'b' + i, text: b.text, skip: TUTOR_CONTEXT_ONLY.some(f => b[f] === true)}))}),
      rangeOf: (id, start, end) => { const bi = blockIndex(id); if (bi < 0 || !this.blocks[bi]) return null; return mapper(bi)?.range(start, end) || null; },
      selection: () => this.tutorSelection(mapper), here: () => this.position.chunk > 0 && this.chunks[this.position.chunk] ? 'b' + this.chunks[this.position.chunk].block : null,
      voiceFor: lang => this.tutorVoice(lang), pipelineFor: v => this.tutorPipeline(v), pauseReading: async () => { if (['playing', 'loading'].includes(this.state)) await this.pause(); },
      connect: async () => { await api.runtime.sendMessage({t: 'ensureHost'}).catch(() => {}); return api.runtime.connect({name: TUTOR_PORT}); }, changed: () => this.changed(),
      saveSettings: patch => this.applySettings(patch)});   // the tour's menu changes the stored summarize settings (one source with the settings panel)
    return this.tutor;
  }
  /* the selected words as block intervals (only blocks the selection touches are measured) */
  tutorSelection(mapper) {
    const selection = document.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0), out = [];
    this.blocks.forEach((b, bi) => {
      const el = this.blockEls[bi]; if (!el || !range.intersectsNode(el)) return;
      const m = mapper(bi); if (!m) return; let start = -1, end = -1;
      for (const w of b.text.matchAll(/\S+/gu)) { const r = m.range(w.index, w.index + w[0].length); if (r && range.compareBoundaryPoints(Range.END_TO_START, r) < 0 && range.compareBoundaryPoints(Range.START_TO_END, r) > 0) { if (start < 0) start = w.index; end = w.index + w[0].length; } }
      if (start >= 0) out.push({blockId: 'b' + bi, start, end});
    });
    return out.length ? out : null;
  }
  /* a voice for the explanation language: the current one if it fits, else the stored/installed local voice, else a system voice; null = text only */
  tutorVoice(lang) {
    if (!this.catalog.length) this.buildCatalog();
    const b = base(lang), usable = r => r && (r.kind === 'system' || r.kind === 'neural' && this.installed.has(r.id));
    const entries = [...this.voiceMap].filter(([, r]) => base(r.lang) === b), stored = Object.entries(this.settings.voices || {}).filter(([k]) => base(k) === b).map(([, id]) => id);
    const r = base(this.voice?.lang) === b && usable(this.voice) ? this.voice : (entries.find(([id, v]) => stored.includes(id) && usable(v)) || entries.find(([, v]) => v.kind === 'neural' && !v.model?.experimental && this.installed.has(v.id)) || entries.find(([, v]) => v.kind === 'system'))?.[1];
    if (!r) return null;
    return {voice: r, spec: r.kind === 'neural' ? {kind: 'neural', id: r.id, lang: r.lang, ...(r.model?.experimental ? {experimental: true} : {})} : {kind: 'system', id: r.id || 'default', lang: r.lang || b}};
  }
  async tutorPipeline(v) { if (v.voice.kind !== 'neural') return new SpeechPipeline(); await api.runtime.sendMessage({t: 'ensureHost'}).catch(() => {}); return new RemotePipeline({port: api.runtime.connect({name: PIPE_PORT})}); }
  /* Marks a word and tells the follow zone which block it belongs to (paragraph/section jump rules). */
  markAt(chunk, word) { if (this.suspended) return null; this.options.onMark?.(chunk, word); if(this.explainUi||this.settings.focusMotion)this.ensureExplain().setActiveBlock('b'+this.chunks[chunk]?.block); return this.readingMarks?.markAt(chunk, word); }
  /* The user scrolled UP while following: following is off now (switch in the bar, saved setting), as in 1.6.24. */
  followOff() { this.settings.follow = false; this.highlight?.setFollow(false); this.version++; void this.save(); this.changed(); }
  onWord(chunk, word) {
    if (word == null) return;
    this.timelinePreview=null;this.position = {chunk, word}; this.markAt(chunk, word);
    if(this.state==='playing')void this.readingHistory?.heard(this.historyPosition());
    this.marks = (this.marks || 0) + 1;
    if (this.marks % 8 === 0) void this.savePosition(false);
    /* "Heard" / "Remaining" and the timeline thumb follow the word, not only the section: without this the bar repainted them only at a
       section change (0:12 for 15 s, then 0:27). Once a second at most: a full bar update costs a few milliseconds. */
    if (this.state === 'playing') { const now = Date.now(); if (now - (this.timeShownAt || 0) >= 1000) { this.timeShownAt = now; this.changed(); } }
  }
  /* After an extension reload/update the old content script keeps running in the open tab with a dead runtime (its world is not reused by the new injection, so the
     __notableSession guard does not see it). It must take its bar, mark layer and listeners with it instead of drawing a second copy next to the new session. */
  contextValid() { try { return !!api.runtime?.id; } catch { return false; } }
  tick() {
    if (this.destroyed) return;
    if (!this.contextValid()) { this.showUpdateNotice(); this.destroy(); return; }
    if (this.state !== 'playing' || this.pipelineKind !== 'neural') return;
    const p = this.interp.at(Date.now()); if (p) this.tracker.update(p);
  }
  /* A start that produces no pipeline event at all for 30 s (host gone, download stalled silently) must end in a visible, retryable error instead of an idle bar.
     Exception, measured in Firefox 159 (single-thread WASM, loaded machine): a seek during playback cannot interrupt the synthesis already running, so the new section
     waits behind it and the first event arrives only after 30-43 s although host and engine are fine. The limit therefore grows with the measured synthesis time of this
     engine (4x the median of the last five sections, at most 180 s); a host that does not answer at all still fails at 30 s. */
  armStart() {
    clearTimeout(this.startTimer); this.startTimer = 0;
    if (!this.starting) return;
    const armedAt = Date.now(), base = this.options.startTimeoutMs || 30000;
    this.startTimer = setTimeout(() => void this.startSilent(armedAt, base), base);
  }
  async hostSynthesisMs() {
    try { const r = await api.runtime.sendMessage({target: 'host', t: 'stats'}); return r?.ok && Array.isArray(r.stats) ? r.stats.filter(x => x.tier === 'near' && !x.background).slice(-5).map(x => x.ms).filter(Number.isFinite) : null; } catch { return null; }      // starts only: the look-ahead of the open bar (whole sections made in the background) must not stretch the start timeout
  }
  async startSilent(armedAt, base) {
    this.startTimer = 0; if (!this.starting) return;
    let allowed = base;
    if (this.pipelineKind === 'neural') {
      const times = await this.hostSynthesisMs();
      if (times) { const sorted = [...times].sort((x, y) => x - y), median = sorted.length ? sorted[sorted.length >> 1] : 0; allowed = Math.min(180000, Math.max(base, 4 * median, !sorted.length && this.caps?.threads === false ? 2 * base : 0)); }
      if (!this.starting || this.startTimer) return;            // an event arrived while the host answered: armStart() took over again
    }
    const waited = Date.now() - armedAt;
    if (waited < allowed) { this.startTimer = setTimeout(() => void this.startSilent(armedAt, base), allowed - waited); return; }
    this.starting = false; this.disposePipeline(); this.state = 'idle'; this.errorClass = 'start_timeout'; this.fail('reader_error');
  }
  async savePosition(force) {const at=this.historyPosition(),checkpoint=force?this.readingHistory?.checkpoint(at,{completed:this.state==='ended'&&!this.readScope}):null;if (this.fingerprint && this.chunks.length) await this.resume.save(this.fingerprint, at, {force}).catch(() => {});await checkpoint;}
  /* -- commands -------------------------------------------------------------------------------------------------------------------------- */
  async play(chunk = this.position.chunk, word = undefined) {
    if (!this.chunks.length) this.rescan(true);                    // content may have arrived since the last scan
    if (!this.chunks.length) { this.errorParams = null; return this.fail('no_readable_text'); }
    // the card's download starts reading by itself when it is done
    if (this.voiceCard?.downloading || this.download && this.download.modelId === this.voice?.id) return;
    this.voiceCard = null;
    const intent=this.playIntent=(this.playIntent||0)+1,stale=()=>this.destroyed||this.playIntent!==intent;
    /* First start on a capable device: the better voice is offered on the card, never loaded without a click.
       Offline the offer is passed over (a download could only fail). */
    if (this.offer && this.voice?.model?.id !== this.offer.id && globalThis.navigator?.onLine !== false) {
      if (this.options.acceptVoiceOffer === true) {
        await this.downloadVoice(this.offer.id);
        if (!this.installed.has(this.offer.id)) return;
      } else if (this.options.autoConfirmDownload !== true) return this.askVoice({chunk, word}, MODELS[this.offer.id]);
    }
    if (this.voice?.kind === 'neural' && await this.gpuBlocked(this.voice.model)) return;
    if (this.voice?.kind === 'neural' && !this.installed.has(this.voice.id)) {
      /* The list may be empty or old (cold host, see refreshInstalled): ask the host BEFORE a download is offered. A voice the host lists, or one this session already played, never gets the download question;
         a host that does not answer gets an error, not a false "download 28 MB". */
      await api.runtime.sendMessage({t: 'ensureHost'}).catch(() => {});
      const known = await this.refreshInstalled(12000);
      if (known) { this.buildCatalog(); this.pickVoice(); this.changed(); }
      if(stale())return;
      if (!this.voice || this.voice.kind !== 'neural') return this.play(chunk, word);
      if (!this.installed.has(this.voice.id) && !this.usedModels.has(this.voice.id)) {
        if (!known) { this.errorClass = 'HostUnreachable: voice list'; return this.fail('reader_error'); }
        if (!(await this.needModel(this.voice.model, false, {chunk, word}))) return;
      }
    }
    if(stale())return;
    this.busy = true; this.starting = true; this.wantPause = false; this.seekedAway = false; this.state='loading';this.changed(); this.armStart();
    try {
      const claim=await api.runtime.sendMessage({t:'claimAudio',generation:this.generation});if(stale())return;if(claim?.ok!==true)throw new Error('audio_owner_unavailable');
      if(this.wantPause)return;
      await this.readingHistory?.prepare();
      if(stale()||this.wantPause)return;
      const pipeline = await this.ensurePipeline();
      if(stale()||this.wantPause)return;
      pipeline.setRate?.(this.settings.speed); pipeline.setVolume?.(this.settings.muted ? 0 : this.settings.volume / 100); pipeline.setFx?.(this.fx());
      this.interp.setRate(this.settings.speed); this.interp.reset(); this.tracker.reset();
      this.seekFence=false;
      await pipeline.play({chunk, wordIndex: word, rate: this.settings.speed, volume: this.settings.muted ? 0 : this.settings.volume / 100});
      if(stale())return;
      if (this.voice?.kind === 'neural') this.usedModels.add(this.voice.id);      // the host synthesized with it: never ask to download it again, whatever the list says later
    } catch (error) { if(!stale()){this.errorClass = [error?.name, String(error?.message || '').slice(0, 80)].join(': '); this.fail('reader_error'); this.starting = false;} } finally { if(!stale()){this.busy = false;this.seekFence=false;}this.changed(); }
  }
  /* Experimental voices need WebGPU (and WebAssembly-JSPI). The host reports both once; `null` caps = not asked yet = do not block (Firefox: never offered, see IS_FIREFOX). Returns the status key that names the cause, or ''. */
  gpuProblem(model) { if (!model?.needs?.webgpu) return ''; if (IS_FIREFOX) return 'jspi_missing'; if (!this.caps) return ''; return this.caps.jspi === false ? 'jspi_missing' : this.caps.webgpu === false ? 'gpu_missing' : ''; }
  /* Same check, but "no WebGPU" is never taken from the answer of the first seconds: the GPU process may not have been ready when the page asked the host the first time
     (the host asks again on every listing, the page only kept that first answer), so a voice that needs WebGPU asks the host once more, fresh, before it refuses.
     Returns the status key of the cause (and shows it), or '' when the voice may start. */
  async gpuBlocked(model) {
    let problem = this.gpuProblem(model); if (!problem) return '';
    if (problem === 'gpu_missing') { await this.refreshInstalled(4000, {fresh: true}); this.buildCatalog(); problem = this.gpuProblem(model); if (!problem) { if (Object.values(GPU_STATUS).includes(this.lastError)) this.lastError = ''; this.changed(); return ''; } }
    this.fail(problem); return problem;
  }
  /* A voice that is not on the device: an explicit click (row arrow, card button) downloads it, Play only asks. */
  async needModel(model, explicit = false, at = this.position) {
    if (await this.gpuBlocked(model)) return false;      // checked BEFORE the download is offered: no gigabytes for a voice that cannot run here
    if (!explicit && this.options.autoConfirmDownload !== true) return this.askVoice(at, model);
    await api.runtime.sendMessage({t: 'ensureHost'});
    const pipeline = await this.ensurePipeline();
    this.download = {modelId: model.id, loaded: 0, total: modelBytes(model), phase: 'download'}; this.changed();
    const abort = this.downloadAbort = new AbortController();
    try {
      if (pipeline.closed) throw Object.assign(new Error('download'), {reason: 'interrupted'});
      await pipeline.ensureModel(model.id);
      await this.downloadEnd(pipeline, model.id, abort.signal);
    } catch (error) {
      this.download = null;
      if (this.cancelRequested !== model.id) {
        this.errorParams = {mb: mbOf(model)};
        this.fail(this.failureKey(error?.reason ?? error?.code) || 'prepare_failed');
      }
    } finally { if (this.downloadAbort === abort) this.downloadAbort = null; }
    await this.refreshInstalled(); this.buildCatalog(); this.pickVoice();
    return this.installed.has(model.id);
  }
  /* Waits for the end of one download. It also ends when its pipeline is disposed (new chunk list, other voice,
     reading rules) or the host goes away: a waiter that only listened for download events kept "preparing" for ever. */
  downloadEnd(pipeline, modelId, signal) {
    return new Promise((resolve, reject) => {
      const failure = reason => Object.assign(new Error('download'), {reason});
      const end = (settle, value) => {
        pipeline.removeEventListener('download', onDownload); pipeline.removeEventListener('state', onState);
        signal.removeEventListener('abort', onAbort); settle(value);
      };
      const onDownload = e => {
        if (e.detail?.modelId !== modelId) return;
        if (e.detail.phase === 'ready') end(resolve);
        else if (e.detail.phase === 'error') end(reject, failure(e.detail.reason));
      };
      const onState = e => {
        if (e.detail?.state === 'error' && e.detail.code === 'host-lost') end(reject, failure('interrupted'));
      };
      const onAbort = () => end(reject, failure('interrupted'));
      if (signal.aborted) { reject(failure('interrupted')); return; }
      pipeline.addEventListener('download', onDownload); pipeline.addEventListener('state', onState);
      signal.addEventListener('abort', onAbort);
    });
  }
  /* Download/engine failure -> status key. No network at all wins over every other reason. */
  failureKey(reason) {
    if (reason === 'offline' || globalThis.navigator?.onLine === false) return 'offline_download';
    return errorKey(reason);
  }
  offlineMissingModel() { return globalThis.navigator?.onLine === false && this.voice?.kind === 'neural' && !this.installed.has(this.voice.id); }
  fail(message) { this.lastError = message; this.changed(); }
  async toggle() {
    if (this.state === 'playing') { await this.pause(); return; }
    if (this.state === 'loading' || this.busy && this.state !== 'paused') {     // pause/resume intent while a section is still being prepared
      this.wantPause = !this.wantPause; if (this.wantPause) this.pipeline?.pause();
      if (!this.wantPause && this.seekedAway) { await this.play(this.position.chunk, this.position.word); return; }       // Play after a jump made while paused: start at the place that was chosen
      this.changed(); return;
    }
    /* Pause -> jump (time axis, click, section buttons) -> Play: the pipeline still holds the OLD place (its audio is paused there); resuming it would play from there and pull the mark back.
       A jump made while paused is remembered (seekedAway) and Play starts a fresh read at the chosen place instead. */
    if (this.state === 'paused' && this.pipeline && !this.seekedAway) { await this.pipeline.resume(); return; }
    if (this.state === 'paused' && this.seekedAway) { await this.play(this.position.chunk, this.position.word); return; }
    const saved = this.state === 'ended' || this.seekedAway ? null : await this.resume.get(this.fingerprint).catch(() => null);
    if(!saved&&!this.seekedAway&&this.state!=='ended'&&this.position.chunk===0&&this.position.word===0)await this.restore();
    const from = this.position.chunk > 0 || this.position.word > 0 ? this.position : saved || this.position;
    await this.play(from.chunk, from.word);
  }
  async pause() {
    const preparing=this.busy||this.starting||this.state==='loading';
    if(preparing){this.playIntent=(this.playIntent||0)+1;this.busy=false;this.starting=false;this.seekFence=false;this.wantPause=false;clearTimeout(this.startTimer);}
    this.pipeline?.pause();if(preparing){this.state='paused';this.changed();}await this.savePosition(true);
  }
  stop() { void this.checkpointReadingHistory(); this.seekFence=false;this.playIntent=(this.playIntent||0)+1;this.busy=false;this.wantPause = false; this.starting = false; clearTimeout(this.startTimer); this.pipeline?.stop(); this.highlight?.clear(); this.state = 'idle'; this.changed(); }
  async seekTo(chunk, word, startIfIdle, {fraction}={}) {
    if (this.externalBusy || !this.chunks.length || !Number.isInteger(chunk)) return;
    const active=!this.wantPause&&(this.state==='playing'||this.state==='loading'||this.starting||this.busy);
    chunk=Math.max(0,Math.min(chunk,this.chunks.length-1));word=Math.max(0,Math.min(Number.isInteger(word)?word:0,Math.max(0,this.chunks[chunk].words.length-1)));
    this.playIntent=(this.playIntent||0)+1;this.seekFence=true;this.pipeline?.pause();this.interp.reset();this.tracker.reset();
    this.position={chunk,word};this.timelinePreview=Number.isFinite(fraction)?{chunk,word,fraction}:null;if(this.voiceCard)this.voiceCard.at={chunk,word};
    this.markAt(chunk,word);this.changed();
    if(active||startIfIdle){await this.play(chunk,word);}
    else {this.seekFence=false;this.seekedAway=true;this.wantPause=false;this.busy=false;this.starting=false;clearTimeout(this.startTimer);if(this.state==='loading'||this.state==='ended')this.state='paused';this.changed();void this.savePosition(true);}
  }
  async restartVisible() {
    let index = 0; for (let i = 0; i < this.chunks.length; i++) { const r = this.highlight.wordRange(i, 0); if (r) { const b = r.getBoundingClientRect(); if (b.bottom > 0 && b.top < innerHeight - 120) { index = i; break; } } }
    this.pipeline?.pause(); await this.play(index, 0);
  }
  /* a part of the page (selection, drawn area): opened at its start, paused; play = an explicit listen action (the listen button beside a selection, or the bar already open) */
  async readScoped(scope,{play=false}={}) {
    this.readScope=scope;await this.setDocument();this.setVisible(true,false);
    if(!this.chunks.length){this.workflowNotice(this.text('no_readable_text'));return;}
    if(play)return this.play(0,0);
    this.position={chunk:0,word:0};return this.openReady();
  }
  /* the bar is open on a readable text (a second "Read" plays) */
  barOpen() { return this.visible === true && this.chunks.length > 0 && !this.areaPending; }
  /* opened, not playing: the place it will read from is marked, Play starts exactly there (not at an older remembered place) */
  openReady() { if (!this.chunks.length) return; this.seekedAway = true; this.markAt(this.position.chunk, this.position.word); this.changed(); }
  workflowNotice(text) {
    const shadow=this.surface?.shadow;if(!shadow)return;
    let note=shadow.querySelector('.workflow-note');if(!note){note=document.createElement('p');note.className='workflow-note';note.setAttribute('role','status');note.style.cssText='padding:8px 12px;margin:0;background:var(--reader-paper);color:var(--reader-ink);font:13px system-ui;border-radius:8px;max-width:480px';shadow.append(note);}
    note.textContent=text;clearTimeout(this.workflowNoticeTimer);this.workflowNoticeTimer=setTimeout(()=>note.remove(),8000);
  }
  async captureScope(scope) {
    const visible=this.visible;this.areaPending=true;this.setVisible(false,false);this.quickActions?.setEnabled(false);await this.pause();
    try {
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const r=scope.rect,reply=await api.runtime.sendMessage({t:'captureArea',generation:this.generation,rect:{left:r.left,top:r.top,width:r.width??r.right-r.left,height:r.height??r.bottom-r.top,viewportWidth:innerWidth,viewportHeight:innerHeight}});
      if(!reply?.ok){this.setVisible(true,false);this.workflowNotice(uiText(this.locales,this.settings.uiLanguage,'prepare_failed'));}
      return reply;
    } finally {this.areaPending=false;this.quickActions?.setEnabled(this.settings.reading.quickActions===true);if(visible)this.setVisible(true,false);else this.syncActivity();}
  }
  async continueChapter() {
    const url=chapterTarget(this.chapterRecipe);
    if(!url){this.chapterRecipe=null;void api.runtime.sendMessage({t:'cancelChapter'});this.workflowNotice((WORKFLOW_TEXT[this.settings.uiLanguage]||WORKFLOW_TEXT.en).missing);return;}
    const r=await api.runtime.sendMessage({t:'continueChapter',url});if(!r?.ok)this.chapterRecipe=null;
  }
  /* -- export ------------------------------------------------------------------------------------------------------------------ */

  documentText() {
    const parts = [], chapters = []; let offset = 0;
    this.blocks.forEach(b => { for (const h of b.headings || []) chapters.push({label: h.label, level: h.level, charStart: offset + h.charStart}); parts.push(b.text); offset += b.text.length + 2; });
    return {text: parts.join('\n\n'), chapters};
  }
  /* The view that runs the export itself (file view) reports its job here; same shape the bar shows for a job in another tab. */
  setJob(value) { const fresh = value.state === 'idle' || value.state === 'running' && this.exportState.state !== 'running'; this.exportState = fresh ? {phase: value.state === 'running' ? 'preparing' : '', ...value} : {...this.exportState, ...value}; this.changed(); this.options.onJob?.(this.exportState); }
  setBusy(value) { this.externalBusy = value; this.changed(); }
  setExportState(state, ms = 0) { this.exportState = state; this.changed(); if (ms) setTimeout(() => { if (this.exportState === state) { this.exportState = {state: 'idle', kind: state.kind}; this.changed(); } }, ms); }
  /* The job itself runs in the extension's reader tab; it reports back here (token minted by the worker for exactly this export) so the bar shows progress, Cancel and "Done" work. */
  exportJobUpdate(m, sender) {
    if (sender?.id !== api.runtime.id || !this.exportToken || m.token !== this.exportToken || !m.job || typeof m.job !== 'object') return false;
    const j = m.job, state = ['idle', 'running', 'complete', 'cancelled', 'locked', 'error'].includes(j.state) ? j.state : 'idle', num = (v, max) => Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
    clearTimeout(this.exportWatch);
    const next = {state, kind: j.kind === 'document' ? 'document' : 'audio', percent: num(j.percent, 100), completedChunks: num(j.completedChunks, 1e7), totalChunks: num(j.totalChunks, 1e7), filename: String(j.filename || '').split(/[\\/]/).at(-1).slice(0, 200), resultReady: j.resultReady === true, errorKey: ['export_failed', 'export_no_voice'].includes(j.errorKey) ? j.errorKey : ''};
    this.setExportState(state === 'idle' ? {state: 'idle', kind: next.kind} : next, ['cancelled', 'error', 'locked'].includes(state) ? 8000 : 0);
    // a reader tab that vanished without a word (crash, forced close) must not leave the bar locked in "running"
    if (state === 'running') this.exportWatch = setTimeout(() => { if (this.exportState.state === 'running') { this.setExportState({state: 'idle', kind: next.kind}); } }, 120000);
    return true;
  }
  /* Cancel / "Done" from the bar go to the reader tab that owns the job. If it is gone, the bar falls back to idle instead of pretending. */
  async exportControl(command) {
    let reply = null;
    if (this.exportToken) { try { reply = await api.runtime.sendMessage({t: 'exportCommand', token: this.exportToken, command}); } catch {} }
    const kind = this.exportState.kind || 'audio';
    if (!reply?.ok) { clearTimeout(this.exportWatch); this.exportToken = null; this.setExportState(command === 'cancel' ? {state: 'cancelled', kind} : {state: 'idle', kind}, command === 'cancel' ? 8000 : 0); }
  }
  /* Download ranges (round 3): the whole text, from the reading place (start of the current word) or the selected words. Same text map as reading:
     block texts joined by a blank line, chapters shifted with the slice; the selection uses the words the selection touches (no DOM text). */
  exportRequest(value) {
    const request = typeof value === 'string' ? {format: value, range: 'all'} : value && typeof value === 'object' ? {format: value.format, range: value.range || 'all'} : null;
    if (!request || !['mp3', 'wav', 'pdf', 'html'].includes(request.format) || !['all', 'here', 'selection'].includes(request.range)) return null;
    return {...request, kind: ['mp3', 'wav'].includes(request.format) ? 'audio' : 'document'};
  }
  exportText(range) {
    const all = this.documentText();
    if (range === 'all') return all;
    if (range === 'here') {
      const start = this.charOfPosition(); if (!(start > 0) || start >= all.text.length) return null;
      const before = all.chapters.filter(c => c.charStart <= start).at(-1), chapters = all.chapters.filter(c => c.charStart >= start).map(c => ({...c, charStart: c.charStart - start}));
      if (before && !chapters.some(c => c.charStart === 0)) chapters.unshift({...before, charStart: 0});
      return {text: all.text.slice(start), chapters, startChunk: this.position.chunk};
    }
    const text = this.selectionText(this.exportSelection); return text ? {text, chapters: []} : null;
  }
  exportCharsAll() { if (this.exportCharsFor !== this.blocks) { this.exportCharsFor = this.blocks; this.exportCharsTotal = this.blocks.reduce((n, b, i) => n + b.text.length + (i ? 2 : 0), 0); } return this.exportCharsTotal; }
  exportRanges() { const all = this.exportCharsAll(), here = this.position.chunk > 0 || this.position.word > 0 ? Math.max(0, all - this.charOfPosition()) : 0; return {all, here, selection: this.exportSelection ? this.exportSelectionChars || 0 : 0}; }
  /* the selected words of the blocks a selection range touches */
  selectionText(range) {
    if (!range || !this.blocks.length) return '';
    const parts = [];
    try {
      this.blocks.forEach((b, bi) => {
        const el = this.blockEls?.[bi]; if (!el || !range.intersectsNode(el)) return;
        const m = createRangeMapper(this.textNodes[bi] || [], b.text); let start = -1, end = -1;
        for (const w of b.text.matchAll(/\S+/gu)) { const r = m.range(w.index, w.index + w[0].length); if (r && range.compareBoundaryPoints(Range.END_TO_START, r) < 0 && range.compareBoundaryPoints(Range.START_TO_END, r) > 0) { if (start < 0) start = w.index; end = w.index + w[0].length; } }
        if (start >= 0) parts.push(b.text.slice(start, end));
      });
    } catch { return ''; }
    /* the selected text when the reading map does not cover it (text changed since it was read, filtered blocks): a selection is still a selection */
    return parts.length ? parts.join('\n\n') : String(range.toString?.() || '').replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  }
  /* The page selection survives a click into the bar (which would collapse it): it is kept from the last selection change outside the bar and
     dropped by the next click on the page. Only its length goes into the bar state. */
  watchExportSelection() {
    if (this.exportSelectionWatch || !this.surface?.host) return;
    const host = this.surface.host, live = () => { const sel = document.getSelection(); if (!sel?.rangeCount || sel.isCollapsed) return null; const range = sel.getRangeAt(0); return host.contains(range.commonAncestorContainer) ? null : range.cloneRange(); };
    const store = range => { const before = this.exportSelection ? this.exportSelectionChars : 0; this.exportSelection = range; this.exportSelectionChars = range ? this.selectionText(range).length : 0; if (!range) this.exportSelection = null; if ((this.exportSelection ? this.exportSelectionChars : 0) !== before) this.changed(); };
    let frame = 0;
    const onChange = () => { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; const range = live(); if (range) store(range); }); };
    const onPointer = event => { if (event.composedPath().includes(host)) { const range = live(); if (range) store(range); } else if (this.exportSelection) store(null); };
    document.addEventListener('selectionchange', onChange); document.addEventListener('pointerdown', onPointer, true);
    this.exportSelectionWatch = () => { cancelAnimationFrame(frame); document.removeEventListener('selectionchange', onChange); document.removeEventListener('pointerdown', onPointer, true); };
  }
  /* The bar's download menu: the export itself runs in the extension (worker + reader page), nothing leaves the device. */
  async exportDocument(value) {
    const request = this.exportRequest(value); if (!request || !this.chunks.length) return;
    const {format, kind, range} = request;
    if (this.exportState.state === 'running') return;
    /* Round 4 (owner request): the file is made in the engine host and saved by the browser; this page stays where it is. HTML = this page as it
       looks now (Night mode and typography included, without the bar); PDF and audio = the reading text of the range. */
    let payload;
    if (format === 'html') {
      if (range === 'selection' && !this.exportSelection) return;
      const at = this.chunks[this.position.chunk]?.block ?? 0;
      payload = {html: pageSnapshot({document, range, beforeElements: range === 'here' ? (this.blockEls || []).slice(0, at).filter(Boolean) : [], selection: range === 'selection' ? this.exportSelection : null})};
    } else {
      const doc = this.exportText(range); if (!doc?.text?.trim()) return;
      payload = {doc: {text: doc.text, chapters: doc.chapters, title: this.title, language: this.pageLang}};
      if (kind === 'audio') {
        const ref = this.voiceMap.get(this.voiceId), lang = base(this.pageLang || this.lang), usable = v => v?.kind === 'neural' && !v.model?.experimental && this.installed.has(v.id);
        const voice = usable(ref) && base(ref.lang) === lang ? ref : [...this.voiceMap.values()].find(v => usable(v) && base(v.lang) === lang) || (usable(ref) ? ref : null);
        if (!voice) { this.setExportState({state: 'error', kind, errorKey: 'export_no_voice'}, 12000); return; }
        payload.modelId = voice.id;
      } else payload.appearance = {...(this.appearanceDefaults || {}), ...(this.settings.appearance || {})};
    }
    await this.pause();
    /* the job's token exists before the request: a short job (HTML) may report "done" before the answer to this request arrives */
    const token = crypto.randomUUID(); this.exportToken = token; this.exportJobUpdate({token, job: {state: 'running', kind, percent: 0}}, {id: api.runtime.id});
    try {
      const reply = await api.runtime.sendMessage({t: 'hostExport', generation: this.generation, token, format, title: this.title, lang: this.pageLang, reading: this.settings.reading, normalize: this.settings.normalizeSpeech !== false, ...payload});
      if (reply?.ok) { if (reply.token && reply.token !== token) { this.exportToken = reply.token; this.exportJobUpdate({token: reply.token, job: {state: 'running', kind, percent: 0}}, {id: api.runtime.id}); } return; }   // Firefox's reader-tab route mints its own token
      this.setExportState({state: 'error', kind, errorKey: 'export_failed'}, 8000);
    } catch { this.setExportState({state: 'error', kind, errorKey: 'export_failed'}, 8000); }
  }
  /* Focus reading view = the reader page's focus mode with this page's text (no second implementation of the view). */
  async openFocus() {
    if (!this.chunks.length) return;
    await this.pause();
    try { const reply = await api.runtime.sendMessage({t: 'openFocus',generation:this.generation, doc: {...this.documentText(), title: this.title, language: this.pageLang, charStart: this.charOfPosition()}}); if (!reply?.ok) this.fail('prepare_failed'); } catch { this.fail('prepare_failed'); }
  }
  /* Reading place <-> offset in documentText() (blocks joined by a blank line): the reader tab starts where this page stopped and hands its place back when it closes. */
  blockBases() { const bases = []; let offset = 0; for (const b of this.blocks) { bases.push(Number.isSafeInteger(b.base) ? b.base : offset); offset += b.text.length + 2; } return bases; }
  timeline() { if(this.timelineChunks!==this.chunks){this.timelineChunks=this.chunks;this.timelineMap=createTimelineMap(this.chunks);}return this.timelineMap; }
  charOfPosition() {const c=this.chunks[this.position.chunk];return c?this.charOfChunk(this.position.chunk)+(this.timeline().offsetsFor(this.position.chunk)?.[this.position.word]?.start||0):0;}
  charOfChunk(index) { const c = this.chunks[index]; return c ? this.blockBases()[c.block] + c.start : 0; }
  positionAtChar(char) {const chunk=this.chunkOfChar(char),offsets=this.timeline().offsetsFor(chunk)||[];let word=0;for(let i=0;i<offsets.length;i++)if(offsets[i].start<=char-this.charOfChunk(chunk))word=i;return {chunk,word};}
  chunkOfChar(char) { const bases = this.blockBases(); let found = 0; for (let i = 0; i < this.chunks.length; i++) { const c = this.chunks[i]; if (bases[c.block] + c.start + c.text.length > char) { found = i; break; } found = i; } return found; }
  /* Keyboard navigation: paragraph (block), chapter and +-seconds. "Back" first returns to the start of the current paragraph/chapter, a second press (or a press near the start) goes to the previous one. Seconds use the same 14 characters per second at speed 1 as metrics(). */
  navigate(command, value) {
    const n = this.chunks.length; if (!n) return;
    const cur = this.position.chunk, word = this.position.word, chunks = this.chunks, startOf = i => { while (i > 0 && chunks[i].block === chunks[i - 1].block) i--; return i; };
    let index = null;
    if (command === 'nextBlock') { let j = cur + 1; while (j < n && chunks[j].block === chunks[cur].block) j++; if (j < n) index = j; }
    else if (command === 'previousBlock') { const s = startOf(cur); index = s < cur || word >= 4 || s === 0 ? s : startOf(s - 1); }
    else if (command === 'nextChapter') index = this.chapters.find(c => c.sectionIndex > cur)?.sectionIndex ?? null;
    else if (command === 'previousChapter') { const i = this.chapters.reduce((sel, c, k) => c.sectionIndex <= cur ? k : sel, -1); if (i >= 0) { const c = this.chapters[i]; index = c.sectionIndex < cur || word >= 4 || i === 0 ? c.sectionIndex : this.chapters[i - 1].sectionIndex; } else if (this.chapters.length) index = 0; }
    else if (command === 'seekRelative' && Number.isFinite(value)) {
      const axis=this.timeline(),at=axis.atChar(axis.charAt(this.position)+value*14*Math.max(.5,this.settings.speed));
      return this.seekTo(at.chunk,at.word,false);
    }
    if (Number.isInteger(index)) return this.seekTo(index, 0, false);
  }
  async command(command, value) {
    this.userMoveAt = Date.now();      // a stop right after a command (seek, jump, Play) is the command's own loading, never a sign of a slow device
    this.noteActivity?.();      // every control of the bar (a slider dragged in its menus included) is the user working: background look-ahead waits a moment
    /* a running guided explanation owns Play/Pause, Previous/Next and Stop of the bar (and their shortcuts) */
    if (this.tutor?.owns && TUTOR_COMMANDS[command]) return this.tutor[TUTOR_COMMANDS[command]]();
    if (this.tutor?.owns && command === 'seekProgress' && Number.isFinite(value)) return this.tutor.seek(value);   // the timeline shows the tour: a click jumps to its step
    if (this.tutor?.owns && command === 'seekSection' && Number.isInteger(value)) return this.tutor.jump(value);
    if (this.busy && !['stop', 'toggle', 'cancelExport', 'downloadResult', 'seekProgress', 'seekChar', 'seekRelative', 'seekSection', 'seekChapter', 'previousSection', 'nextSection'].includes(command)) return;
    if (this.externalBusy && !['stop', 'cancelExport', 'downloadResult'].includes(command)) return;
    if ((command === 'export' || command === 'exportDocument') && (this.options.handlers?.export || this.options.handlers?.exportDocument)) { const request = this.exportRequest(command === 'exportDocument' && typeof value === 'string' ? value : value); if (!request) return; const doc = request.range === 'all' ? null : this.exportText(request.range); if (request.range !== 'all' && !doc?.text?.trim()) return; return this.options.handlers[request.kind === 'audio' ? 'export' : 'exportDocument']?.({...request, ...(doc ? {doc} : {})}); }
    const handler = this.options.handlers?.[command]; if (handler) return handler(value);       // the view that owns the text runs its own export / focus switch
    if (command === 'addBookmark') return this.addBookmark(typeof value==='string'?value:'');
    /* value 'open' (the popup's Summarize): a running tour is shown and a paused one goes on; it is never switched off from there (F21: after a paused tour
       the popup button ended it and nothing was visible). The bar button stays the toggle. */
    if (command === 'explainPage') { if (this.tutor?.active) { if (value !== 'open') return this.tutor.cancel(); this.setVisible(true, false); if (this.tutor.view()?.paused) this.tutor.toggle(); return; } this.setVisible(true, false); return this.ensureTutor().start(); }   // popup card, bar button, settings menu, file view: the guided explanation (explain/tutor.mjs); a toggle (round 4): a second press ends the running tour
    /* Opening the bar never starts the sound (owner request, round 3): "Read page" / "Read selection" open the bar at the place it will read from,
       paused; with the bar already open the same action plays (value.play: the workflow saw the bar open before it showed it; the automatic next
       chapter keeps reading on). */
    if (command === 'readPage') { const open=typeof value?.play==='boolean'?value.play:this.barOpen(); const at=this.readScope?{chunk:0,word:0}:{...this.position};this.readScope=null; await this.setDocument(at); this.setVisible(true,false); if(open)return this.play(this.position.chunk,this.position.word); return this.openReady(); }
    if (command === 'readSelection') {const selection=document.getSelection(); if(!selection?.rangeCount||selection.isCollapsed)throw new Error('selection_empty');return this.readScoped({range:selection.getRangeAt(0).cloneRange()},{play:typeof value?.play==='boolean'?value.play:this.barOpen()});}
    if (command === 'selectArea' || command === 'captureArea') {this.areaPending=true;this.setVisible(false,false);return this.ensureQuickActions()?.startAreaSelection({mode:command==='captureArea'?'ocr':'read'});}
    if (command === 'openDownload') { this.setVisible(true, false); this.surface?.openDownload(true); return; }   // popup "Create audiobook": the bar's own download menu (round 3)
    if (command === 'openSettings') {this.setVisible(true,false);const toggle=this.surface?.shadow.querySelector('.settingsToggle');if(toggle?.getAttribute('aria-expanded')!=='true')toggle?.click();return;}
    if (command === 'pickNextChapter') {this.pickChapterCleanup?.();this.pickChapterCleanup=pickChapter({language:this.settings.uiLanguage,onPick:recipe=>{this.chapterRecipe=recipe;void api.runtime.sendMessage({t:'saveChapter',recipe});this.workflowNotice((WORKFLOW_TEXT[this.settings.uiLanguage]||WORKFLOW_TEXT.en).enabled);}});return;}
    if (command === 'cancelNextChapter') {this.chapterRecipe=null;return api.runtime.sendMessage({t:'cancelChapter'});}
    if (command === 'openFocus') return this.openFocus();
    if (command === 'seekChar') { if(!Number.isSafeInteger(value)||value<0||!this.chunks.length)return;const chunk=this.chunkOfChar(value),word=this.timeline().offsetsFor(chunk);let index=0;for(let i=0;i<(word?.length||0);i++){if(word[i].start<=value-this.charOfChunk(chunk))index=i;else break;}return this.seekTo(chunk,index,false); }   // from the worker only: the reader tab gives the place back
    if (command === 'export') return this.exportDocument(value);
    if (command === 'exportDocument') return this.exportDocument(value);
    if (command === 'cancelExport') return this.exportControl('cancel');
    if (command === 'downloadResult') return this.exportControl('download');
    if (command === 'removeVoice') return this.removeVoice(value);
    if (command === 'cancelDownload') return this.cancelDownload(value);
    if (command === 'voiceCardGet') return this.takeVoice(value);
    if (command === 'voiceCardClose') return this.closeVoiceCard(false);
    if (command === 'voiceCardKeep') return this.closeVoiceCard(true);
    if (command === 'downloadVoice') { void this.downloadVoice(value); return; }   // runs for minutes: the control call must not wait for it
    if (command === 'toggle') { if (!this.visible && this.state !== 'playing' && this.state !== 'loading') { this.setVisible(true, false); return; } return this.toggle(); }   // Play with no bar open (popup, global shortcut) only opens it; the next Play plays
    if (command === 'stop') {this.chapterRecipe=null;this.voiceCard=null;void api.runtime.sendMessage({t:'cancelChapter'}).catch(()=>{});return this.stop();}
    if (command === 'restart') return this.restartVisible();
    if (['previousBlock', 'nextBlock', 'previousChapter', 'nextChapter', 'seekRelative'].includes(command)) return this.navigate(command, value);
    if(command==='seekProgress'){if(!Number.isFinite(value))return;const at=this.timeline().atFraction(value);if(at)return this.seekTo(at.chunk,at.word,false,{fraction:Math.max(0,Math.min(1,value))});return;}
    if (['previousSection', 'nextSection', 'seekSection', 'seekChapter'].includes(command)) {
      const cur = this.position.chunk;
      const index = command === 'previousSection' ? cur - 1 : command === 'nextSection' ? cur + 1 : command === 'seekChapter' ? this.chapters[value]?.sectionIndex : value;
      if (Number.isInteger(index)) return this.seekTo(index, 0, false);
      return;
    }
    if (command === 'setOverlayVisible') return this.setVisible(value === true, false);   // the popup's switch only moves the view: it never stops what is being read
    if (command === 'resetBar') { this.settings.bar = null; return this.save(); }
    if (command === 'toggleTheme') { const s = this.settings, mode = s.appearance?.mode || 'off', dark = mode === 'dark' || mode === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches; return this.applySettings({appearance: {...(this.appearanceDefaults || {}), ...(s.appearance || {}), mode: dark ? 'off' : 'dark'}}); }   // like 1.6.24 toggle_theme: dark goes back to the page's own palette, never to a forced light one
    if (command === 'config') return value && typeof value === 'object' ? this.applySettings(value) : undefined;   // many settings at once from the popup's file-tab route (validated by the file view's bridge)
    if (command === 'appearance') return this.applySettings({appearance: {...(this.appearanceDefaults || {}), ...(this.settings.appearance || {}), ...value}});
    if (['commaPause','sentencePause','paragraphPause'].includes(command)) { if (!Number.isFinite(value)) return; return this.applySettings({reading: {...this.settings.reading, [command]: value}}); }
    const map = {computePath:'computePath',explainScope:'explainScope',explainDepth:'explainDepth',explainLanguage:'explainLanguage',explainKeepMarks:'explainKeepMarks',overlayMode:'overlayMode',focusMotion:'focusMotion',clickSeek:'clickSeek',speed: 'speed', volume: 'volume', mute: 'muted', follow: 'follow', clickseek: 'clickSeek', language: 'language', uiLanguage: 'uiLanguage', formatLocale: 'formatLocale', timeFormat: 'timeFormat', playerTheme: 'playerTheme', autoShow: 'autoShow', pitch: 'pitch', bass: 'bass', treble: 'treble', sectionPause: 'sectionPause'};
    if (command === 'followPosition' || command === 'followMargin') { const n = Math.round(Number(value)), [lo, hi] = command === 'followPosition' ? [10, 90] : [5, 30]; return Number.isFinite(n) ? this.applySettings({[command]: Math.max(lo, Math.min(hi, n))}) : undefined; }       // the bar's three follow controls (height, band, jump rule) act on the follow zone again
    if (command === 'followMode') return ['paragraph', 'section', 'line'].includes(value) ? this.applySettings({followMode: value}) : undefined;
    if (command === 'voice') return this.applySettings({voice: {language: value.language, id: value.id}});
    if (map[command]) return this.applySettings({[map[command]]: value});
  }
  async applySettings(values, {external = false} = {}) {
    if (!external) this.noteActivity?.();      // a setting changed in the bar (a slider being dragged): the user works, background look-ahead waits a moment
    const s = this.settings, was = this.state, modeBefore = s.appearance?.mode || 'off';
    for (const [k, v] of Object.entries(values)) {
      if (k === 'voice') { const code = norm(v.language) || this.lang; s.voices = {...s.voices, [code]: v.id}; s.language = s.language === 'auto' ? 'auto' : s.language; const ref = this.voiceMap.get(v.id); if (ref && v.id === this.voiceId) { /* the voice in use, now chosen explicitly: stored, nothing to rebuild */ } else if (ref) { this.voiceId = v.id; this.voice = ref; this.voiceCard = null; if (VOICE_ERRORS.has(this.lastError)) this.lastError = ''; await this.voiceChanged(was); const problem = this.gpuProblem(ref.model); if (problem) this.lastError = problem; } }
      else if (k === 'language') { s.language = v; this.pickVoice(); await this.voiceChanged(was); }
      else if (k === 'volume') { s.volume = Math.max(0, Math.min(150, v)); if (v > 0) s.muted = false; this.pipeline?.setVolume(s.muted ? 0 : s.volume / 100); }
      else if (k === 'muted') { s.muted = v; this.pipeline?.setVolume(v ? 0 : s.volume / 100); }
      else if (k === 'speed') { s.speed = v; this.interp.setRate(v); this.pipeline?.setRate(v); }
      else if (k === 'pitch' || k === 'bass' || k === 'treble' || k === 'sectionPause') { if (!Number.isFinite(v)) continue; const [lo, hi] = k === 'pitch' ? [-6, 6] : k === 'sectionPause' ? [0, 3000] : [-10, 10]; s[k] = k === 'pitch' ? Math.round(Math.max(lo, Math.min(hi, v)) * 2) / 2 : Math.round(Math.max(lo, Math.min(hi, v)) / (k === 'sectionPause' ? 100 : 1)) * (k === 'sectionPause' ? 100 : 1); this.pipeline?.setFx?.(this.fx()); }
      else if (k === 'reading') {const next=cleanReading(v),before=cleanReading(s.reading),affects=['dictionary',...READING_FILTER_KEYS,'commaPause','sentencePause','paragraphPause'].some(key=>JSON.stringify(before[key])!==JSON.stringify(next[key]));s.reading=next;if(next.quickActions===true)this.ensureQuickActions();else if(this.suspended){this.quickActions?.destroy();this.quickActions=null;}this.quickActions?.setEnabled(next.quickActions===true);if(affects){const at={...this.position,char:this.charOfPosition()};this.disposePipeline();this.collect();this.readingMarks?.update({chunks:this.chunks,blocks:this.blocks,textNodes:this.textNodes},null);this.position=this.options.source?this.positionAtChar(at.char):{chunk:Math.min(at.chunk,Math.max(0,this.chunks.length-1)),word:0};this.state='idle';}this.extrasUi?.sync();}
      else if (k === 'online') continue;       // network voices are retired: config.mjs keeps the stored value false
      else if (k === 'uiLanguage') { s.uiLanguage = v; this.buildCatalog(); this.options.onUiLanguage?.(v); }
      else if (k === 'focusMotion') { s.focusMotion=v===true;this.ensureExplain().setActiveBlock('b'+this.chunks[this.position.chunk]?.block); }
      else if (k === 'follow') { s.follow = v; this.highlight?.setFollow(v); }
      else if (k === 'clickSeek') { s.clickSeek = v; this.highlight?.setClickSeek(v && !this.suspended); }
      else if (k === 'normalizeSpeech') { const next = v !== false; if (s.normalizeSpeech !== next) { s.normalizeSpeech = next; await this.voiceChanged(was); } }
      else if (k === 'computePath') { const next = ['auto', 'gpu', 'cpu'].includes(v) ? v : 'auto'; if (s.computePath !== next) { s.computePath = next; try { this.pipeline?.setCompute?.(next); } catch {} } }      // the host re-creates workers on the other runtime by itself; what is cached stays
      else if (k === 'markWord' || k === 'markTint' || k === 'markCorners') { s[k] = v; this.readingMarks?.apply(k, v, s); }
      else if (k === 'markStyle') { s.markStyle = cleanStyle(v); this.readingMarks?.apply('markStyle', s.markStyle, s); }
      else if (k === 'overlayTheme') { s.overlayTheme = cleanOverlayTheme(v); this.surface?.setOverlayColors(deriveBoth(s.overlayTheme)); }
      else if (k === 'keyboard') { s.keyboard = cleanKeyboard(v); this.surface?.keyboard?.setBindings(s.keyboard); }
      else if (k === 'voices') { const before = this.voiceId; s.voices = {...v}; this.pickVoice(); if (this.voiceId !== before) await this.voiceChanged(was); }   // a stored choice of the voice already in use changes nothing audible
      else if (k === 'markSection') { s.markTint = s.markCorners = v !== 'off'; this.readingMarks?.apply('markTint', s.markTint, s); }   // old API value (off | subtle | strong)
      else s[k] = v;
    }
    this.tutor?.settingsChanged(Object.keys(values));
    coupleTheme(s, Object.keys(values));   // overlay theme, page mode and the dark/light button are ONE state (config.mjs)
    const has = k => Object.hasOwn(values, k);
    this.version++; if (has('markWord') || has('markTint') || has('markCorners') || has('markStyle') || has('markSection') || has('uiLanguage') || has('keyboard') || has('playerTheme')) this.marksUi?.sync(); if (has('overlayTheme') || has('uiLanguage')) this.layoutUi?.sync(); if (has('keyboard') || has('uiLanguage') || has('voices')) this.extrasUi?.sync();
    if (modeBefore !== (s.appearance?.mode || 'off')) { clearTimeout(this.previewTimer); this.previewTimer = setTimeout(() => { if (!this.destroyed) this.marksUi?.sync(); }, 600); }   // the color preview measures the page: once more after a new page mode was drawn (a slider drag of the reading look does not rebuild it)
    if (!external) await this.save(); this.changed(); this.options.onSettings?.(values);
  }
  async voiceChanged(was) {
    if (!this.voice) return;
    const resume = was === 'playing' || was === 'loading' && !this.wantPause;
    if (this.pipeline) { this.pipeline.stop(); this.disposePipeline(); }
    if (resume) { const at = this.position; await this.play(at.chunk, at.word); } else { if (was === 'paused') this.seekedAway = true; this.prewarm(); }       // paused: the old voice's audio is gone, Play starts afresh at the paused place (not a resume of the new, empty pipeline, which would start at the section's first word)
  }
  /* The bar is open and the chosen voice is on the device: the host may load it and prepare the next sections silently,
     so the first Play starts sooner. Nothing is played or downloaded; the pipeline's prewarm checks memory and never
     evicts another voice. Opening a menu never gets here. */
  prewarm() {
    const voice = this.voice;
    if (this.destroyed || this.busy || !this.visible || voice?.kind !== 'neural') return;
    if (!this.installed.has(voice.id) || this.gpuProblem(voice.model) || !this.chunks.length || this.download) return;
    void (async () => {
      try {
        const pipeline = await this.ensurePipeline();
        if (!this.busy && this.visible) { pipeline.prewarm?.(this.position.chunk); pipeline.engage?.({chunk: this.position.chunk, word: this.position.word}); this.prepareTour(pipeline); }      // the open bar is an explicit use: the host prepares the page in the background (LocalPipeline.engage)
      } catch {}       // only an optimization: a failure changes nothing
    })();
  }
  /* The open bar also prepares the sentence the guided explanation starts with (key-sentence tour; explain/tutor.mjs firstStep) in the host cache, so a click
     on Zusammenfassen speaks it at once: measured 15.11.2026 (Thorsten high, four cores) the first step waited 0.6 s for a section being prepared and
     1.4 s for its own first piece. Cached audio of reading is untouched; an English tour (written by the model) is not prepared, nor a tour in another voice
     than reading's (its model would take the reading voice's worker). */
  prepareTour(pipeline) { try { const first = this.ensureTutor().firstStep?.(); if (first && first.voice.id === this.voice?.id) pipeline.precompute?.([{text: first.text, words: first.words}], {voice: first.voice, lang: first.lang, normalize: first.normalize, ahead: true}); } catch {} }
  async save() { const ring = this.written || (this.written = []); ring.push({text: JSON.stringify(this.settings), t: Date.now()}); if (ring.length > 12) ring.shift(); await api.storage.local.set({[SETTINGS_KEY]: this.settings}).catch(() => {}); }
  /* "Settings and reading places": back to the product defaults, saved places gone (file view privacy panel). */
  async clearData() {
    const s = this.settings; for (const k of Object.keys(s)) delete s[k]; Object.assign(s, defaults()); s.uiLanguage = this.locales.messages[base(navigator.language)] ? base(navigator.language) : 'en';
    this.explainUi?.setFocusEnabled(this.settings.focusMotion===true);
    this.resume = createResumePoints({storage: {get: async k => (await api.storage.local.get(k))[k], set: (k, v) => api.storage.local.set({[k]: v})}});
    await api.storage.local.remove(['resumePoints']).catch(() => {}); this.pickVoice(); this.buildCatalog(); this.version++; coupleTheme(s, []); await this.save(); this.refreshDerived(); this.changed();
  }
  /* After models were added or removed outside of a download (clear all): read the list again and re-pick. */
  async refreshVoices() { await this.refreshInstalled(); this.buildCatalog(); this.pickVoice(); this.changed(); }
  /* -- surface --------------------------------------------------------------------------------------------------------------------------- */
  mountBar() {
    const o = this.options, mount = o.mount || document.documentElement; this.appearance = o.appearanceController || null;
    if (!o.mount) for (const stale of document.querySelectorAll(ORPHAN_HOSTS)) stale.remove();   // left by an orphaned script of a reloaded extension (other isolated world, same DOM); this world has drawn nothing yet
    this.surface = mountPlayerSurface({mount, variant: 'overlay', locales: this.locales, initialLocale: base(this.settings.uiLanguage) || 'en', formattingFactory: createFormatting, ...(this.appearance ? {appearanceController: this.appearance} : {appearanceFactory: pageAppearance}),
      ownPage: o.ownPage, keyboardActions: o.keyboardActions || {}, onKeyboardChange: o.onKeyboardChange || (() => {}), onKeyboardSettings: v => void this.applySettings({keyboard: v}),
      onCommand: (c, v) => void this.command(c, v), onClose: () => this.setVisible(false), onLocalChange: (f, v) => { if (f === 'barPosition') { this.settings.bar = v; void this.save(); } }, onSelection: () => false});
    if(this.surface.host)this.surface.host.dataset.notableReaderOwner=api.runtime.id;
    this.watchExportSelection();
    this.appearanceDefaults = (() => { try { const probe = createAppearanceController({document, kind: 'html', contentRoot: document.createElement('div')}); const d = probe.defaults; probe.destroy?.(); return d; } catch { return null; } })();
    const tr = (key, params) => uiText(this.locales, base(this.settings.uiLanguage) || 'en', key, params);
    this.marksUi = installMarkSettings(this.surface.shadow, {t: tr, get: () => this.settings, onChange: (k, v) => void this.applySettings({[k]: v})});
    /* shortcut editor, settings backup (export / import): ONE implementation for the bar, the file view and the popup (settings-extras.mjs) */
    this.extrasUi = installSettingsExtras(this.surface.shadow, {t: tr, get: () => this.settings, keyboard: () => this.surface.keyboard, onChange: (k, v) => void this.applySettings({[k]: v}), onImport: values => this.applySettings(values),
      onResetAll: () => this.clearData(), locales: this.locales, appVersion: api.runtime.getManifest?.().version || ''});
    this.layoutUi = installSettingsLayout(this.surface.shadow, {t: tr, get: () => this.settings, onChange: (k, v) => void this.applySettings({[k]: v}), onPreview: theme => this.surface.setOverlayColors(deriveBoth(theme))});
    this.surface.setOverlayColors(deriveBoth(this.settings.overlayTheme));
    this.surface.keyboard?.setBindings(this.settings.keyboard);
    for (const type of ['input', 'pointerdown', 'keydown']) this.surface.shadow.addEventListener(type, () => this.noteActivity?.(), {capture: true, passive: true});      // working the bar's own controls (a slider drag inside its shadow root) pauses the background look-ahead too
    this.bookmarkUi=installBookmarkAction(this.surface,{getLanguage:()=>this.settings.uiLanguage,getState:()=>({generation:this.generation,char:this.charOfPosition(),ready:this.chunks.length>0&&!this.externalBusy}),onState:()=>this.readingHistory?.bookmarkState(this.historyPosition()),onToggle:()=>this.toggleBookmark()});
  }
  /* A change written by someone else (another tab, the popup, an import): follow it. Our own writes come back as events too and are ignored (a ring of the last values we wrote). */
  mergeExternal(next) {
    if (this.destroyed || !next || typeof next !== 'object') return;
    const text = JSON.stringify(next), now = Date.now(), ring = (this.written || []).filter(w => now - w.t < 3000), hit = ring.findIndex(w => w.text === text);   // each own write comes back as ONE event: consumed once, forgotten after 3 s (a foreign write that happens to equal an older state of ours must still be applied)
    this.written = ring; if (hit >= 0) { ring.splice(hit, 1); return; }
    const diff = {}; for (const k of EXPORT_KEYS) if (k !== 'bar' && next[k] !== undefined && JSON.stringify(next[k]) !== JSON.stringify(this.settings[k])) diff[k] = next[k];
    if (Object.keys(diff).length) void this.applySettings(diff, {external: true});
  }
  /* After many settings changed at once (import, reset): the pieces that are not driven by a single key. */
  refreshDerived() {
    const s = this.settings;
    this.readingMarks?.apply('markWord', s.markWord, s); this.highlight?.setFollow(s.follow); this.highlight?.setClickSeek(s.clickSeek && !this.suspended);
    this.surface?.keyboard?.setBindings(s.keyboard); this.marksUi?.sync(); this.extrasUi?.sync();
  }
  show() { this.setVisible(true); }
  setVisible(value, pause = true) {
    this.visible = value; if (value) this.areaPending = false;
    if (!value) { this.voiceCard = null; if (pause) void this.pause(); this.tutor?.clear('bar-closed'); }   // the tour needs the bar's controls: closing the bar ends it and removes its marks
    this.surface?.setVisibility(value); this.options.onVisibility?.(value); this.changed(); if (value) this.prewarm();
  }
  bridgeVisibility() { addEventListener('pagehide', this.onPageHide = () => { void this.savePosition(true); }); }
  metrics() {
    const c = this.chunks[this.position.chunk]; if (!c) return {elapsedSeconds: 0, remainingSeconds: 0, totalSeconds: 0, progressFraction: 0, remainingEstimated: true};
    const axis=this.timeline(),preview=this.timelinePreview,p=preview&&preview.chunk===this.position.chunk&&preview.word===this.position.word?preview.fraction:axis.fraction(this.position);
    const total = axis.total / 14 / Math.max(.5, this.settings.speed), progress = this.state === 'ended' ? 1 : p;
    return {elapsedSeconds: total * progress, remainingSeconds: total * (1 - progress), totalSeconds: total, progressFraction: progress, remainingEstimated: true};
  }
  /* ONE truth for button, status line and popup: a start/jump/resume that has not produced audio yet is LOADING (also in the gap before the first pipeline event,
     when state is still 'idle' but a start is in flight). A pause pressed meanwhile is PAUSED (the click cancels the start attempt) - never both. */
  pauseIntent() { return this.wantPause && (this.state === 'loading' || this.starting === true); }
  isLoading() { return !this.lastError && !this.wantPause && this.state !== 'playing' && this.state !== 'paused' && this.state !== 'ended' && (this.state === 'loading' || this.starting === true || !!this.download); }
  statusKey() { return this.lastError ? (ERROR_KEYS.has(this.lastError) ? this.lastError : 'reader_error') : this.download ? 'voice_downloading' : this.state === 'playing' ? 'playing' : this.state === 'paused' || this.pauseIntent() ? 'paused' : this.state === 'ended' ? 'completed' : this.isLoading() ? (this.computing ? (this.engineInfo?.backend ? 'computing_on' : 'computing') : 'preparing') : this.voiceMissing() ? 'voice_missing' : 'ready'; }   // a voice offer is not a state: it lives on the card and in the voice picker, never in the status line
  /* The chosen voice still has to be downloaded (nothing runs, nothing downloads): the bar says so before Play. */
  voiceMissing() {
    if (this.download || this.voice?.kind !== 'neural' || this.voiceUsable() || !this.installedKnown) return null;
    return {mb: mbOf(this.voice.model)};
  }
  statusParams() {
    if (this.lastError) return this.errorParams || undefined;
    if (this.download) return {percent: this.downloadPercent(), mb: Math.round(this.download.total / 1e6)};
    if (this.computing && this.engineInfo?.backend) return {backend: backendLabel(this.engineInfo)};
    return this.voiceMissing() || undefined;
  }
  downloadPercent() { const d = this.download; return d ? Math.round(100 * d.loaded / Math.max(1, d.total)) : 0; }
  /* The voice card and the download line as plain data for the bar (one factory draws them everywhere). */
  voiceView(id, full = false) {
    const model = MODELS[id]; if (!model) return null;
    const name = voiceName(this.locales, base(this.settings.uiLanguage) || 'en', full ? model.name : model.display || model.name);      // full: 'Bella · English (Kitten nano)', where the short name equals the current voice's
    return {id: model.id, name, mb: mbOf(model), sample: model.sample || '', installed: this.installed.has(model.id)};
  }
  cardView() {
    const card = this.voiceCard; if (!card) return null;
    // Don't show the voice card for 'none' reason (auto-download handles it)
    if (card.reason === 'none') return null;
    const smaller = card.smaller ? this.voiceView(card.smaller) : null;
    return {reason: card.reason, primary: this.voiceView(card.primary, card.reason === 'slow'), smaller, downloading: card.downloading || ''};
  }
  downloadView() {
    const id = this.download?.modelId || this.dlRunning, view = id ? this.voiceView(id) : null;
    if (!view) return null;
    /* Percent and MB come from the SAME numbers (loaded/total of the transfer). Earlier the size was the model's
       nominal MB while the percent ran against the reported total, so the line could read "21 % of 338 MB" for a 114 MB voice. */
    const live = this.download && Number.isFinite(this.download.total) && this.download.total > 0 ? Math.round(this.download.total / 1e6) : 0;
    return {...view, mb: live || view.mb, percent: this.downloadPercent()};
  }
  snapshot() {
    const s = this.settings, state = this.state, count = this.chunks.length, ref = this.voiceMap.get(this.voiceId), m = this.metrics();
    const prefs = {explainScope:s.explainScope,explainDepth:s.explainDepth,explainLanguage:s.explainLanguage,explainKeepMarks:s.explainKeepMarks===true,focusMotion:s.focusMotion===true,follow: s.follow, followPosition: s.followPosition, followMode: s.followMode, followMargin: s.followMargin, clickSeek: s.clickSeek, bar: s.bar, formatLocale: s.formatLocale, timeFormat: s.timeFormat};
    const chapterIndex = this.chapters.reduce((sel, c, i) => c.sectionIndex <= this.position.chunk ? i : sel, -1);
    return this.withTutor({type: 'state', ...(this.options.source ? {focusOpen: document.body.hasAttribute('data-focus')} : {}), ...Object.fromEntries(Object.entries(prefs).filter(([, v]) => v !== null && v !== undefined)), uiLanguage: s.uiLanguage, playerTheme: s.playerTheme, overlayMode: s.overlayMode, speed: s.speed, volumeMax: 150, volume: s.volume, muted: s.muted, pitch: s.pitch ?? 0, bass: s.bass ?? 0, treble: s.treble ?? 0, sectionPause: s.sectionPause ?? 0, reading: cleanReading(s.reading),
      documentId: this.generation + '|' + (this.fingerprint || ''), language: s.language, activeLanguage: base(ref?.lang || this.lang), detectedLanguage: base(this.pageLang), voice: this.voiceId, voiceLabel: this.catalog.flatMap(g => g.voices).find(v => v.id === this.voiceId)?.label || '', catalog: this.catalog, preferenceVersion: this.version,
      playing: state === 'playing', paused: state === 'paused' || this.pauseIntent(), loading: this.isLoading(), sectionCount: count, sectionIndex: this.position.chunk, chapters: this.chapters.map(c => ({...c, at: this.timeline().fraction({chunk: c.sectionIndex, word: 0})})), chapterIndex, ...m, buffered: this.bufferedRanges(),
      voiceCard: this.cardView(), voiceDownload: this.downloadView(), voiceMissing: this.voiceMissing(), exportState: this.exportState, exportFormats: ['mp3', 'wav', 'pdf', 'html'], exportRanges: this.exportRanges(), controls: {canToggle: !!count && (!this.busy || this.isLoading()) && !this.externalBusy, canPreviousSection: this.position.chunk > 0, canNextSection: this.position.chunk < count - 1, canSeek: !!count, appearanceFields: Object.keys(this.appearanceDefaults || {}).filter(k => k!=='focus')},
      statusKey: this.statusKey(), statusKind: this.lastError ? 'error' : 'info', statusParams: this.statusParams(), ...(this.lastError && !/^[a-z_]+$/.test(this.lastError) ? {status: this.lastError} : {}), appearance: {...(this.appearanceDefaults || {}), ...(s.appearance || {})}});
  }
  /* Sections the host has synthesized and holds (prefetch events of the pipeline: done / evict) as ranges of the timeline [from, to] (fractions), for the
     light "prepared" bar under the timeline (like the buffered range of a video player). Empty for system voices and while nothing is known. */
  bufferedRanges() {
    const ready = this.prepared; if (!ready?.size || this.pipelineKind !== 'neural' || !this.chunks.length) return [];
    const axis = this.timeline(), list = [...ready].filter(i => i >= 0 && i < this.chunks.length).sort((a, b) => a - b), out = [];
    const at = i => i >= this.chunks.length ? 1 : axis.fraction({chunk: i, word: 0});
    for (let k = 0; k < list.length;) { let j = k; while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++; out.push([+at(list[k]).toFixed(4), +at(list[j] + 1).toFixed(4)]); k = j + 1; }
    return out.slice(0, 200);
  }
  onPrefetch(d) {
    if (!Number.isInteger(d?.index)) return;
    const ready = this.prepared || (this.prepared = new Set()), had = ready.has(d.index);
    if (d.phase === 'done') ready.add(d.index); else if (d.phase === 'evict') ready.delete(d.index); else return;
    if (had !== ready.has(d.index)) { clearTimeout(this.preparedTimer); this.preparedTimer = setTimeout(() => { if (!this.destroyed) this.changed(); }, 250); }
  }
  /* Background look-ahead waits while the user works with the page or the tab is hidden (flags only, at most every 400 ms; while reading aloud only the work
     beyond the near window waits, and only while enough audio is ahead). */
  bridgeActivity() {
    this.noteActivity = () => { const now = Date.now(); if (now - (this.activitySent || 0) < 400) return; this.activitySent = now; try { this.pipeline?.setActivity?.({interacting: true}); } catch {} };
    this.onActivity = event => { if (!event.isTrusted || event.type === 'pointermove' && !event.buttons) return; this.noteActivity(); };      // a drag (pointer held down) counts for as long as it lasts
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart']) addEventListener(type, this.onActivity, {capture: true, passive: true});
    this.onTabVisibility = () => { try { this.pipeline?.setActivity?.({hidden: document.visibilityState === 'hidden'}); } catch {} };
    document.addEventListener('visibilitychange', this.onTabVisibility);
  }
  /* while a guided explanation runs, Play/Previous/Next of the bar show ITS state (step, pause), not the paused reading */
  /* while the guided explanation is shown the bar is the tour's: Play/Previous/Next, the timeline (steps, heard/rest of
     the tour), the step list in the chapter menu and "Folgen" on (the tour always follows; the setting is untouched) */
  withTutor(snap) { snap.tutorActive = !!this.tutor?.active; const v = this.tutor?.owns ? this.tutor.view() : null; if (!v) return snap; const p = v.progress; return {...snap, buffered: this.tutor?.preparedRanges?.() || [], playing: v.playing, paused: v.paused, loading: v.loading && !v.paused, statusKey: v.playing ? 'playing' : v.paused ? 'paused' : v.loading ? 'preparing' : snap.statusKey, follow: true, sectionCount: Math.max(1, v.total), sectionIndex: Math.max(0, v.step - 1), chapters: [], chapterIndex: 0, progressFraction: p.fraction, elapsedSeconds: p.elapsed, remainingSeconds: p.remaining, remainingEstimated: true, tourSegments: p.segments, controls: {...snap.controls, canToggle: true, canPreviousSection: v.canPrevious, canNextSection: v.canNext, canSeek: true}}; }
  changed() {
    if (!this.surface) return;
    this.syncActivity();
    const touring = !!this.tutor?.active; if (touring !== !!this.touringSent) { this.touringSent = touring; try { this.pipeline?.setActivity?.({busy: touring}); } catch {} }      // a guided explanation runs (model + voice): the reading look-ahead waits
    /* A bar that cannot draw a state would silently show an old one: logged once and named in status(). */
    try { this.surface.update(this.snapshot()); this.surfaceError = ''; }
    catch (error) {
      const text = String(error?.message || error).slice(0, 160);
      if (text !== this.surfaceError) console.error('beNotable! Reader: bar update failed', error);
      this.surfaceError = text;
    }
    this.bookmarkUi?.sync();
    this.options.onChanged?.();
    if (this.options.source) {                                   // a running export locks the controls that would change what is exported
      for (const node of this.surface.shadow.querySelectorAll('.voice-btn,.speed-trigger,.follow,.settings-panel input,.settings-panel .reader-select-trigger')) node.disabled = !!this.externalBusy;
      const cancel = this.surface.shadow.querySelector('.export-cancel'); if (cancel) cancel.disabled = ['saving', 'done'].includes(this.exportState.phase);
    }
  }
  /* -- popup / service worker interface ---------------------------------------------------------------------------------------------- */
  /* catalog=false: the caller polls and never shows voices (popup, side panel), so the voice catalog (hundreds of
     entries) stays here. */
  status(debug = false, catalog = true) {
    const snap = this.snapshot(), s = this.settings;
    if (!catalog) snap.catalog = [];
    return {ok: true, ready: this.chunks.length > 0, generation: this.generation, explainEpoch:this.explainSource().epoch, kind: 'html', overlayVisible: this.visible, title: this.title, fingerprint: this.fingerprint, snapshot: snap,
      settings: {...s}, engine: {catalog: catalog ? this.catalog : [], voice: this.voiceId, voiceLabel: snap.voiceLabel, language: this.lang, activeLanguage: snap.activeLanguage, detectedLanguage: snap.detectedLanguage, ready: !!this.voice, installed: [...this.installed]},
      playback: {playing: snap.playing, paused: snap.paused, loading: snap.loading}, state: this.state, lastError: this.lastError, errorClass: this.errorClass || '', ...(this.surfaceError ? {surfaceError: this.surfaceError} : {}), position: this.position, ...(debug ? {scans: this.scans, head: this.chunks.slice(0, 3).map(c => c.text.slice(0, 70)), mapperFailures: this.chunks.filter((c, i) => !this.highlight.wordRange(i, 0)).length} : {}), chunkCount: this.chunks.length, busy: !!this.busy, wordCount: this.chunks.reduce((n, c) => n + c.words.length, 0)};
  }
  onMessage(m, respond, sender) {
    if (m?.target !== 'session') return false;
    if (m.fileTabId!==undefined && !this.options.ownPage) return false;
    if (m.t === 'exportJob') { respond({ok: this.exportJobUpdate(m, sender)}); return false; }
    (async () => {
      try {
        if(m.fileTabId!==undefined){const tab=await api.tabs.getCurrent();if(tab?.id!==m.fileTabId)return;}
        if(m.sourceGeneration!==undefined&&m.sourceGeneration!==this.generation)return respond({ok:false,code:'document_changed'});
        if(m.t==='sourceContext'){const first=!this.sourceContextBound;this.sourceContextBound=true;this.options.sourceURL=m.sourceURL;this.bindReadingHistory();if(first&&window!==window.top&&this.state==='idle'&&!this.busy&&!this.seekedAway&&!this.playIntent)await this.restore();return respond(this.status());}
        if(m.t==='document')return respond({ok:true,doc:{...this.documentText(),title:this.title,language:this.pageLang}});
        if (m.t === 'status') return respond(this.status(m.debug === true, m.catalog !== false));
        if (m.t === 'control') { await this.command(m.command, m.value); return respond({ok: true, ...this.status()}); }
        if (m.t === 'settings') { await this.applySettings(m.values); return respond({ok: true, ...this.status()}); }
        if (m.t === 'show') { this.setVisible(true); return respond({ok: true, ...this.status()}); }
        if (m.t === 'hide') { this.setVisible(false); return respond({ok: true, ...this.status()}); }
        respond({ok: false, code: 'invalid'});
      } catch (error) { respond({ok: false, code: 'bridge_failed'}); }
    })();
    return true;
  }
  /* After an extension update this orphaned copy can no longer reach the browser: before its bar goes, a short note
     where the bar was says how to go on. The text was taken from the locales at start; plain DOM, inline styles. */
  showUpdateNotice() {
    const host = this.surface?.host, bar = this.surface?.bar;
    if (!this.visible || !this.updateText || !host?.isConnected || !bar) return;
    try {
      const r = bar.getBoundingClientRect(), css = getComputedStyle(host);
      const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
      const note = document.createElement('div');
      note.dataset.notableReaderUpdate = ''; note.setAttribute('role', 'status'); note.textContent = this.updateText;
      Object.assign(note.style, {
        position: 'fixed', zIndex: '2147483647', boxSizing: 'border-box', left: Math.max(12, r.left) + 'px',
        top: Math.max(12, Math.min(r.top, innerHeight - 80)) + 'px',
        width: Math.max(220, Math.min(r.width, innerWidth - 24)) + 'px',
        padding: '10px 14px', border: '1px solid ' + token('--reader-line', '#dfe4df'), borderRadius: '12px',
        background: token('--reader-paper', '#fff'), color: token('--reader-ink', '#000'),
        boxShadow: token('--reader-shadow', '0 12px 44px #172c2426'),
        font: '13px/1.4 ui-sans-serif,system-ui,sans-serif', cursor: 'pointer',
      });
      note.addEventListener('click', () => note.remove());
      document.documentElement.append(note); setTimeout(() => note.remove(), 20000);
    } catch {}
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const safe = fn => { try { fn(); } catch {} };      // an orphan's runtime is dead: every step must still run, the DOM clean-up above all
    safe(() => { this.checkpointReadingHistory()?.catch?.(() => {}); }); safe(() => this.readingHistory?.destroy());
    safe(() => api.runtime.onMessage.removeListener(this.onRuntimeMessage)); safe(() => this.dirtyWatch?.disconnect());
    clearTimeout(this.workflowNoticeTimer); clearTimeout(this.downloadTimer); safe(() => this.exportSelectionWatch?.());
    safe(()=>this.bookmarkUi?.destroy());safe(()=>this.explainUi?.dispose());safe(()=>this.tutor?.dispose()); safe(()=>this.quickActions?.destroy()); safe(()=>this.pickChapterCleanup?.());
    safe(() => this.readingMarks?.dispose()); safe(() => this.highlight?.dispose()); safe(() => this.surface?.destroy());
    safe(() => this.watch?.stop()); safe(() => api.storage.onChanged?.removeListener(this.onStorage)); clearTimeout(this.startTimer); clearInterval(this.timer); clearTimeout(this.visTimer); safe(() => this.visObserver?.disconnect()); safe(() => removeEventListener('pagehide', this.onPageHide)); safe(() => { for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart']) removeEventListener(type, this.onActivity, {capture: true}); document.removeEventListener('visibilitychange', this.onTabVisibility); clearTimeout(this.preparedTimer); }); safe(() => globalThis.speechSynthesis?.removeEventListener?.('voiceschanged', this.onVoicesChanged)); safe(() => this.disposePipeline());
    if (globalThis.__notableSession === this) globalThis.__notableSession = null;
  }
}
