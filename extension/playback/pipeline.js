/* beNotable! Reader playback · Pipeline interface and LocalPipeline (engine in this page/offscreen document).
   Events: state, timings, progress, download. Synthesis always at 1.0x; tempo happens at playback (own code, MIT). */
import {cleanReading, readingChanged, prepareReadingSpeech, synthesizeReading} from './reading-rules.js';
import {MediaPlayback} from './media-playback.js';
import {createPrefetcher} from './prefetch.js';
import {int16ToFloat} from './wav.js';
import {acquirePlayback} from './playback-lock.js';
import {clampRate, clampVolume, wordAt, cleanFx} from './timeline.js';
import {AudioCache, audioKey, audioKeyPrefix} from './audio-cache.js';
const GPU_CODES = new Set(['webgpu-unavailable', 'jspi-unavailable', 'webgpu-failed']);
/* Engine causes the status line names itself (instead of the generic synthesis error). */
const ENGINE_CODES = new Set(['worker-crashed']);
/* Download failures the page can explain (offline, provider, stalled, disk full, damaged file). */
export const DOWNLOAD_REASONS = ['offline', 'unreachable', 'stalled', 'quota', 'hash', 'incomplete', 'size'];

/* Engine generations are one monotonic sequence for ALL pipelines of this context: cancel(g) cancels everything <= g, so a new pipeline
   (new session, voice or document) must never reuse a number that an earlier pipeline already cancelled (found in the integration test: model switch hung in 'loading'). */
let generationCounter = 0;
export const nextGeneration = () => ++generationCounter;

/* Memory one session holds for audio outside its playback window (visible, rest and already read sections): Int16 samples, 192 MiB = about 70 minutes at
   24 kHz. The audio itself lives in the host's AudioCache (audio-cache.js, one budget for all sessions); this is how much of it one session keeps and
   how far its background work may go. */
export const STASH_BUDGET_BYTES = 192 * 1024 * 1024;
/* After a click, key or scroll on the page the background work (nothing audible waits for it) starts no new section for this long. */
export const INTERACTION_YIELD_MS = 1500;
/* Start buffer of a voice that one worker can not keep up with (see startBuffer): seconds of listening ready before the first sound, and the longest extra wait. */
export const START_BUFFER_SEC = 6, START_WAIT_MS = 8000, SHORT_START_SEC = 2, SHORT_WAIT_MS = 2500;
/* Synthesis time one short piece should take at most (see pieceWords). */
export const PIECE_SEC = 1.5;
/* Id of piece k (1, 2, ...) of a section that arrives in pieces: section + 0.5, + 0.75, + 0.875 ... (ordered, always below the next section). */
export const pieceId = (index, k) => index + 1 - 2 ** -k;
/** Base class documenting the contract; implementations emit CustomEvent(type,{detail}). */
export class Pipeline {
  /* Own tiny emitter instead of EventTarget: Firefox content scripts lose the subclass prototype when a class extends the native EventTarget
     (found in real Firefox 159: "pipeline.load is not a function"). Same surface: addEventListener/removeEventListener/dispatchEvent, events {type, detail}. */
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { let set = this.listeners.get(type); if (!set) this.listeners.set(type, set = new Set()); set.add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(event) { for (const fn of [...(this.listeners.get(event.type) || [])]) fn(event); return true; }
  emit(type, detail) { this.dispatchEvent({type, detail}); }
  async load() { throw new Error('nicht implementiert'); }
  async play() { throw new Error('nicht implementiert'); }
  pause() {} async resume() {} stop() {} async seek() {} setRate() {} setVolume() {} setFx() {} async setVoice() {} dispose() {}
}

export class LocalPipeline extends Pipeline {
  /* Look-ahead (1.6.24 rules): `window` sections after the position are prepared with high priority, the last read section stays (keepPlayed), the sections on screen come next (setVisible),
     then the rest of the page at the lowest priority inside `budgetBytes`. `leadSec` = seconds of ready audio ahead below which a background job is aborted for a near one. background:false = near window only. */
  /* cache: the host's AudioCache shared by all its pipelines (finished sections survive this pipeline, a reload, the bar closing, the engine's idle unload);
     without one the pipeline keeps a private cache. progressive: a section needed soon while little audio is ready is synthesized in growing pieces
     (first sentence first), not only the first section of a start. */
  constructor({engine, lock = true, locks, makePlayback = () => new MediaPlayback(), window = 3, headWords = 15, background = true, budgetBytes = STASH_BUDGET_BYTES, keepPlayed = 1, leadSec = 10, othersActive = () => false, cache = null, progressive = true, now = () => Date.now()} = {}) {
    super();
    Object.assign(this, {engine, useLock: lock, locks, makePlayback, window, headWords, background, budgetBytes, keepPlayed, leadSec, othersActive, progressive, now});
    this.ownCache = !cache; this.cache = cache || new AudioCache({budgetBytes: budgetBytes + 64 * 1024 * 1024});
    this.offEvict = this.cache.onEvict(key => this.onCacheEvict(key));
    this.keys = []; this.activity = {hidden: false, until: 0, lowPower: false}; this.activityTimer = 0; this.tailTried = new WeakSet();
    this.audible = false;      // until the first sound, synthesis stays on one worker (a second would compete with it)
    this.workerCap = () => this.leadRunning ? 1 : 0;      // asked when the engine picks a worker (queued work follows): one worker while the first piece of a start is made (a second would load its model next to it); otherwise the engine decides (pair rules: a slow voice gets its second worker during the start buffer, the background rule keeps one worker on small machines)
    this.holdFn = () => this.held() || this.now() < this.activity.until && !this.urgentNear();      // a background piece job pauses between sentences while the user interacts (during playback only while enough audio is ahead)
    this.pendingReadingTails = new Set(); this.stash = new Map(); this.stashBytes = 0; this.visible = [];
    this.fromWord = new Map(); this.leadIn = null;        // fromWord: first spoken word of a section that was started in its middle; leadIn: the section a start/jump asks for first
    this.playback = null; this.prefetch = null; this.chunks = []; this.lang = 'de'; this.voice = null; this.rate = 1; this.volume = 1; this.fx = cleanFx();
    this.engaged = false; this.onLoaded = e => this.emit('engine', e.detail); engine?.addEventListener?.('loaded', this.onLoaded);
    this.normalize = true; this.chunk = 0; this.stateName = 'idle'; this.engineGen = nextGeneration(); this.playToken = 0; this.timings = new Map(); this.lockHandle = null; this.installedCache = null;
  }
  get state() { return this.stateName; }
  setState(state, code) { if (this.stateName === state && !code) return; this.stateName = state; this.emit('state', {state, ...(code ? {code} : {})}); }

