/* beNotable! Reader playback · one audio element per chunk (WAV blob), next chunk preloaded, pitch-preserving tempo,
   volume above 100 % through a GainNode. currentTime is media time and indexes the word timings directly (own code, MIT). */
import {encodeWav} from './wav.js';
import {clampRate, clampVolume, cleanFx, pitchFactor} from './timeline.js';

/* Pitch without a tempo change: the PCM is read faster/slower (resampled, pitch x f, length / f) and the element plays it at rate / f with preservesPitch, so the tempo stays and the new pitch is kept.
   Media time of the element is therefore (original time / f); every public time (position, progress, start offsets, durations) stays in ORIGINAL media time, so the word timings need no change. */
export function resamplePcm(pcm, factor) {
  if (!(factor > 0) || Math.abs(factor - 1) < 1e-6) return pcm;
  const n = Math.max(1, Math.round(pcm.length / factor)), out = new Float32Array(n), last = pcm.length - 1;
  for (let i = 0; i < n; i++) { const at = i * factor, k = Math.floor(at), f = at - k, a = pcm[Math.min(k, last)], b = pcm[Math.min(k + 1, last)]; out[i] = a + (b - a) * f; }
  return out;
}

const defaults = () => ({
  createAudio: () => new Audio(),
  createContext: () => new AudioContext(),
  urlApi: URL,
  now: () => performance.timeOrigin + performance.now(),
  setTimer: (fn, ms) => setInterval(fn, ms),
  clearTimer: id => clearInterval(id),
  tickMs: 100,
  delay: (fn, ms) => setTimeout(fn, ms),
  cancelDelay: id => clearTimeout(id),
});

export class MediaPlayback extends EventTarget {
  constructor(options = {}) {
    super();
    Object.assign(this, defaults(), options);
    this.entries = new Map(); this.current = null; this.rate = 1; this.volume = 1; this.context = null;
    this.fx = cleanFx(); this.factor = 1; this.gapTimer = null; this.gapRun = null;
    this.timer = null; this.waitingFor = null; this.held = false; this.endedAt = 0; this.generation = 0; this.disposed = false;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }

  /* A section can arrive in pieces (first sentence first): the head is enqueued with `tailId`, each later piece under its own id (section + 0.5, + 0.75, ...) with
     `section` (the section it belongs to), `offset` (seconds before it in the section) and, when another piece follows, that piece's id as `tailId`.
     Events and positions always speak of the section and its own media time. */
  enqueue({chunkId, pcm, sampleRate, timings = null, tailId, section, offset = 0}) {
    if (this.disposed) return;
    const old = this.entries.get(chunkId);
    if (old) this.release(old);
    const el = this.createAudio(), factor = this.factor;
    const entry = {id: chunkId, url: this.urlApi.createObjectURL(new Blob([encodeWav(resamplePcm(pcm, factor), sampleRate)], {type: 'audio/wav'})), el, pcm, sampleRate, factor, durationSec: pcm.length / sampleRate, timings, gain: null, source: null, filters: null, section: section ?? chunkId, offset, next: tailId ?? (section === undefined ? undefined : section + 1)};
    el.preload = 'auto'; el.src = entry.url; this.applyTo(entry);
    el.addEventListener('ended', () => this.onEnded(entry));
    this.entries.set(chunkId, entry);
    if (this.waitingFor === chunkId && !this.held) { this.waitingFor = null; this.begin(chunkId, 0).catch(error => this.emit('error', {error})); }
  }

  applyTo(entry) {
    const el = entry.el;
    el.preservesPitch = true; el.mozPreservesPitch = true; el.webkitPreservesPitch = true;
    el.playbackRate = this.elementRate(entry);
    if (this.volume > 1 || this.shaped()) this.ensureGain(entry); else if (entry.gain) entry.gain.gain.value = this.volume;
    el.volume = entry.gain ? 1 : this.volume;
    if (entry.gain) entry.gain.gain.value = this.volume;
    if (entry.filters) { entry.filters.bass.gain.value = this.fx.bass; entry.filters.treble.gain.value = this.fx.treble; }
  }
  shaped() { return this.fx.bass !== 0 || this.fx.treble !== 0; }
  /* the element plays resampled audio (pitch x factor) at rate / factor: pitch kept by preservesPitch, tempo = the requested rate (within what the browser plays: 0.25-5). */
  elementRate(entry) { return Math.min(5, Math.max(0.25, this.rate / (entry.factor || 1))); }
  /* MediaElementSource can be created once per element; it routes the element through the gain so >100 % is possible. */
  ensureGain(entry) {
    if (entry.gain) return;
    try {
      this.context ??= this.createContext();
      entry.source = this.context.createMediaElementSource(entry.el);
      entry.gain = this.context.createGain();
      /* bass / treble: two shelving filters in front of the gain (only where the context offers them) */
      const bass = this.context.createBiquadFilter?.(), treble = this.context.createBiquadFilter?.();
      if (bass && treble) {
        bass.type = 'lowshelf'; bass.frequency.value = 200; treble.type = 'highshelf'; treble.frequency.value = 3500;
        entry.filters = {bass, treble}; entry.source.connect(bass); bass.connect(treble); treble.connect(entry.gain);
      } else entry.source.connect(entry.gain);
      entry.gain.connect(this.context.destination);
    } catch (error) { entry.gain = null; this.emit('warning', {code: 'gain-unavailable', error}); }
  }

