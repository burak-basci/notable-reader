/* beNotable! Reader playback · speaks with the system voice until the neural voice has its first chunk, then hands
   over at the next chunk boundary. Never silent while a model warms up; falls back to the system voice when the
   neural path fails (own code, MIT). `neural` needs ready(chunk)/warm(chunk) (LocalPipeline), `speech` autoAdvance=false. */
import {Pipeline} from './pipeline.js';

export class HybridPipeline extends Pipeline {
  constructor({neural, speech, graceMs = 400, setTimer = setTimeout, clearTimer = clearTimeout}) {
    super();
    Object.assign(this, {neural, speech, graceMs, setTimer, clearTimer});
    this.active = null; this.chunk = 0; this.chunks = 0; this.rate = 1; this.volume = 1; this.playing = false; this.stateName = 'idle'; this.neuralDead = false;
    for (const type of ['timings', 'progress', 'download']) neural.addEventListener(type, e => this.emit(type, e.detail));
    neural.addEventListener('state', e => this.onNeuralState(e.detail));
    speech.addEventListener('state', e => { if (this.active === speech) this.relay(e.detail); });
    speech.addEventListener('word', e => this.emit('word', e.detail));
    speech.addEventListener('chunkend', e => this.onSpeechChunkEnd(e.detail.chunk));
  }
  get state() { return this.stateName; }
  get activeKind() { return this.active === this.neural ? 'neural' : this.active === this.speech ? 'system' : 'none'; }
  relay(detail) { this.stateName = detail.state; this.emit('state', detail); }
  onNeuralState(detail) {
    if (detail.state === 'error' && !this.neuralDead && this.playing) {          // neural path failed: keep reading with the system voice
      this.neuralDead = true; this.switchTo(this.speech, this.neuralChunk());
    } else if (this.active === this.neural) { if (detail.state === 'playing') this.chunk = this.neural.chunk; this.relay(detail); }
  }
  neuralChunk() { return this.neural.chunk ?? this.chunk; }
  async load(request) {
    this.chunks = request.chunks.length; this.chunk = request.startChunk || 0; this.neuralDead = false; this.active = null; this.playing = false;
    await Promise.all([this.neural.load(request), this.speech.load(request)]);
  }
  async play({chunk = this.chunk, wordIndex, rate, volume} = {}) {
    if (rate !== undefined) this.rate = rate; if (volume !== undefined) this.volume = volume;
    this.chunk = chunk; this.playing = true;
    this.neural.setRate(this.rate); this.neural.setVolume(this.volume); this.speech.setRate(this.rate); this.speech.setVolume(this.volume);
    if (!this.neuralDead && await this.neural.modelReady()) {
      this.neural.warm(chunk);
      if (await this.waitReady(chunk)) return this.switchTo(this.neural, chunk, wordIndex);
    }
    await this.switchTo(this.speech, chunk, wordIndex);
  }
  waitReady(chunk) {
    if (this.neural.ready(chunk)) return true;
    return new Promise(resolve => {
      const done = value => { this.clearTimer(timer); this.neural.removeEventListener('timings', onTimings); resolve(value); };
      const onTimings = () => { if (this.neural.ready(chunk)) done(true); };
      const timer = this.setTimer(() => done(false), this.graceMs);
      this.neural.addEventListener('timings', onTimings);
    });
  }
  async switchTo(target, chunk, wordIndex) {
    const other = target === this.neural ? this.speech : this.neural;
    if (this.active && this.active !== target) other.stop?.();
    if (other === this.neural && this.active !== target) this.neural.pause();     // keep warmed chunks, silence neural
    this.active = target; this.chunk = chunk;
    await target.play({chunk, wordIndex, rate: this.rate, volume: this.volume});
  }
  /* System voice finished a chunk: continue with the neural voice as soon as it has the next chunk. */
  async onSpeechChunkEnd(chunk) {
    if (this.active !== this.speech || !this.playing) return;
    const next = chunk + 1;
    if (next >= this.chunks) { this.playing = false; return this.relay({state: 'ended'}); }
    this.neural.warm(next);
    if (!this.neuralDead && this.neural.ready(next)) await this.switchTo(this.neural, next); else await this.switchTo(this.speech, next);
  }
  pause() { this.active?.pause(); this.playing = false; }
  async resume() { this.playing = true; await this.active?.resume(); }
  stop() { this.playing = false; this.neural.stop(); this.speech.stop(); this.active = null; this.relay({state: 'idle'}); }
  async seek(chunk, wordIndex) { return this.play({chunk, wordIndex}); }
  setVisible(chunks) { this.neural.setVisible?.(chunks); }
  setRate(value) { this.rate = value; this.neural.setRate(value); this.speech.setRate(value); }
  setVolume(value) { this.volume = value; this.neural.setVolume(value); this.speech.setVolume(value); }
  setFx(value) { this.neural.setFx(value); this.speech.setFx(value); }
  /* A system voice switches the neural side off without letting it auto-restart (and fail); a neural voice only
     records itself on the system side so the fallback speaks in the same language. */
  async setVoice(voice) {
    this.neuralDead = false; this.speech.voice = voice;
    if (voice.kind === 'neural') return this.neural.setVoice(voice);
    const chunk = this.active === this.neural ? this.neuralChunk() : this.chunk, was = this.playing;
    this.neural.stop(); this.neural.voice = voice; this.active = null;
    if (was) await this.play({chunk});
  }
  async ensureModel(modelId, options) { return this.neural.ensureModel(modelId, options); }
  dispose() { this.neural.dispose(); this.speech.dispose(); }
}