  ensurePlayback() {
    if (this.playback) return this.playback;
    const pb = this.playback = this.makePlayback();
    pb.setRate(this.rate); pb.setVolume(this.volume); pb.setFx(this.fx);
    pb.addEventListener('progress', e => this.emit('progress', e.detail));
    pb.addEventListener('chunkend', e => this.emit('chunkend', e.detail));       // a section was heard to its natural end (the session counts these locally for the rating rule)
    pb.addEventListener('chunkstart', e => this.onChunkStart(e.detail.chunk));
    pb.addEventListener('starved', e => { if (e.detail.next >= this.chunks.length) this.setState('ended'); else { this.setState('loading'); if (!this.promote(e.detail.next) && this.adopt(e.detail.next)) this.promote(e.detail.next); this.announceComputing(e.detail.next); } });
    pb.addEventListener('error', e => this.fail('playback-failed', e.detail?.error));
    return pb;
  }
  /* Slower-than-real-time voices (stage "Experimentell", RTF about 2-3): waiting between two pieces is normal, not an error. The bar shows "Berechnung laeuft, Wiedergabe startet gleich" on this event (state stays `loading`, playback resumes by itself when the piece is ready; tempo setting untouched). */
  announceComputing(next) { if (this.voice?.experimental === true) this.emit('computing', {next}); }
  /* GPU problems of the experimental stage keep their own code so the status line can name the cause and the remedy instead of the generic error. */
  fail(code, error) { this.lastError = error; this.setState('error', GPU_CODES.has(error?.code) || ENGINE_CODES.has(error?.code) ? error.code : code); }