  async begin(chunkId, atSec) {
    const entry = this.entries.get(chunkId);
    if (!entry) throw new Error('Abschnitt nicht vorbereitet');
    const generation = ++this.generation;
    this.cancelGap(); this.silence();
    this.current = entry; this.waitingFor = null;
    try { entry.el.currentTime = Math.max(0, Math.min(atSec || 0, Math.max(0, entry.durationSec - 0.01))) / (entry.factor || 1); } catch {}
    if (this.context?.state === 'suspended') await this.context.resume().catch(() => {});
    if(generation!==this.generation||this.held)return;
    try { await entry.el.play(); } catch (error) { if (this.interrupted(error, generation)) return; throw error; }
    if(generation!==this.generation||this.held){if(this.current!==entry||this.held)entry.el.pause();return;}
    const gapMs = this.endedAt ? Math.max(0, this.now() - this.endedAt) : 0; this.endedAt = 0;
    this.startTicker();
    this.emit('chunkstart', {chunk: entry.section, gapMs});
    this.emitProgress();
  }
  /* play() of a media element rejects with AbortError when pause() comes first (quick Play/Pause, a pause right at a
     section boundary). That is the user's pause, not a playback failure: nothing to report. */
  interrupted(error, generation) {
    return error?.name === 'AbortError' && (generation !== this.generation || this.held);
  }
  start(chunkId, atSec = 0) {
    this.held = false; this.endedAt = 0;
    /* a start inside a later piece: walk the pieces of the section until the one that holds the start time */
    let entry = this.entries.get(chunkId), at = atSec;
    while (entry && entry.next !== undefined && entry.next !== entry.section + 1 && at >= entry.durationSec) { const next = this.entries.get(entry.next); if (!next) break; at -= entry.durationSec; entry = next; }
    return this.begin(entry ? entry.id : chunkId, entry ? at : atSec);
  }

  silence() { if (this.current) { try { this.current.el.pause(); } catch {} } }
  onEnded(entry) {
    if (this.current !== entry) return;
    this.endedAt = this.now();
    if (entry.next === undefined || entry.next === entry.section + 1) this.emit('chunkend', {chunk: entry.section});      // the end of a section, not of its first piece
    if (this.current !== entry) return;                       // a listener started something else
    const nextId = entry.next ?? entry.id + 1, advance = () => {
      this.gapRun = null; if (this.current !== entry) return;
      const next = this.entries.get(nextId);
      if (next) this.begin(next.id, 0).catch(error => this.emit('error', {error}));
      else { this.waitingFor = nextId; this.emit('starved', {next: nextId}); }
    };
    /* Pause between sections: only at the end of a SECTION (not between the head and the tail of one). The ended section stays current (its last word stays marked); Pause keeps the rest of the wait
       as "advance on resume", Seek / Stop / a new start cancel it. */
    const sectionEnd = entry.next === undefined || entry.next === entry.section + 1;
    if (this.fx.gapMs > 0 && sectionEnd && !this.held) { this.gapRun = advance; this.gapTimer = this.delay(() => { this.gapTimer = null; advance(); }, this.fx.gapMs); }
    else if (this.fx.gapMs > 0 && sectionEnd) this.gapRun = advance;      // paused at the very end of a section: Resume continues with the next one at once
    else advance();
  }
  cancelGap() { if (this.gapTimer !== null) { this.cancelDelay(this.gapTimer); this.gapTimer = null; } this.gapRun = null; }
  get gapping() { return this.gapRun !== null; }

