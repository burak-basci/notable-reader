/* beNotable! Reader playback · client side of the message API: a Pipeline that talks to the engine host through a
   runtime.connect port. Content script and Reader page use the same session code as with LocalPipeline (own code, MIT). */
import {Pipeline} from './pipeline.js';

let counter = 0;
export class RemotePipeline extends Pipeline {
  constructor({port, sid = `s${Date.now().toString(36)}${++counter}`}) {
    super();
    this.port = port; this.sid = sid; this.stateName = 'idle'; this.chunk = 0; this.closed = false;this.intent=0;
    port.onMessage.addListener(m => this.onMessage(m));
    port.onDisconnect.addListener(() => { this.closed = true; this.stateName = 'error'; this.emit('state', {state: 'error', code: 'host-lost'}); });
  }
  get state() { return this.stateName; }
  send(message) { if (!this.closed) this.port.postMessage({...message, sid: this.sid}); }
  onMessage(m) {
    if (!m || m.sid !== this.sid) return;                                  // other session / stray message
    const {t, sid, intent, ...detail} = m;
    if(['state','progress','chunkend','computing'].includes(t)&&Number.isSafeInteger(intent)&&intent<this.intent)return;
    if (t === 'state') this.stateName = detail.state;
    if (t === 'progress') this.chunk = detail.chunk;
    if (['state', 'timings', 'progress', 'download', 'chunkend', 'prefetch', 'computing', 'engine'].includes(t)) this.emit(t, detail);
  }
  async load({chunks, lang, voice, startChunk = 0, normalize, reading, compute}) {
    this.send({t: 'load', chunks: chunks.map((c, i) => ({id: c.id ?? i, text: c.text, words: (c.words || []).map(w => typeof w === 'string' ? w : w.text), ...(c.mute ? {mute: c.mute} : {}), ...(c.paragraphEnd === true ? {paragraphEnd:true} : {})})), lang, voice, startChunk, ...(reading ? {reading} : {}), ...(typeof normalize === 'boolean' ? {normalize} : {}), ...(['auto', 'gpu', 'cpu'].includes(compute) ? {compute} : {})});
  }
  async play({chunk = this.chunk, wordIndex, rate, volume} = {}) { this.send({t: 'play', chunk, wordIndex, rate, volume,intent:++this.intent}); }
  pause() { this.send({t: 'pause'}); }
  async resume() { this.send({t: 'resume'}); }
  stop() { this.send({t: 'stop',intent:++this.intent}); }
  async seek(chunk, wordIndex) { this.send({t: 'seek', chunk, wordIndex,intent:++this.intent}); }
  /* Sections currently on screen (indices into the loaded chunk list): prepared right after the next three. */
  setVisible(chunks) { this.send({t: 'visible', chunks}); }
  setRate(value) { this.send({t: 'setRate', value}); }
  setVolume(value) { this.send({t: 'setVolume', value}); }
  setFx(value) { this.send({t: 'setFx', value: {pitch: value?.pitch, bass: value?.bass, treble: value?.treble, gapMs: value?.gapMs}}); }
  /* The bar is open and an experimental voice is chosen: the host loads it and prepares the first sections silently (LocalPipeline.prewarm). */
  prewarm(chunk) { this.send({t: 'warm', chunk}); }
  /* The bar is open (an explicit use): the host prepares the page in the background from this place (LocalPipeline.engage). */
  engage({chunk = 0, word} = {}) { this.send({t: 'engage', chunk, ...(Number.isInteger(word) && word > 0 ? {word} : {})}); }
  /* Tab hidden / the user interacts with the page: background work waits (flags only). */
  setCompute(value) { if (['auto', 'gpu', 'cpu'].includes(value)) this.send({t: 'compute', value}); }
  setActivity({hidden, interacting, busy} = {}) { this.send({t: 'activity', ...(typeof hidden === 'boolean' ? {hidden} : {}), ...(interacting === true ? {interacting: true} : {}), ...(typeof busy === 'boolean' ? {busy} : {})}); }
  /* Sentences to prepare in advance into the host cache (guided explanation): [{text, words?}], voice spec, language, normalisation. */
  precompute(items, {voice, lang, normalize, ahead} = {}) { this.send({t: 'precompute', items: (items || []).slice(0, 64).map(i => ({text: String(i?.text ?? i), ...(Array.isArray(i?.words) ? {words: i.words.map(String)} : {})})), voice, ...(lang ? {lang} : {}), ...(typeof normalize === 'boolean' ? {normalize} : {}), ...(ahead === true ? {ahead: true} : {})}); }
  async setVoice(voice) { this.send({t: 'setVoice', voice}); }
  async ensureModel(modelId) { this.send({t: 'ensureModel', modelId}); }
  dispose() { if (!this.closed) { this.closed = true; try { this.port.disconnect?.(); } catch {} } }
}
