/* beNotable! Reader session · voice engine diagnosis (own code, MIT).
   Pure helpers for the technical diagnosis (popup, settings, help): they turn the numbers of the engine host into plain text lines and run the one-click speed measurement of the
   Experimental voices. Numbers only: no document text, URLs or titles. The measurement sentences are fixed texts of this file. */
export const BENCH_TEXT = {
  en: 'The morning train left the station right on time, and the platform slowly emptied behind it. Rain was falling softly on the old glass roof above the tracks.',
  de: 'Der Morgenzug verließ pünktlich den Bahnhof, und der Bahnsteig leerte sich langsam hinter ihm. Leiser Regen fiel auf das alte Glasdach über den Gleisen.',
};
const round = (value, digits = 1) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
/* Real-time factor = compute seconds per audio second (below 1 = faster than the speech is long). */
export const rtf = (ms, audioSec) => audioSec > 0 && Number.isFinite(ms) ? round(ms / 1000 / audioSec, 2) : null;
export const backendText = info => !info ? '' : info.backend === 'webgpu' ? ['GPU', info.gpu?.vendor, info.gpu?.architecture].filter(Boolean).join(' · ') : 'CPU (WASM)';

/* Per-frame view of the phase times of one Qwen3-TTS section (stats of engine/worker/qwen3tts.js). */
export function phaseSummary(stats) {
  if (!stats?.frames) return null;
  const frames = stats.frames, per = ms => round(ms / frames, 1);
  return {frames, audioSec: round(stats.audioSec, 1), totalMs: Math.round(stats.totalMs), talkerMsPerFrame: per(stats.talkerMs), predictorMsPerFrame: per(stats.predictorMs), predictorMsPerStep: stats.predictorRuns ? round(stats.predictorMs / stats.predictorRuns, 2) : null,
    decoderSharePercent: stats.totalMs ? Math.round(100 * stats.decodeMs / stats.totalMs) : null, predictorSharePercent: stats.totalMs ? Math.round(100 * stats.predictorMs / stats.totalMs) : null, prefillMs: Math.round(stats.prefillMs), frameBudgetMs: 80};
}

/* Words of the diagnosis per interface language (kept here: the lines are built from numbers, not from the UI catalog). English is the fallback.
   Technical names (GPU, CPU, WebGPU, JSPI, RTF, WASM) stay as they are in every language. */
const L = {
  en: {none: 'no voice loaded', worker: n => `${n} worker${n === 1 ? '' : 's'}`, load: 'load', yes: 'yes', no: 'no', cores: 'cores', last: (n, id) => `Last ${n} sections (${id})`, audio: (a, t) => `${a} s audio in ${t} s`, phases: 'Phases per section', frame: 'ms/frame', step: 'ms/step', budget: 'budget', speed: 'Speed test', one: '1 section', par: n => `${n} sections in parallel`, forAudio: (t, a) => `${t} s for ${a} s audio`, failed: 'failed'},
  de: {none: 'keine Stimme geladen', worker: n => `${n} Worker`, load: 'Laden', yes: 'ja', no: 'nein', cores: 'Kerne', last: (n, id) => `Letzte ${n} Abschnitte (${id})`, audio: (a, t) => `${a} s Audio in ${t} s`, phases: 'Phasen je Abschnitt', frame: 'ms/Frame', step: 'ms/Schritt', budget: 'Budget', speed: 'Geschwindigkeitstest', one: '1 Abschnitt', par: n => `${n} Abschnitte parallel`, forAudio: (t, a) => `${t} s für ${a} s Audio`, failed: 'fehlgeschlagen'},
  es: {none: 'ninguna voz cargada', worker: n => `${n} worker${n === 1 ? '' : 's'}`, load: 'carga', yes: 'sí', no: 'no', cores: 'núcleos', last: (n, id) => `Últimas ${n} secciones (${id})`, audio: (a, t) => `${a} s de audio en ${t} s`, phases: 'Fases por sección', frame: 'ms/fotograma', step: 'ms/paso', budget: 'presupuesto', speed: 'Prueba de velocidad', one: '1 sección', par: n => `${n} secciones en paralelo`, forAudio: (t, a) => `${t} s para ${a} s de audio`, failed: 'fallida'},
  fr: {none: 'aucune voix chargée', worker: n => `${n} worker${n === 1 ? '' : 's'}`, load: 'chargement', yes: 'oui', no: 'non', cores: 'cœurs', last: (n, id) => `Dernières ${n} sections (${id})`, audio: (a, t) => `${a} s d’audio en ${t} s`, phases: 'Phases par section', frame: 'ms/trame', step: 'ms/étape', budget: 'budget', speed: 'Test de vitesse', one: '1 section', par: n => `${n} sections en parallèle`, forAudio: (t, a) => `${t} s pour ${a} s d’audio`, failed: 'échec'},
  it: {none: 'nessuna voce caricata', worker: n => `${n} worker`, load: 'caricamento', yes: 'sì', no: 'no', cores: 'core', last: (n, id) => `Ultime ${n} sezioni (${id})`, audio: (a, t) => `${a} s di audio in ${t} s`, phases: 'Fasi per sezione', frame: 'ms/frame', step: 'ms/passo', budget: 'budget', speed: 'Test di velocità', one: '1 sezione', par: n => `${n} sezioni in parallelo`, forAudio: (t, a) => `${t} s per ${a} s di audio`, failed: 'non riuscito'},
  pt: {none: 'nenhuma voz carregada', worker: n => `${n} worker${n === 1 ? '' : 's'}`, load: 'carregamento', yes: 'sim', no: 'não', cores: 'núcleos', last: (n, id) => `Últimas ${n} seções (${id})`, audio: (a, t) => `${a} s de áudio em ${t} s`, phases: 'Fases por seção', frame: 'ms/quadro', step: 'ms/passo', budget: 'orçamento', speed: 'Teste de velocidade', one: '1 seção', par: n => `${n} seções em paralelo`, forAudio: (t, a) => `${t} s para ${a} s de áudio`, failed: 'falhou'},
};
/* The popup sets <html lang> to the interface language (i18n.translateDOM); a caller may pass the code explicitly. */
const uiLanguage = () => { const code = String(globalThis.document?.documentElement?.lang || '').slice(0, 2).toLowerCase(); return code; };
export const diagnosisWords = language => L[language] || L[uiLanguage()] || L.en;