  pause() { this.generation++;this.held = true; if (this.gapTimer !== null) { this.cancelDelay(this.gapTimer); this.gapTimer = null; } if (!this.current) return; this.current.el.pause(); this.emitProgress(); }
  async resume() {
    this.held = false;
    if (this.gapRun) { const run = this.gapRun; this.gapRun = null; run(); return; }
    if (this.waitingFor !== null && this.entries.has(this.waitingFor)) { const id = this.waitingFor; this.waitingFor = null; return this.begin(id, 0); }
    if (!this.current) return;
    const entry=this.current,generation=++this.generation;
    if (this.context?.state === 'suspended') await this.context.resume().catch(() => {});
    if(generation!==this.generation||this.held||this.current!==entry)return;
    try { await entry.el.play(); } catch (error) { if (this.interrupted(error, generation)) return; throw error; }
    if(generation!==this.generation||this.held){if(this.current!==entry||this.held)entry.el.pause();return;}
    this.startTicker(); this.emitProgress();
  }
  stop() { this.held = false; this.generation++; this.cancelGap(); this.silence(); this.stopTicker(); this.current = null; this.waitingFor = null; this.endedAt = 0; }
  get playing() { return !!this.current && !this.current.el.paused && !this.current.el.ended; }
  get position() { return this.current ? {chunk: this.current.section, mediaTime: this.mediaTimeOf(this.current)} : null; }
  mediaTimeOf(entry) { return entry.offset + entry.el.currentTime * (entry.factor || 1); }

  setRate(value) { this.rate = clampRate(value); for (const entry of this.entries.values()) entry.el.playbackRate = this.elementRate(entry); }
  setVolume(value) { this.volume = clampVolume(value); for (const entry of this.entries.values()) this.applyTo(entry); }

  /* Voice shaping {pitch, bass, treble, gapMs}. Bass / treble / gap act at once on everything queued; a new pitch re-renders the queued sections from their kept PCM (the current one continues at the same
     point of the text, only the sound changes). */
  setFx(value) {
    const next = cleanFx({...this.fx, ...value}), pitchChanged = pitchFactor(next.pitch) !== this.factor;
    this.fx = next; this.factor = pitchFactor(next.pitch);
    if (!next.gapMs && this.gapTimer !== null) { const run = this.gapRun; this.cancelGap(); run?.(); }      // gap switched off while waiting: go on now
    for (const entry of this.entries.values()) { try { if (pitchChanged && entry.factor !== this.factor) this.rerender(entry); this.applyTo(entry); } catch (error) { this.emit('warning', {code: 'fx-failed', error}); } }      // shaping never stops the reading
    if (this.context?.state === 'suspended' && this.playing) this.context.resume().catch(() => {});      // a sound routed through the filters while it plays must not stall in a suspended context
  }
  rerender(entry) {
    const wasCurrent = entry === this.current, playing = wasCurrent && !entry.el.paused && !entry.el.ended, at = wasCurrent ? entry.el.currentTime * (entry.factor || 1) : 0, el = entry.el;
    const old = entry.url; entry.factor = this.factor;
    entry.url = this.urlApi.createObjectURL(new Blob([encodeWav(resamplePcm(entry.pcm, entry.factor), entry.sampleRate)], {type: 'audio/wav'}));
    el.src = entry.url; this.urlApi.revokeObjectURL(old);
    this.applyTo(entry);
    if (wasCurrent) { try { el.currentTime = Math.min(at, Math.max(0, entry.durationSec - 0.01)) / entry.factor; } catch {} if (playing) el.play?.()?.catch?.(() => {}); }
  }

  dropBefore(chunkId) { for (const [id, entry] of [...this.entries]) if (id < chunkId && entry !== this.current) { this.release(entry); this.entries.delete(id); } }
  clear() { this.stop(); for (const entry of this.entries.values()) this.release(entry); this.entries.clear(); }
  get buffered() { return this.entries.size; }
  release(entry) {
    try { entry.el.pause(); entry.el.removeAttribute?.('src'); entry.el.load?.(); } catch {}
    try { entry.source?.disconnect(); entry.gain?.disconnect(); } catch {}
    this.urlApi.revokeObjectURL(entry.url);
  }
  dispose() { this.disposed = true; this.clear(); try { this.context?.close(); } catch {} this.context = null; }

  emitProgress() { if (this.current) this.emit('progress', {chunk: this.current.section, mediaTime: this.mediaTimeOf(this.current), playing: !this.current.el.paused, epochMs: this.now()}); }
  startTicker() { if (!this.timer) this.timer = this.setTimer(() => this.emitProgress(), this.tickMs); }
  stopTicker() { if (this.timer) { this.clearTimer(this.timer); this.timer = null; } }
}
