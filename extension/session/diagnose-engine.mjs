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

/* The plain text block for the diagnosis. `report` = answer of the host ({loaded, caps, recent, bench?}); `label` = localized heading. */
export function engineLines(report, label = 'Voice engine') {
  if (!report) return [`${label}: -`];
  const lines = [], loaded = report.loaded, caps = report.caps;
  lines.push(`${label}: ${loaded ? [backendText(loaded), `${loaded.workers} worker${loaded.workers === 1 ? '' : 's'}`, `load ${round(loaded.initMs / 1000, 1)} s`].join(' · ') : 'no voice loaded'}`);
  if (caps) lines.push(`WebGPU ${caps.webgpu ? 'yes' : 'no'} · JSPI ${caps.jspi ? 'yes' : 'no'} · ${caps.cores ?? '?'} cores · ${caps.memoryGB ?? '?'} GB`);
  const recent = report.recent;
  if (recent?.sections) lines.push(`Last ${recent.sections} sections (${recent.modelId}): RTF ${recent.rtf} (${recent.audioSec} s audio in ${round(recent.ms / 1000, 1)} s)`);
  const phases = phaseSummary(report.lastPhases);
  if (phases) lines.push(`Phases per section: talker ${phases.talkerMsPerFrame} ms/frame · predictor ${phases.predictorMsPerFrame} ms/frame (${phases.predictorMsPerStep} ms/step, ${phases.predictorSharePercent} %) · decoder ${phases.decoderSharePercent} % · budget ${phases.frameBudgetMs} ms/frame`);
  const bench = report.bench;
  if (bench?.ok) {
    lines.push(`Speed test (${bench.modelId}): load ${round(bench.loadMs / 1000, 1)} s`);
    lines.push(`  1 section: ${round(bench.single.ms / 1000, 1)} s for ${round(bench.single.audioSec, 1)} s audio, RTF ${rtf(bench.single.ms, bench.single.audioSec)}`);
    if (bench.parallel) lines.push(`  ${bench.parallel.sections} sections in parallel: ${round(bench.parallel.ms / 1000, 1)} s for ${round(bench.parallel.audioSec, 1)} s audio, RTF ${rtf(bench.parallel.ms, bench.parallel.audioSec)}`);
    const measured = phaseSummary(bench.single.stats);
    if (measured) lines.push(`  talker ${measured.talkerMsPerFrame} ms/frame · predictor ${measured.predictorMsPerFrame} ms/frame · decoder ${measured.decoderSharePercent} %`);
  } else if (bench) lines.push(`Speed test: ${bench.code || 'failed'}`);
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