/* The plain text block for the diagnosis. `report` = answer of the host ({loaded, caps, recent, bench?}); `label` = localized heading; `language` = interface language (default: the page's). */
export function engineLines(report, label = 'Voice engine', language) {
  if (!report) return [`${label}: -`];
  const w = diagnosisWords(language), lines = [], loaded = report.loaded, caps = report.caps;
  /* numbers in the interface language's own notation ("0,5 s" in German, "0.5 s" in English: R2-11); unknown language: English */
  const code = L[language] ? language : L[uiLanguage()] ? uiLanguage() : 'en', format = new Intl.NumberFormat(code, {maximumFractionDigits: 2, useGrouping: false});
  const n = value => Number.isFinite(value) ? format.format(value) : String(value ?? '?');
  lines.push(`${label}: ${loaded ? [backendText(loaded), w.worker(loaded.workers), `${w.load} ${n(round(loaded.initMs / 1000, 1))} s`].join(' · ') : w.none}`);
  if (caps) lines.push(`WebGPU ${caps.webgpu ? w.yes : w.no} · JSPI ${caps.jspi ? w.yes : w.no} · ${caps.cores ?? '?'} ${w.cores} · ${caps.memoryGB ?? '?'} GB`);
  const recent = report.recent;
  if (recent?.sections) lines.push(`${w.last(recent.sections, recent.modelId)}: RTF ${n(recent.rtf)} (${w.audio(n(recent.audioSec), n(round(recent.ms / 1000, 1)))})`);
  const phases = phaseSummary(report.lastPhases);
  if (phases) lines.push(`${w.phases}: talker ${n(phases.talkerMsPerFrame)} ${w.frame} · predictor ${n(phases.predictorMsPerFrame)} ${w.frame} (${n(phases.predictorMsPerStep)} ${w.step}, ${phases.predictorSharePercent} %) · decoder ${phases.decoderSharePercent} % · ${w.budget} ${phases.frameBudgetMs} ${w.frame}`);
  const bench = report.bench;
  if (bench?.ok) {
    lines.push(`${w.speed} (${bench.modelId}): ${w.load} ${n(round(bench.loadMs / 1000, 1))} s`);
    lines.push(`  ${w.one}: ${w.forAudio(n(round(bench.single.ms / 1000, 1)), n(round(bench.single.audioSec, 1)))}, RTF ${n(rtf(bench.single.ms, bench.single.audioSec))}`);
    if (bench.parallel) lines.push(`  ${w.par(bench.parallel.sections)}: ${w.forAudio(n(round(bench.parallel.ms / 1000, 1)), n(round(bench.parallel.audioSec, 1)))}, RTF ${n(rtf(bench.parallel.ms, bench.parallel.audioSec))}`);
    const measured = phaseSummary(bench.single.stats);
    if (measured) lines.push(`  talker ${n(measured.talkerMsPerFrame)} ${w.frame} · predictor ${n(measured.predictorMsPerFrame)} ${w.frame} · decoder ${measured.decoderSharePercent} %`);
  } else if (bench) lines.push(`${w.speed}: ${bench.code || w.failed}`);
  return lines;
}

/* Summary of the recent sections of one model (ms of compute vs seconds of audio), from the host's stats ring. */
export function recentSummary(stats, modelId, count = 8) {
  const mine = stats.filter(item => item.modelId === modelId && item.sec > 0).slice(-count);
  if (!mine.length) return null;
  const ms = mine.reduce((sum, item) => sum + item.ms, 0), sec = mine.reduce((sum, item) => sum + item.sec, 0);
  return {modelId, sections: mine.length, ms, audioSec: round(sec, 1), rtf: rtf(ms, sec)};
}

/* The one-click speed measurement (runs in the host, which owns the engine): load the voice, one section alone, then `parallelism` sections at once when the engine may use a second worker. */
export async function runBenchmark(engine, modelId, {now = () => performance.now(), parallelism = 2} = {}) {
  const started = now();
  await engine.warm(modelId).catch(() => false);
  const loadMs = engine.loaded?.initMs || now() - started;
  const language = (await import('../engine/models/registry.js')).getModel(modelId).lang?.split('-')[0] === 'de' ? 'de' : 'en', text = BENCH_TEXT[language];
  let generation = Math.max(engine.highest, engine.cancelledUpTo) + 1;
  const one = async () => { const t = now(), r = await engine.synthesize({modelId, text, generation: generation++, normalize: false, tier: 'near'}); return {ms: now() - t, audioSec: r.durationSec, stats: r.stats || null}; };
  const single = await one();
  const result = {ok: true, modelId, loadMs, single};
  const sections = Math.min(parallelism, engine.poolFor?.(modelId) || 1);
  if (sections > 1) { const t = now(), runs = await Promise.all(Array.from({length: sections}, one)); result.parallel = {sections, ms: now() - t, audioSec: runs.reduce((sum, run) => sum + run.audioSec, 0)}; }
  return result;
}
