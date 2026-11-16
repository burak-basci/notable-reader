/* beNotable! Reader playback · host side of the message API (runtime.connect port "notable-pipe", one port per session).
   Commands come in, state/timings/progress/download events go out; JSON only, no document text leaves the extension.
   The port is chrome.runtime.Port-shaped: postMessage, onMessage.addListener, onDisconnect.addListener (own code, MIT). */
import {validReading} from './reading-rules.js';
import {DOWNLOAD_REASONS} from './pipeline.js';
const COMPUTE = ['auto', 'gpu', 'cpu'];      // the engine's compute paths (TtsEngine.setCompute)
export const PIPE_PORT = 'notable-pipe';
const isInt = (v, max = 1e7) => Number.isInteger(v) && v >= 0 && v <= max;
const isVoice = v => v && ['system', 'neural'].includes(v.kind) && typeof v.id === 'string' && v.id.length < 200;

/* Validation lives here so a hostile page script cannot crash the host: every command is checked before use. */
export function validateCommand(m, {count = Infinity} = {}) {
  if (!m || typeof m !== 'object' || typeof m.sid !== 'string' || m.sid.length > 64) return false;
  if(m.intent!==undefined&&(!Number.isSafeInteger(m.intent)||m.intent<0))return false;
  switch (m.t) {
    case 'load': return Array.isArray(m.chunks) && m.chunks.length <= 100000 && m.chunks.every(c => c && typeof c.text === 'string' && c.text.length <= 5000 && Array.isArray(c.words) && c.words.every(w => typeof w === 'string')) && typeof m.lang === 'string' && isVoice(m.voice) && isInt(m.startChunk ?? 0) && (m.normalize === undefined || typeof m.normalize === 'boolean') && (m.reading === undefined || validReading(m.reading)) && (m.compute === undefined || COMPUTE.includes(m.compute));
    case 'play': case 'seek': return isInt(m.chunk) && m.chunk < count && (m.wordIndex === undefined || isInt(m.wordIndex)) && (m.t === 'seek' || ((m.rate === undefined || Number.isFinite(m.rate)) && (m.volume === undefined || Number.isFinite(m.volume))));
    case 'warm': return isInt(m.chunk) && m.chunk < count;
    case 'engage': return isInt(m.chunk) && m.chunk < count && (m.word === undefined || isInt(m.word, 100000));      // the bar is open on this page: background look-ahead from here
    case 'compute': return COMPUTE.includes(m.value);      // setting "Rechenweg": auto | gpu | cpu
    case 'activity': return ['hidden', 'interacting', 'busy'].every(k => m[k] === undefined || typeof m[k] === 'boolean');      // tab hidden / user interaction (flags only)
    case 'precompute': return Array.isArray(m.items) && m.items.length <= 64 && m.items.every(i => i && typeof i.text === 'string' && i.text.length <= 5000 && (i.words === undefined || Array.isArray(i.words) && i.words.length <= 2000 && i.words.every(w => typeof w === 'string'))) && isVoice(m.voice) && m.voice.kind === 'neural' && (m.lang === undefined || typeof m.lang === 'string' && m.lang.length < 40) && (m.normalize === undefined || typeof m.normalize === 'boolean') && (m.ahead === undefined || typeof m.ahead === 'boolean');
    case 'visible': return Array.isArray(m.chunks) && m.chunks.length <= 400 && m.chunks.every(c => isInt(c)) && m.chunks.every(c => c < count);       // sections on screen (page report, look-ahead priority)
    case 'pause': case 'resume': case 'stop': return true;
    case 'setRate': case 'setVolume': return Number.isFinite(m.value);
    case 'setFx': return !!m.value && typeof m.value === 'object' && ['pitch', 'bass', 'treble', 'gapMs'].every(k => m.value[k] === undefined || Number.isFinite(m.value[k]));
    case 'setVoice': return isVoice(m.voice);
    case 'ensureModel': return typeof m.modelId === 'string' && m.modelId.length < 100;
    default: return false;
  }
}