  async load({chunks, lang = 'de', voice, startChunk = 0, normalize = true, reading, compute}) {
    this.halt(); this.audible = false; if (compute) this.setCompute(compute);
    this.reading = cleanReading(reading); this.normalize = normalize !== false;                 // speech normalisation of technical terms (engine rewrites the SPOKEN text only, 1 spoken string per word)
    this.chunks = chunks; this.lang = lang; this.voice = voice; this.chunk = Math.max(0, Math.min(startChunk, chunks.length - 1)); this.keys = [];
    this.resetPrefetch(); this.setState('idle');
  }
  resetPrefetch({keepStash = false} = {}) {
    this.pendingReadingTails.clear(); this.prefetch?.invalidate(); this.engine?.cancel?.(this.engineGen, {owner: this}); this.engineGen = nextGeneration();
    if (!keepStash) for (const index of [...this.stash.keys()]) this.releaseView(index);       // the audio stays in the cache (another voice, a later pipeline, the way back)
    for (const index of [...this.timings.keys()]) if (!this.stash.has(index)) this.timings.delete(index);
    this.prefetch = createPrefetcher({
      count: this.chunks.length, window: this.window, background: this.background, parallel: () => this.engine?.poolFor?.(this.voice?.id, {rate: this.rate, background: this.background}) ?? 1,      // background: as many jobs as the engine's background rule runs at once (a pair on 8+ cores), the engine still decides per job
      synthesize: (index, job) => this.synthesizeChunk(index, job),
      onResult: (index, result, tier) => this.onSynthesized(index, result, tier),
      onError: (index, error, tier) => { if (error?.name !== 'AbortError' && tier === 'near' && !this.idle()) this.fail('synthesis-failed', error); },      // background work (and the window prepared before Play) that fails is retried when it is needed; only near work for the audio stops playback
      onEvent: detail => this.emit('prefetch', detail),
      allow: (tier, index) => this.allowBackground(tier, index),
      urgent: () => this.urgentNear(),
      reserved: () => this.pendingReadingTails.size,
      hold: () => this.held(),
    });
    for (const index of this.stash.keys()) this.prefetch.mark(index);
    this.prefetch.setVisible(this.visible);
  }
  /* -- background work: when it may run -------------------------------------------------------------------------------------------------- */
  /* Nothing audible waits for the work (not playing, not loading a start): then it is background work for this session. */
  idle() { return !['playing', 'loading'].includes(this.stateName); }
  /* Background work waits while the tab is hidden, the battery is low, the user just interacted with the page or another session plays or loads (its
     audio goes first) or the page runs a guided explanation (busy). During playback the window is always prepared. */
  held() {
    if (!this.idle()) return false;
    const a = this.activity; return a.hidden || a.lowPower || a.busy || this.now() < a.until || this.othersActive();
  }
  /* The rest tier only runs while another section fits into the budget; when it does not, a section may push out a held section of a lower rank
     (visible > rest > behind = already read), never one of its own rank or higher (no re-synthesis loop). Before the first use (Play, or the bar opened:
     engage) nothing beyond the near window runs; on low battery only the near window of a playing session. */
  allowBackground(tier) {
    if (!this.engaged || this.held() || this.activity.lowPower) return false;
    if (this.now() < this.activity.until && !this.urgentNear()) return false;      // reading aloud while the user scrolls: work beyond the near window waits while enough audio is ahead
    if (this.stashBytes + this.avgBytes() <= this.budgetBytes) return true;
    const ranks = {visible: 1, rest: 2, behind: 3}, mine = ranks[tier] ?? 3;
    for (const index of this.stash.keys()) if ((ranks[this.prefetch.tierOf(index)] ?? 0) > mine) return true;
    return false;
  }
  /* Page report (content script -> host): tab hidden, user interaction (pointer, key, wheel, scroll). Numbers and flags only. */
  setActivity({hidden, interacting, busy} = {}) {
    if (typeof hidden === 'boolean') this.activity.hidden = hidden;
    if (typeof busy === 'boolean') this.activity.busy = busy;      // the page runs something heavier for the user (guided explanation: model + its own voice)
    if (interacting === true) { this.activity.until = this.now() + INTERACTION_YIELD_MS; clearTimeout(this.activityTimer); this.activityTimer = setTimeout(() => { if (!this.disposed) this.prefetch?.pump(); }, INTERACTION_YIELD_MS + 50); }
    if (this.now() >= this.activity.until && !this.held()) this.prefetch?.pump();
  }
  /* Setting "Rechenweg" (auto | gpu | cpu): which runtime the engine's workers use for the voices that can read on the graphics card (TtsEngine.setCompute). */
  setCompute(value) { this.engine?.setCompute?.(value); }
  /* Host report: battery discharging and low (navigator.getBattery); false again when charging or recovered. */
  setPower({low} = {}) { this.activity.lowPower = low === true; if (!low) this.prefetch?.pump(); }
  /* The bar was opened (or is open) on this page: an explicit use. The look-ahead starts from the position (first sentence first) and continues with the
     visible sections and the rest of the page in the background, Play or not, inside the budget and the background rules above. Nothing is played. */
  engage({chunk = this.chunk, word = 0} = {}) {
    if (this.disposed || !this.chunks.length || !this.prefetch || this.voice?.kind !== 'neural') return;
    this.engaged = true;
    if (this.stateName === 'idle' && !this.playback?.current) {
      const index = Math.max(0, Math.min(chunk, this.chunks.length - 1)); this.chunk = index;
      if (!this.prefetch.ready(index) && !this.stash.has(index) && !this.cache.has(this.keyOf(index))) this.leadIn = {index, word: Number.isInteger(word) && word > 0 ? word : 0};
      this.prefetch.request(index);
    } else this.prefetch.pump();
  }
  /* Sentences known in advance (the guided explanation knows its steps when it starts): synthesized into the host cache in the given order, one sentence
     after the other in pieces over the pool, after any audio a session needs now (engine tier `visible`), under an owner of their own (the load/stop of
     this pipeline for the next step does not cancel them). A sentence that reading already synthesized inside a section is cut out of it by its word times instead. A later call replaces the order
     of an earlier one. Returns how many are ready. items: [{text, words?}]
     ahead: prepared before anything asks for it (the open bar prepares the first step of the guided explanation, PageSession.prepareTour): no wait for a
     start, right after the section at the reading position (engine tier near, before the next sections), but only once Play could start from what is held
     (startSafe: measured 15.11.2026, Thorsten on four cores, Play after 2.5 s waited 0.9-1.2 s for the start buffer instead of 0.03 s when the sentence went
     first); paused while this session plays or loads, the tab is hidden or the battery is low, and while a guided explanation runs that does not ask for
     exactly this sentence (it would take the worker from the tour's own first step). Whoever waits for it (AudioCache.wanted) lets it go on at once. */
  async precompute(items, {voice = this.voice, lang = this.lang, normalize = this.normalize, ahead = false} = {}) {
    if (this.disposed || voice?.kind !== 'neural' || !Array.isArray(items) || !this.engine) return 0;
    const owner = this.precomputeOwner || (this.precomputeOwner = {}), run = this.precomputeRun = (this.precomputeRun || 0) + 1, prefix = audioKeyPrefix({modelId: voice.id, normalize});
    let ready = 0;
    if (!ahead) await this.untilSounding(8000);      // the step being started first: a sentence of the next step must not take a worker (or load a second one) while its first piece is made (Kokoro q8 on four cores: 3-4 s)
    /* One sentence after the other, each in short pieces spread over every worker the engine runs for this voice (a pair for Kokoro q8 on four cores): the
       sentence needed next is ready first. Measured 15.11.2026 with one sentence per worker instead: a 51-word step took 32 s on its worker and its step
       waited 10.9 s. The next sentence is asked for once the first piece of this one is there (its other pieces are queued before it). */
    for (const item of items) {
      if (this.disposed || run !== this.precomputeRun) break;
      const text = String(item?.text || ''), words = (Array.isArray(item?.words) && item.words.length ? item.words : text.match(/\S+/gu) || []).map(String);
      if (!words.length) continue;
      const key = audioKey({modelId: voice.id, normalize, text, words});
      if (this.cache.has(key)) { ready++; continue; }
      if (this.cache.pending.has(key)) { await this.cache.pending.get(key).catch(() => {}); ready++; continue; }
      const span = this.cache.findSpan(prefix, words);
      if (span) { this.cache.put(key, {...span, words}); ready++; continue; }
      /* urgent: a pipeline waits for exactly this text (a section of the page that IS the sentence, the tour's step): it goes on at once. Measured: a short
         page whose section was the key sentence waited for the held preparation, which waited for that section (startSafe): the look-ahead stopped at 1 of 13. */
      const order = ahead ? {tier: 'near', seq: this.chunk + 0.5, hold: () => !this.idle() || this.activity.hidden || this.activity.lowPower || this.activity.busy || !this.startSafe(), urgent: () => this.cache.wanted.has(key)} : {tier: 'visible'};
      const job = this.engine.synthesize({modelId: voice.id, text, words, lang, normalize, generation: nextGeneration(), ...order, owner, parallel: 0, head: this.pieceWordsOf(voice.id, 6), grow: 1, most: ahead ? 5 : this.pieceWordsOf(voice.id, 10), spread: true});      // ahead: short pieces, so a Play or the tour's own step never waits long behind one
      this.cache.pending.set(key, job);      // until the whole sentence is in the cache: a step that starts meanwhile plays the pieces that are there and follows the rest
      const settled = job.then(r => this.keepPrepared(key, r, words)), drop = () => { if (this.cache.pending.get(key) === job) { this.cache.pending.delete(key); this.cache.wanted.delete(key); } };
      job.settled = settled; settled.then(drop, drop);
      try { await job; ready++; } catch (error) { if (error?.name === 'AbortError') break; }
    }
    return ready;
  }
  /* Reading is safe from what is held at the reading position: the whole near window (the section there and `window` after it) and at least the start
     buffer (startBuffer: 2 s, 6 s for a voice one worker can not keep up with), or everything up to the end. Measured 15.11.2026 with only the start
     buffer as the rule: Play at 1.5x right after the bar opened found the only worker busy with a piece of the prepared tour sentence and stopped for
     0.5-4.3 s under load. */
  startSafe() {
    const slow = (this.engine?.speed?.(this.voice?.id)?.rtf || 0) * (this.rate || 1) > 0.85, target = slow ? START_BUFFER_SEC : SHORT_START_SEC; let sec = 0;
    for (let i = this.chunk; i < this.chunks.length; i++) { const d = this.stash.get(i)?.durationSec || this.cache.peek(this.keyOf(i))?.durationSec || 0; if (!d) return false; sec += d; if (sec >= target && i >= this.chunk + this.window) return true; }
    return true;
  }
  /* A prepared sentence into the cache; one that was handed out early (partial, with its `tail` chain) when all of its pieces have arrived. */
  keepPrepared(key, r, words) {
    if (this.disposed || !r) return Promise.resolve();
    if (!r.partial || !r.tail) { this.cache.put(key, {pcm: r.pcm, sampleRate: r.sampleRate, timings: r.wordTimings || null, timingKind: r.timingKind, words}); return Promise.resolve(); }
    const pieces = [r.pcm], follow = tail => tail.then(part => {
      pieces.push(part.pcm); if (part.tail) return follow(part.tail);
      if (this.disposed || pieces.some(p => !p?.length)) return;
      const pcm = new Float32Array(pieces.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of pieces) { pcm.set(p, at); at += p.length; }
      this.cache.put(key, {pcm, sampleRate: part.sampleRate, timings: part.wordTimings || null, timingKind: part.timingKind, words});
    });
    return follow(r.tail).catch(() => {});
  }
  /* Resolves when this pipeline plays (or is not starting anything) or after `ms`: work for later waits for the start of the current one. */
  untilSounding(ms) {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.removeEventListener('state', check); resolve(); };
      const check = () => { if (this.disposed || this.stateName === 'playing' || this.stateName === 'error' || this.stateName === 'ended') done(); };
      const timer = setTimeout(done, ms); this.addEventListener('state', check); queueMicrotask(() => { if (!['idle', 'loading'].includes(this.stateName)) done(); });
    });
  }
  /* -- held audio: the session's view of the host cache ---------------------------------------------------------------------------------- */
  wordsOf(index) { return (this.chunks[index]?.words || []).map(w => typeof w === 'string' ? w : w?.text || ''); }
  /* Cache key of a section: voice, language, normalisation, the reading rules that change the spoken audio, text and words (tempo and sound are not in it). */
  keyOf(index) {
    const known = this.keys[index]; if (known !== undefined) return known;
    const chunk = this.chunks[index]; if (!chunk || !this.voice) return '';
    const rules = readingChanged(this.reading) ? this.reading : null;
    return this.keys[index] = audioKey({modelId: this.voice.id, lang: this.lang, normalize: this.normalize, reading: rules, text: chunk.text, words: this.wordsOf(index), paragraphEnd: !!rules && chunk.paragraphEnd === true, mute: chunk.mute || null});
  }
  viewAdd(index, entry) {
    const old = this.stash.get(index); if (old === entry) return;
    if (old) this.releaseView(index);
    this.stash.set(index, entry); this.stashBytes += entry.bytes; this.cache.ref(entry); this.lastBytes = entry.bytes; this.fromWord.set(index, 0); this.timings.set(index, entry.timings);
  }
  releaseView(index) { const entry = this.stash.get(index); if (!entry) return; this.stash.delete(index); this.stashBytes -= entry.bytes; this.cache.unref(entry); }
  /* A section the cache holds (synthesized earlier by this or another pipeline) and this session does not hold yet: taken over without synthesis. */
  adopt(index) {
    if (this.stash.has(index)) return true;
    if (this.playback?.entries.has(index) || !this.chunks[index]) return false;
    const entry = this.cache.peek(this.keyOf(index)); if (!entry) return false;
    this.viewAdd(index, entry); this.prefetch?.mark(index); this.evict(); if (!this.stash.has(index)) return false;
    this.sendTimings(index, entry); return true;
  }
  /* The page follows the spoken word with the word times of each section it got from this pipeline ('timings'). A section this pipeline takes over from the
     host cache (another pipeline made it: the same selection read again, a reload, a voice switched back) was never announced to the page, which forgets its
     word times with every new pipeline: the audio played and the highlight stayed on word 0 (found 15.11.2026). */
  sendTimings(index, entry) { this.emit('timings', {chunk: index, kind: entry.timingKind || (entry.timings ? 'model' : 'none'), words: entry.timings ? entry.timings.map(w => ({s: w.start, e: w.end})) : []}); }
  /* The host cache dropped an entry (its budget, its expiry): this session does not hold it any more. */
  onCacheEvict(key) {
    for (const [index, entry] of this.stash) if (entry.key === key) { this.stash.delete(index); this.stashBytes -= entry.bytes; this.timings.delete(index); this.prefetch?.unmark(index); this.emit('prefetch', {index, tier: this.prefetch?.tierOf(index) || 'rest', phase: 'evict'}); }
  }
  /* A finished section that went straight to playback is written to the cache too (it stays after it was read, a jump back finds it). */
  remember(index, {pcm, sampleRate, timings, timingKind}) {
    if (!(pcm?.length > 0) || !this.voice) return null;
    return this.cache.put(this.keyOf(index), {pcm, sampleRate, timings, timingKind, words: this.wordsOf(index)});
  }
  /* Sections that leave the playback queue (read, or dropped by a jump) stay held as Int16 while the cache has them. */
  keepReleased(sections) { for (const index of sections) this.adopt(index); }
  avgBytes() { return this.stash.size ? this.stashBytes / this.stash.size : this.lastBytes || 0; }
  /* Seconds of ready audio after the position (at the current tempo): a background job is only aborted for a near job when this runs low or nothing plays yet. */
  aheadSec() { if (!this.playback?.current) return 0; let sec = 0; for (const entry of this.playback.entries.values()) if (entry.id > this.chunk) sec += entry.durationSec; return sec / (this.rate || 1); }
  urgentNear() { return this.aheadSec() < this.leadSec; }
  /* Page report (content script -> host): the sections on screen. */
  setVisible(indices) { this.visible = (indices || []).filter(i => Number.isInteger(i) && i >= 0).slice(0, 400); this.prefetch?.setVisible(this.visible); }
  prefetchStatus() {
    const cached = []; for (let i = 0; i < this.chunks.length; i++) if (this.cache.has(this.keyOf(i))) cached.push(i);
    return {...(this.prefetch?.status() || {}), stash: [...this.stash.keys()].sort((a, b) => a - b), stashBytes: this.stashBytes, budgetBytes: this.budgetBytes, queued: this.playback?.entries.size ?? 0, cached, count: this.chunks.length, engaged: !!this.engaged, held: this.held(), cacheBytes: this.cache.bytes, cache: this.cache.stats()};
  }
  /* Seconds (at the current tempo) of prepared audio that plays before section `index`: the rest of the current section and every section in between, as far
     as there is no hole. */
  readyAheadSec(index) {
    const pb = this.playback; if (!pb) return 0;
    let sec = 0;
    for (let i = this.chunk; i < index; i++) {
      let d = 0; for (const entry of pb.entries.values()) if (entry.section === i) d += entry.durationSec;
      if (!d) d = this.stash.get(i)?.durationSec || 0;
      if (!d) break;
      sec += d;
    }
    const at = pb.position; if (at && at.chunk === this.chunk) sec -= Math.min(sec, at.mediaTime);
    return sec / (this.rate || 1);
  }
  /* A section needed soon (near) is split into growing pieces when the audio ready before it would end before the whole section is synthesized (measured
     speed of this voice on this device; unknown speed counts as too slow: splitting costs a few percent, a long wait is what the user hears). */
  thin(index) {
    const speed = this.engine?.speed?.(this.voice?.id) || {}, chars = this.chunks[index]?.text?.length || 0;
    if (!(speed.msPerChar > 0)) return true;
    return this.readyAheadSec(index) < chars * speed.msPerChar / 1000 * 1.25;
  }
  /* Words per short piece (background pieces, the first piece of a spoken sentence): about PIECE_SEC of synthesis at the measured speed of this voice
     (0.4 s of speech per word), 5 to `most` words: a slow voice (Kokoro q8 on four cores, RTF ~1.1) gets 5-word pieces, so needed audio of another
     session (the first step of a guided explanation) never waits long behind one. */
  pieceWords(most = 10) { return this.pieceWordsOf(this.voice?.id, most); }
  pieceWordsOf(modelId, most = 10) { const rtf = this.engine?.speed?.(modelId)?.rtf; return rtf > 0 ? Math.max(5, Math.min(most, Math.round(PIECE_SEC / (rtf * 0.4)))) : most; }
  /* Growth of the pieces: piece k+1 must be synthesized while the pieces before it play (rtf x grow x tempo < 1 per worker; the pieces are spread over
     the workers the pool allows once audio plays), with some margin; between 1 (pieces as long as the first sentence) and 3. */
  growFactor() {
    const rtf = this.engine?.speed?.(this.voice?.id)?.rtf || 0.6, workers = this.audible && !this.idle() ? Math.max(1, this.engine?.poolFor?.(this.voice?.id, {rate: this.rate}) || 1) : 1;
    return Math.max(1, Math.min(3, 0.8 * workers / (rtf * (this.rate || 1))));
  }
  synthesizeChunk(index, {tier = 'near', signal} = {}) {
    /* Another pipeline of this host (an older session that is being stopped or disposed AFTER this one was created) can cancel a generation above ours: the engine then refuses every request
       of ours at once with an AbortError, and the prefetcher would ask again without end (measured 10.11.2026: the host main thread spun at 100 % and the bar never started). A cancelled
       generation is never used again: this pipeline takes a fresh one before it asks. Work that was running under the old number was dropped by that cancel, the scheduler picks it up again. */
    if (this.engine.isCancelled?.(this.engineGen, this)) this.engineGen = nextGeneration();
    const chunk = this.chunks[index], lead = this.leadIn?.index === index ? this.leadIn : null;
    if (lead) { this.leadIn = null; this.leadRunning = lead; }
    /* in the cache already (this voice, this text: read before, another session, a reload, the guided explanation): no synthesis; being prepared right now
       (sentences of the guided explanation): wait for that instead of synthesizing it twice */
    const key = this.keyOf(index), cached = this.cache.peek(key);
    if (cached && (!(lead?.word > 0) || cached.timings?.[lead.word])) return Promise.resolve({cached});
    const pending = !cached && !(lead?.word > 0) && this.cache.pending.get(key);
    if (pending) {
      /* a sentence being prepared (guided explanation): a start or what plays takes its first piece at once and follows the rest as it is made (the same pieces, no
         second synthesis); look-ahead takes the whole sentence when it is in the cache. Either way the preparation is wanted now (it does not hold back). */
      this.cache.wanted.add(key); this.engine?.pump?.();
      const again = () => { if (lead) this.leadIn = lead; return this.synthesizeChunk(index, {tier, signal}); }, whole = () => { const entry = this.cache.peek(key); return entry ? {cached: entry} : again(); };
      if (tier === 'near' && !this.idle()) return pending.then(r => { const entry = this.cache.peek(key); if (entry) return {cached: entry}; if (r?.pcm?.length && !(r.fromWord > 0)) return r; return again(); }, again);
      return (pending.settled || pending).then(whole, again);
    }
    /* a sentence that reading already synthesized inside a section (guided explanation): cut out of that audio, no synthesis */
    if (!lead?.word && (chunk.words?.length || 0) <= 80) { const span = this.cache.findSpan(audioKeyPrefix({modelId: this.voice.id, normalize: this.normalize, reading: readingChanged(this.reading) ? this.reading : null, lang: this.lang}), this.wordsOf(index)); if (span) { const entry = this.cache.put(key, {...span, words: this.wordsOf(index)}); if (entry) return Promise.resolve({cached: entry}); } }
    const long = this.headWords > 0 && (chunk.words?.length || 0) > this.headWords + 3;
    /* a voice one worker can not keep up with (RTF x tempo > 0.85): every near section in pieces spread over the pool, so both workers work on what plays next */
    const slow = (this.engine?.speed?.(this.voice?.id)?.rtf || 0) * (this.rate || 1) > 0.85;
    /* Only a session that plays (or starts) splits a near section into needed pieces. The open bar's look-ahead (nobody listens yet) makes the near window as
       background pieces the engine can interrupt between: measured 15.11.2026 with Kokoro q8 on four cores, a guided explanation started 3 s after the bar opened
       waited 7.2 s for a worker that ran a 23-word piece of section 1 (13 s of synthesis next to the second worker). */
    const grow = this.progressive ? this.growFactor() : 0, split = lead ? this.headWords > 0 : this.progressive && tier === 'near' && !this.idle() && long && (slow || this.thin(index));
    /* First section of a start/jump: only its first sentence is synthesized before the sound starts, the rest follows (engine `tail`); a jump into the middle skips the words before it. */
    if (readingChanged(this.reading)) {
      const prepared = prepareReadingSpeech(chunk, this.lang, {reading: this.reading, normalize: this.normalize});
      if (prepared) {
        /* A jump starts at the matching SOURCE group; skipped earlier words keep zero-duration slots, so original word indices remain valid. */
        if (lead?.word > 0) {
          const first = prepared.groups.findIndex(group => group.last >= lead.word), at = first < 0 ? prepared.groups.length : first;
          prepared.fromWord = prepared.groups[at]?.first ?? lead.word;
          prepared.words = prepared.words.slice(at); prepared.groups = prepared.groups.slice(at);
        }
        const generation = this.engineGen;
        const scope = this.scope();
        return synthesizeReading(prepared, ({text,words}) => this.engine.synthesize({modelId:this.voice.id,text,words,lang:this.lang,normalize:false,generation,tier,...scope,...(signal?{signal}:{})}), {paragraphEnd:chunk.paragraphEnd===true,stream:split&&this.headWords>0,headWords:this.headWords,grow:this.progressive?grow:0});
      }
    }
    /* background work (look-ahead nobody waits for yet): short pieces the engine can interrupt between (another session's start, the user interacting).
       The open bar's start (split while nobody listens yet) carries hold/urgent too: its pieces wait while the page runs a guided explanation or the user
       interacts, Play makes them needed. A start the user waits for (lead, not idle) marks its first piece `first`: the engine may take a worker from
       background work for it (TtsEngine.preempt). For a slow voice its first piece is short as well (a 15-word sentence of Kokoro q8 is 6-8 s of synthesis nobody
       can interrupt; Play of such a voice waits for its start buffer anyway). */
    const background = !split && (tier !== 'near' || this.idle());
    return this.engine.synthesize({modelId: this.voice.id, text: chunk.text, words: chunk.words, lang: this.lang, normalize: this.normalize, generation: this.engineGen, tier, seq: index, ...(this.idle() ? {idle: true} : {}), ...this.scope(), ...(signal ? {signal} : {}), ...(split ? {head: this.chunks.length === 1 || slow && this.idle() ? Math.min(this.headWords, this.pieceWords(6)) : this.headWords, ...(lead ? {startWord: lead.word} : {}), ...(grow >= 1 ? {grow, spread: true} : {}), ...(slow ? {most: this.pieceWords(10)} : {}), ...(this.idle() ? {hold: this.holdFn, urgent: () => !this.idle()} : lead ? {first: true} : {})} : {}), ...(background ? {chunked: true, chunkWords: this.pieceWords(10), hold: this.holdFn, urgent: () => !this.idle() && this.prefetch?.tierOf(index) === 'near'} : {})});      // urgent: playback reached its window: the engine hands out what is made and streams the rest
  }
  /* Engine request scope: cancels of this pipeline reach only its own requests; before the first sound one worker. */
  scope() { return {owner: this, parallel: this.workerCap}; }
  onSynthesized(index, result, tier = 'near') {
    if (this.leadRunning?.index === index) { this.leadRunning = null; if (this.idle() && this.engaged && !this.held()) void this.engine?.warmPair?.(this.voice?.id); }      // the open bar's start is ready: a slow voice loads its second worker now, before Play
    const words = timings => timings ? timings.map(w => ({s: w.start, e: w.end})) : [];
    if (result.cached) {       // taken from the cache: held as it is (Int16), or into playback when it is needed now
      const entry = result.cached; this.cache.get(entry.key);
      if (tier !== 'near' && !this.playback?.entries.has(index)) { this.viewAdd(index, entry); this.evict(); this.emit('timings', {chunk: index, kind: entry.timingKind, words: words(entry.timings)}); return; }
      this.fromWord.set(index, 0); this.timings.set(index, entry.timings);
      this.ensurePlayback().enqueue({chunkId: index, pcm: int16ToFloat(entry.pcm16), sampleRate: entry.sampleRate, timings: entry.timings});
      this.emit('timings', {chunk: index, kind: entry.timingKind, words: words(entry.timings)}); return;
    }
    if (result.readingTail && result.tail) {
      /* A custom reading tail is several sequential synthesis calls. Reserve its worker until complete so look-ahead cannot queue long future sections between its phrases. */
      const prefetch = this.prefetch, done = result.readingDone || result.tail, release = () => { this.pendingReadingTails.delete(done); if (this.prefetch === prefetch) prefetch?.pump(); };
      this.pendingReadingTails.add(done); done.then(release, release);      // a progressive tail keeps the worker until its last piece
    }
    const timings = result.wordTimings || null, kind = result.timingKind || (timings ? 'model' : 'none'), complete = !result.tail && !(result.fromWord > 0) && !result.partial;
    this.timings.set(index, timings);
    if (tier !== 'near' && complete && !this.playback?.entries.has(index)) {       // prepared early: held as Int16 until it enters the near window (or is evicted)
      this.stashStore(index, result, timings); this.emit('timings', {chunk: index, kind, words: words(timings)}); return;
    }
    this.fromWord.set(index, result.fromWord || 0);
    this.ensurePlayback().enqueue({chunkId: index, pcm: result.pcm, sampleRate: result.sampleRate, timings, ...(result.tail ? {tailId: pieceId(index, 1)} : {})});
    const headEntry = this.playback.entries.get(index);
    this.emit('timings', {chunk: index, kind, words: words(timings)});
    if (complete) this.remember(index, {pcm: result.pcm, sampleRate: result.sampleRate, timings, timingKind: kind});
    if (result.tail) this.followTail(index, result, headEntry, this.engineGen, result.tail, 1, result.durationSec, [result.pcm]);
  }
  /* The pieces of a split section arrive one after the other (engine `tail` chain): each is queued as its own element behind the one before; the last
     one completes the section, which is then written to the cache as one piece (when it started at word 0). */
  followTail(index, head, headEntry, gen, tail, k, offset, pieces) {
    tail.then(part => {
      if (gen !== this.engineGen || !this.playback?.entries.has(index)) return;      // stopped, jumped or voice changed meanwhile
      this.timings.set(index, part.wordTimings);
      const next = part.tail ? pieceId(index, k + 1) : undefined;
      this.playback.enqueue({chunkId: pieceId(index, k), pcm: part.pcm, sampleRate: part.sampleRate, section: index, offset, ...(next !== undefined ? {tailId: next} : {})});
      this.emit('timings', {chunk: index, kind: part.timingKind, words: part.wordTimings ? part.wordTimings.map(w => ({s: w.start, e: w.end})) : []});
      pieces.push(part.pcm);
      if (part.tail) return this.followTail(index, head, headEntry, gen, part.tail, k + 1, offset + part.durationSec, pieces);
      if (head.fromWord > 0 || pieces.some(p => !p?.length)) return;
      const total = pieces.reduce((s, p) => s + p.length, 0), pcm = new Float32Array(total); let at = 0; for (const p of pieces) { pcm.set(p, at); at += p.length; }
      this.remember(index, {pcm, sampleRate: part.sampleRate, timings: part.wordTimings, timingKind: part.timingKind});
    }, error => this.tailLost(index, {wordTimings: this.timings.get(index) || head.wordTimings, durationSec: offset, readingTail: head.readingTail}, headEntry, error, k));
  }
  /* The rest of a split section was lost (worker crash, an engine-wide cancel) while its earlier pieces play. The
     section already counts as prepared, so without a new request the playback would wait for it forever: ask once
     more for the words after what arrived, then fail visibly. Our own stop, jump or voice change replaced the
     playback entry and needs nothing. */
  tailLost(index, head, headEntry, error, k = 1) {
    if (this.disposed || !headEntry || this.playback?.entries.get(index) !== headEntry) return;
    const chunk = this.chunks[index], from = head.wordTimings?.length || 0, ours = () => !this.disposed &&
      this.playback?.entries.get(index) === headEntry;
    const recoverable = !head.readingTail && !this.tailTried.has(headEntry) && chunk && from > 0 && from < chunk.words.length;
    if (!recoverable) return this.fail('synthesis-failed', error);
    this.tailTried.add(headEntry);
    if (this.engine.isCancelled?.(this.engineGen, this)) this.engineGen = nextGeneration();
    const request = {modelId: this.voice.id, text: chunk.text, words: chunk.words, lang: this.lang,
      normalize: this.normalize, generation: this.engineGen, tier: 'near', ...this.scope(), startWord: from};
    this.engine.synthesize(request).then(rest => {
      if (!ours()) return;
      const shift = head.durationSec, later = rest.wordTimings?.slice(from);
      const timings = head.wordTimings && later
        ? head.wordTimings.concat(later.map(({start, end}) => ({start: start + shift, end: end + shift}))) : null;
      this.timings.set(index, timings);
      const part = {chunkId: pieceId(index, k), pcm: rest.pcm, sampleRate: rest.sampleRate, section: index, offset: shift};
      this.playback.enqueue(part);
      const words = timings ? timings.map(w => ({s: w.start, e: w.end})) : [];
      this.emit('timings', {chunk: index, kind: timings ? rest.timingKind : 'none', words});
    }, retry => { if (ours()) this.fail('synthesis-failed', retry); });
  }
  stashStore(index, result, timings) {
    const entry = this.cache.put(this.keyOf(index), {pcm: result.pcm, sampleRate: result.sampleRate, timings, timingKind: result.timingKind || (timings ? 'model' : 'none'), words: this.wordsOf(index)});
    if (!entry) return;
    this.viewAdd(index, entry); this.evict();
  }
  /* Over budget: the lowest priority goes first (already read before rest before visible; read: the oldest first, rest: the farthest first); a section in
     the near window is never evicted. It leaves this session's view; the host cache keeps it while its own budget allows. */
  evict() {
    while (this.stashBytes > this.budgetBytes && this.stash.size) {
      let victim = -1, rank = -1;
      for (const index of this.stash.keys()) { const tier = this.prefetch.tierOf(index), r = tier === 'behind' ? 3 : tier === 'rest' ? 2 : tier === 'visible' ? 1 : 0; if (r > rank || r === rank && (r === 3 ? index < victim : index > victim)) { rank = r; victim = index; } }
      if (rank === 0) break;
      this.dropStash(victim); this.emit('prefetch', {index: victim, tier: ['near', 'visible', 'rest', 'behind'][rank], phase: 'evict'});
    }
  }
  dropStash(index) { if (!this.stash.has(index)) return; this.releaseView(index); this.timings.delete(index); this.prefetch?.unmark(index); }
  /* A held section enters playback (its window arrived, a jump or the end of the queue asks for it). The cache keeps it. */
  promote(index) {
    const entry = this.stash.get(index); if (!entry) return false;
    this.releaseView(index); this.cache.get(entry.key); this.fromWord.set(index, 0); this.timings.set(index, entry.timings);
    this.ensurePlayback().enqueue({chunkId: index, pcm: int16ToFloat(entry.pcm16), sampleRate: entry.sampleRate, timings: entry.timings});
    this.sendTimings(index, entry); return true;
  }
  promoteWindow(from) { for (let i = from; i <= Math.min(this.chunks.length - 1, from + this.window); i++) if (this.stash.has(i)) this.promote(i); }
  sectionsInPlayback(before = Infinity) { const out = new Set(); for (const id of this.playback?.entries.keys() || []) if (id < before) out.add(Math.floor(id)); return out; }
  onChunkStart(chunk) {
    this.chunk = chunk; this.audible = true;
    if (this.pausedByUser) this.playback.pause(); else this.setState('playing');   // a start that raced with the user's pause must not play
    const before = chunk - this.keepPlayed, released = this.sectionsInPlayback(before);
    this.playback.dropBefore(before); this.keepReleased(released);      // the last read section stays in the queue (step back / repeat), older ones stay held as Int16
    this.prefetch.forget(before, i => this.stash.has(i));
    this.prefetch.request(chunk + 1); this.promoteWindow(chunk + 1);
  }

  async modelReady() {
    if (this.voice?.kind !== 'neural') return false;
    const installed = await this.engine.installed();
    return installed.has(this.voice.id);
  }
  /** Hybrid support: is this chunk synthesized and queued? */
  ready(chunk) { return this.prefetch?.ready(chunk) === true && (this.playback?.entries.has(chunk) === true || this.stash.has(chunk)); }
  warm(chunk) { this.engaged = true; if (this.prefetch) this.prefetch.request(chunk); }
  /* Experimental voices (slower than real time, cold start 5-10 s): the bar is open and the voice is chosen, so the model is loaded and the next sections are prepared silently, before anyone
     presses Play. Only the near window (`window` sections), the rest of the page follows with the first Play (allowBackground). Nothing is played, no download, no effect on other voices. */
  prewarm(chunk = this.chunk) {
    if (this.voice?.experimental !== true) return void this.prewarmInstalled();
    if (!this.chunks.length || !this.prefetch) return;
    const prefetch = this.prefetch;      // the warm-up takes seconds: a pipeline that was disposed or reset meanwhile must not be armed again (it would keep synthesizing as a zombie)
    void this.engine.warm?.(this.voice.id).then(() => { if (!this.disposed && this.prefetch === prefetch && this.stateName === 'idle') prefetch.request(Math.max(0, Math.min(chunk, this.chunks.length - 1))); }, () => {});
  }
  /* Normal voices: only the model is loaded (no synthesis), so the first Play skips the model load. It checks every
     guard itself: the voice is already installed (never a download), the engine is idle and holds no other model (that
     worker may serve another tab), no other session is loading or playing, and the device reports at least 4 GB
     (unknown memory, as in Firefox, counts as too little). The engine's idle unload frees it when Play never comes. */
  async prewarmInstalled() {
    const engine = this.engine, voice = this.voice, blocked = () => this.disposed || this.voice !== voice ||
      this.stateName !== 'idle' || !engine?.warm || engine.installing || engine.busy > 0 || this.othersActive();
    if (voice?.kind !== 'neural' || !this.chunks.length || blocked()) return false;
    const caps = await engine.capabilities?.().catch(() => null);
    if (!(caps?.memoryGB >= 4) || blocked()) return false;
    const installed = await engine.installed().catch(() => new Set());
    if (!installed.has(voice.id) || blocked()) return false;
    return engine.warm(voice.id, {evict: false}).catch(() => false);
  }

  async acquire() {
    if (!this.useLock || this.lockHandle) return;
    /* a pre-empted session stops starting look-ahead work: the engine belongs to the session that took over */
    const onPreempt = () => { this.playback?.pause(); this.prefetch?.pause(); this.lockHandle = null; this.setState('preempted'); };
    this.lockHandle = await acquirePlayback({locks: this.locks, onPreempt});
    this.prefetch?.resume();
  }

  async play({chunk = this.chunk, wordIndex, rate, volume} = {}) {
    if (!this.chunks.length) return;
    if (rate !== undefined) this.setRate(rate);
    if (volume !== undefined) this.setVolume(volume);
    chunk = Math.max(0, Math.min(chunk, this.chunks.length - 1));
    const token = ++this.playToken; this.pausedByUser = false; this.engaged = true;
    this.pendingStart={chunk,wordIndex};this.playback?.stop();
    const ready=await this.modelReady();
    if(token!==this.playToken)return;
    if(!ready)return this.fail('model-missing');
    await this.acquire();
    if (token !== this.playToken) return;
    const pb = this.ensurePlayback();
    this.chunk = chunk;
    const startWord = Number.isInteger(wordIndex) && wordIndex > 0 ? wordIndex : 0;
    const held = pb.entries.has(chunk) || this.stash.has(chunk) || this.adopt(chunk);      // adopt: the host cache has it (read before, another session, a reload)
    if (held && (this.fromWord.get(chunk) || 0) <= startWord && (startWord===0||this.timings.get(chunk)?.[startWord])) {                    // prepared already (read before, near window, visible/rest tier): starts without synthesis, the priorities are re-aimed
      pb.stop(); if (this.stash.has(chunk)) this.promote(chunk);
      this.prefetch.request(chunk); this.promoteWindow(chunk);
    } else if (this.leadRunning?.index === chunk && this.leadRunning.word <= startWord && this.prefetch.running(chunk)) {      // the open bar already started exactly this (first sentence first): wait for it, never cancel and start it again
      this.setState('loading'); this.prefetch.request(chunk);
      await this.waitFor(chunk, token);
      if (token !== this.playToken || this.stateName === 'error' || !pb.entries.has(chunk)) return;
    } else {                                                                    // not synthesized yet (or dropped, or started later in the section than asked): start the window here
      const released = this.sectionsInPlayback();
      pb.stop(); pb.clear(); this.keepReleased([...released].filter(i => i !== chunk));      // what the queue held stays held as Int16 (the cache has it)
      this.engine.cancel?.(this.engineGen, {owner: this}); this.engineGen = nextGeneration(); this.prefetch.restart([...this.stash.keys()]);        // a jump drops in-flight work and the old window; held look-ahead audio stays valid
      for (const index of [...this.timings.keys()]) if (!this.stash.has(index)) this.timings.delete(index);
      this.setState('loading'); this.leadIn = {index: chunk, word: startWord};
      this.announceComputing(chunk);
      this.prefetch.request(chunk);
      await this.waitFor(chunk, token);
      if (token !== this.playToken || this.stateName === 'error' || !pb.entries.has(chunk)) return;
    }
    await this.startBuffer(chunk, token); if (token !== this.playToken || this.stateName === 'error') return;
    if (this.pausedByUser) { this.setState('paused'); return; }          // paused while the first section was still being synthesised: stay paused, resume() starts it
    const timings = this.timings.get(chunk), at = Number.isInteger(wordIndex) && timings?.[wordIndex] ? timings[wordIndex].start : 0;
    this.pendingStart = null;
    try { await pb.start(chunk, at); } catch (error) { if (token === this.playToken) this.fail('playback-failed', error); }
  }
  /* A voice that ONE worker can not keep up with at this tempo (measured real-time factor x tempo > 0.85, e.g. Kokoro q8 on four cores: 1.1-1.2 per worker
     of a pair) starts once START_BUFFER_SEC of listening are ready (at most START_WAIT_MS of extra waiting): measured without it, such a start played its
     first second and then stopped for 4-5 s while the pair of workers caught up. Faster voices start at once. While the bar was open the look-ahead
     usually has this ready already. */
  async startBuffer(chunk, token) {
    if (this.chunks.length === 1) return;      // a single spoken sentence (guided explanation): its first piece plays at once, waiting for all of it would be the longer pause
    /* slow = the workers of this voice together can not keep up: a pair counts twice (measured 20.11.2026, Kokoro FP32 pair at 2x, 4 threads each: per-worker RTF
       0.79, together 0.4; judged per worker the start waited for 6 s of audio and the first sound came after 9.5 s, then no gap at all) */
    const rtf = this.engine?.speed?.(this.voice?.id)?.rtf, workers = Math.max(1, this.engine?.poolFor?.(this.voice?.id, {rate: this.rate}) || 1), slow = rtf * (this.rate || 1) / workers > 0.85;
    /* every voice: a start whose ready audio is shorter than SHORT_START_SEC (a one-line heading) waits up to SHORT_WAIT_MS for more (measured: 1.5 s of
       heading, then a 1 s stop before the paragraph) */
    const target = slow ? START_BUFFER_SEC : SHORT_START_SEC, wait = slow ? START_WAIT_MS : SHORT_WAIT_MS;
    const enough = () => token !== this.playToken || this.stateName === 'error' || this.pausedByUser || this.readyAheadSec(this.chunks.length) >= target || this.allReadyFrom(chunk);
    if (enough()) return;
    this.setState('loading');
    await new Promise(resolve => {
      const until = this.now() + wait, check = () => { if (enough() || this.now() >= until) { clearInterval(timer); this.removeEventListener('timings', check); this.removeEventListener('progress', check); resolve(); } };
      const timer = setInterval(check, 200); this.addEventListener('timings', check); this.addEventListener('progress', check);
    });
  }
  allReadyFrom(chunk) { for (let i = chunk; i < this.chunks.length; i++) if (!this.playback?.entries.has(i) && !this.stash.has(i)) return false; return true; }
  waitFor(chunk, token) {
    return new Promise(resolve => {
      const check = () => {
        if (token !== this.playToken || this.playback?.entries.has(chunk) || this.stateName === 'error') { this.removeEventListener('timings', check); this.removeEventListener('state', check); resolve(); }
      };
      this.addEventListener('timings', check); this.addEventListener('state', check); check();
    });
  }

  pause() {
    this.pausedByUser = true;
    if (!this.playback?.current) { if (['loading', 'playing'].includes(this.stateName)) this.setState('paused'); return; }
    this.playback.pause(); this.setState('paused');
  }
  async resume() {
    this.pausedByUser = false;
    if (this.stateName === 'ended' || !this.playback?.current) return this.play(this.stateName==='ended'?{chunk:0}:this.pendingStart||{chunk:this.chunk});
    const token=this.playToken;await this.acquire();if(token!==this.playToken||this.pausedByUser)return;await this.playback.resume();if(token===this.playToken&&!this.pausedByUser)this.setState('playing');
  }
  halt() { this.leadRunning = null; this.playToken++; this.prefetch?.invalidate(); this.engine?.cancel?.(this.engineGen, {owner: this}); this.engineGen = nextGeneration(); this.playback?.clear(); this.leadIn = null; this.pendingStart=null; this.lockHandle?.release(); this.lockHandle = null; }
  stop() { this.halt(); this.resetPrefetch({keepStash: true}); this.setState('idle'); }      // what is held stays valid (same voice, same text): a restart nearby needs no synthesis
  async seek(chunk, wordIndex) { return this.play({chunk, wordIndex}); }
  setRate(value) { this.rate = clampRate(value); this.playback?.setRate(this.rate); }
  setVolume(value) { this.volume = clampVolume(value); this.playback?.setVolume(this.volume); }
  /* Voice shaping {pitch (semitones), bass, treble (dB), gapMs}: the sound is shaped at playback, the engine and the prepared audio are untouched. */
  setFx(value) { this.fx = cleanFx({...this.fx, ...value}); this.playback?.setFx(this.fx); }
  async setVoice(voice) {
    const wasActive = ['playing', 'loading'].includes(this.stateName), position = this.playback?.position;
    const word = position && position.chunk === this.chunk ? wordAt(this.timings.get(this.chunk), position.mediaTime) : null;
    this.playToken++; this.playback?.clear(); this.voice = voice; this.keys = []; this.audible = false; this.resetPrefetch();      // only this session's view goes: the cache keeps the old voice's audio for the way back
    if (wasActive) await this.play({chunk: this.chunk, wordIndex: word > 0 ? word : undefined});
  }
  /** Protocol `ensureModel`: download only after the user confirmed in the UI. */
  async ensureModel(modelId, {signal} = {}) {
    try {
      await this.engine.install(modelId, {signal, onProgress: p => this.emit('download', {modelId, loaded: p.loaded, total: p.total, phase: p.phase || 'download'})});
      this.emit('download', {modelId, loaded: 1, total: 1, phase: 'ready'});
    } catch (error) { this.emit('download', {modelId, loaded: 0, total: 0, phase: 'error', ...(DOWNLOAD_REASONS.includes(error?.code) ? {reason: error.code} : {})}); throw error; }
  }
  dispose() {
    this.disposed = true; clearTimeout(this.activityTimer); this.engine?.removeEventListener?.('loaded', this.onLoaded); this.halt();
    if (this.precomputeOwner) this.engine?.cancel?.(undefined, {owner: this.precomputeOwner});
    for (const index of [...this.stash.keys()]) this.releaseView(index); this.stash.clear(); this.stashBytes = 0; this.offEvict?.(); if (this.ownCache) this.cache.clear();
    this.playback?.dispose(); this.playback = null; this.setState('idle');
  }
}
export const createLocalPipeline = options => new LocalPipeline(options);