export function servePort(port, {createPipeline, onSession = () => {}}) {
  let pipeline = null, sid = null, count = 0,intent=0;
  const send = message => { try { port.postMessage({...message, sid,intent}); } catch {} };
  const wire = p => {
    p.addEventListener('state', e => send({t: 'state', ...e.detail}));
    p.addEventListener('timings', e => send({t: 'timings', ...e.detail}));
    p.addEventListener('progress', e => send({t: 'progress', ...e.detail}));
    p.addEventListener('download', e => send({t: 'download', ...e.detail}));
    p.addEventListener('chunkend', e => send({t: 'chunkend', chunk: e.detail?.chunk}));
    p.addEventListener('computing', e => send({t: 'computing', next: e.detail?.next}));      // slower-than-real-time voice: the bar says "Berechnung laeuft" instead of a plain "Vorbereiten"
    p.addEventListener('engine', e => send({t: 'engine', modelId: e.detail?.modelId, backend: e.detail?.backend, gpu: e.detail?.gpu || null, initMs: e.detail?.initMs}));      // backend facts (GPU/CPU), no text
    p.addEventListener('prefetch', e => send({t: 'prefetch', index: e.detail?.index, tier: e.detail?.tier, phase: e.detail?.phase}));      // numbers only (diagnostics / tests)
  };
  const abort = new AbortController();
  port.onMessage.addListener(async m => {
    if (!validateCommand(m, {count})) { if (sid) send({t: 'state', state: 'error', code: 'bad-command'}); return; }
    try {
      if (m.t === 'load') {
        sid = m.sid; count = m.chunks.length;
        if (!pipeline) { pipeline = createPipeline(m.voice); wire(pipeline); }
        onSession(sid);
        return await pipeline.load({chunks: m.chunks.map((c, i) => ({id: c.id ?? i, text: c.text, words: c.words, ...(c.mute ? {mute: c.mute} : {}), ...(c.paragraphEnd === true ? {paragraphEnd:true} : {})})), lang: m.lang, voice: m.voice, startChunk: m.startChunk ?? 0, normalize: m.normalize !== false, reading: m.reading, ...(m.compute ? {compute: m.compute} : {})});
      }
      if (m.t === 'precompute') {      // may come before the first load (the guided explanation knows its sentences before it speaks the first)
        if (sid && m.sid !== sid) return;
        sid = m.sid; if (!pipeline) { pipeline = createPipeline(m.voice); wire(pipeline); } onSession(sid);
        return void pipeline.precompute?.(m.items.map(i => ({text: i.text, ...(i.words ? {words: i.words} : {})})), {voice: m.voice, ...(m.lang ? {lang: m.lang} : {}), ...(typeof m.normalize === 'boolean' ? {normalize: m.normalize} : {}), ...(m.ahead === true ? {ahead: true} : {})});
      }
      if (!pipeline || m.sid !== sid) return;
      if(Number.isSafeInteger(m.intent)&&m.intent<intent)return;
      if(Number.isSafeInteger(m.intent))intent=m.intent;
      switch (m.t) {
        case 'play': return await pipeline.play({chunk: m.chunk, wordIndex: m.wordIndex, rate: m.rate, volume: m.volume});
        case 'seek': return await pipeline.seek(m.chunk, m.wordIndex);
        case 'visible': return pipeline.setVisible?.(m.chunks);
        case 'warm': return pipeline.prewarm?.(m.chunk);
        case 'engage': return pipeline.engage?.({chunk: m.chunk, word: m.word});
        case 'activity': return pipeline.setActivity?.({hidden: m.hidden, interacting: m.interacting, busy: m.busy});
        case 'compute': return pipeline.setCompute?.(m.value);
        case 'pause': return pipeline.pause();
        case 'resume': return await pipeline.resume();
        case 'stop': return pipeline.stop();
        case 'setRate': return pipeline.setRate(m.value);
        case 'setVolume': return pipeline.setVolume(m.value);
        case 'setFx': return pipeline.setFx?.(m.value);
        case 'setVoice': return await pipeline.setVoice(m.voice);
        case 'ensureModel': return await pipeline.ensureModel(m.modelId, {signal: abort.signal});
      }
    } catch (error) { if(Number.isSafeInteger(m.intent)&&m.intent<intent)return;if (error?.name !== 'AbortError') send({t: 'state', state: 'error', code: 'host-failed', ...(DOWNLOAD_REASONS.includes(error?.code) ? {reason: error.code} : {})}); }
  });
  port.onDisconnect.addListener(() => { abort.abort(); pipeline?.dispose(); pipeline = null; });
  return {get pipeline() { return pipeline; }};
}
