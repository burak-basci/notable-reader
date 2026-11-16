/* beNotable! Reader · Hörbuchexport komplett im Browser, ohne Begleiter. MIT.
 * Eingabe: Text oder Kapitel. Ausgabe: eine Datei oder je Kapitel eine Datei (MP3/WAV).
 * Engine: TtsEngine (engine/, synthesize({modelId,text,generation}) -> {pcm,sampleRate}) oder die
 * bisherige LocalModels (synthesize(id,text,1) -> {samples,sampleRate}); beides wird erkannt. */
import { chunkText, normalizeChapters } from './text.mjs';
import { BLOCK, pcm16, waveHeader, bytesOf, checkSynthesis, WAV_MAX_SAMPLES } from './pcm.mjs';
import { audiobookFilename, chapterFilenames } from './files.mjs';
import { makeSink, BufferedOutput, storageError } from './sink.mjs';
import { createMp3Encoder } from './mp3.mjs';
import { id3Tag } from './id3.mjs';
import {readingChanged,prepareReadingSpeech,synthesizeReading} from '../playback/reading-rules.js';

export const abortError = () => new DOMException('Hörbuchexport abgebrochen. Es wurde keine fertige Datei gespeichert.', 'AbortError');
const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav' };
const yieldToLoop = () => new Promise(r => setTimeout(r, 0));
/* Error with a stable code; the page translates the code through the locale table. */
const coded = (code, message) => Object.assign(new Error(message), { code });
/* One generation sequence for every export of this page: the engine outlives an exporter, and a cancelled run marks
   its number as cancelled there, so a fresh exporter must never start again at 1. */
let exportGeneration = 0;
function nextExportGeneration(engine) {
  const seen = [engine?.highest, engine?.cancelledUpTo].filter(Number.isFinite);
  exportGeneration = Math.max(exportGeneration + 1, ...seen.map(n => n + 1));
  return exportGeneration;
}

function adaptEngine(engine) {
  if (typeof engine?.synthesize !== 'function') throw new TypeError('Lokale KI-Stimmen fehlen.');
  const modern = typeof engine.cancel === 'function' && typeof engine.install === 'function';
  return {
    installed: async id => { const set = typeof engine.installed === 'function' ? await engine.installed() : engine.installed; return set?.has?.(id) === true; },
    synth: (modelId, text, generation, options={}) => modern ? engine.synthesize({ modelId, text, generation,...options }) : engine.synthesize(modelId, text, 1),
    /* owner: this run only, never the read-aloud session that shares the engine */
    cancel: (generation, owner) => modern ? engine.cancel(generation, { owner }) : engine.cancelSynthesis?.(),
    source: engine,
  };
}
function raceAbort(work, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const stop = () => reject(abortError());
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

export class AudiobookExporter {
  constructor({ engine }) { this.engine = adaptEngine(engine); this.running = false; this.committing = false; this.controller = null; this.generation = 0; }
  // Nach dem atomaren Abschluss einer Datei wirkt Abbrechen nicht mehr (kein falsches „nichts gespeichert“).
  cancel() { if (this.running && !this.committing) this.controller?.abort(); }

  async export({ text, chapters, detectChapters = false, title = 'Hörbuch', modelId, format = 'mp3', split = 'single', announceChapters = false,
    kbps = 64, signal, onProgress = () => {}, sink, sinkFor, lookahead = true, storage,reading,normalize=true,lang='' } = {}) {
    if (this.running) throw coded('export-busy', 'Ein Hörbuchexport läuft bereits.');
    this.running = true;                  // sofort belegen: auch die async Prüfungen unten sind Teil des Laufs
    const refuse = async error => { this.running = false; await sink?.abort?.().catch(() => {}); throw error; };
    if (!MIME[format]) return refuse(coded('export-format', 'Bitte MP3 oder WAV als Audioformat wählen.'));
    if (!['single', 'chapters'].includes(split)) return refuse(new Error('Ungültiger Exportmodus.'));
    let list; try { list = normalizeChapters({ text, chapters, title, detect: detectChapters }); } catch (e) { return refuse(e); }
    if (typeof modelId !== 'string' || !(await this.engine.installed(modelId))) return refuse(coded('not-installed', 'Für Audiodateien bitte zuerst eine lokale KI-Stimme ausdrücklich herunterladen. Gerätestimmen lassen sich nicht als Datei speichern.'));
    if (signal?.aborted) return refuse(abortError());

    const controller = this.controller = new AbortController(), active = controller.signal;
    const generation = this.generation = nextExportGeneration(this.engine.source);
    const onOuter = () => { if (!this.committing) controller.abort(); }; signal?.addEventListener('abort', onOuter, { once: true });
    const onStop = () => this.engine.cancel(generation, controller); active.addEventListener('abort', onStop, { once: true });
    const check = () => { if (active.aborted) throw abortError(); };

    const mime = MIME[format], totalCharacters = list.reduce((s, c) => s + c.text.length, 0);
    const names = split === 'chapters' ? chapterFilenames(list, format) : [audiobookFilename(title, format)];
    const done = [];                       // fertige Ausgabedateien
    let cur = null;                        // aktuelle Ausgabe
    let completedChunks = 0, totalChunks = 0, processedCharacters = 0, sampleRate = 0, chapterIndex = 0, totalSamples = 0;
    const progress = (phase, message) => { try { onProgress({ phase, message, completedChunks, totalChunks, processedCharacters, totalCharacters, chapterIndex, chapterCount: list.length, chapterTitle: list[chapterIndex]?.title, fileIndex: done.length, fileCount: names.length, bytes: (cur?.output.bytes || 0) + done.reduce((s, f) => s + f.bytes, 0), duration: sampleRate ? totalSamples / sampleRate : 0, percent: phase === 'done' ? 100 : Math.min(99, Math.floor(processedCharacters / totalCharacters * 100)) }); } catch { /* Ein Statushandler darf die Audiodatei nicht beschädigen. */ } };

    // Aufgabenliste lazy: nie das ganze Buch als Abschnittsarray.
    function* tasks() {
      for (let ci = 0; ci < list.length; ci++) {
        const outIndex = split === 'chapters' ? ci : 0;
        if (announceChapters) yield { ci, outIndex, text: list[ci].title, announce: true, end: 0 };
        const chapter=list[ci].text,custom=readingChanged(reading),offset=list.slice(0, ci).reduce((s, c) => s + c.text.length, 0);
        const parts=custom?chapter.split(/\n[ \t]*\n/u):[chapter];let at=0;
        for(const part of parts){const partAt=chapter.indexOf(part,at);at=partAt+part.length;for(const chunk of chunkText(part)){
          const prepared=custom?prepareReadingSpeech(chunk,lang,{reading,normalize}):null;
          if(prepared&&!prepared.words.length)continue;
          yield {ci,outIndex,...chunk,start:partAt+chunk.start,end:partAt+chunk.end,offset,prepared,paragraphEnd:custom&&chunk.end===part.trimEnd().length};
        }}
      }
    }
    const open = async outIndex => {
      const supplied = split === 'chapters' ? await sinkFor?.(names[outIndex], outIndex) : sink;
      const store = await makeSink(supplied, mime, { forceKind: storage });
      return { outIndex, store, output: new BufferedOutput(store), encoder: null, samples: 0, rate: 0, chapters: [], supplied: !!supplied };
    };
    const close = async () => {
      const o = cur; cur = null;
      if (o.encoder) await o.output.write(o.encoder.flush());
      await o.output.flush(); check();
      if (format === 'wav') await o.store.patch(waveHeader(o.samples, o.rate)); check();
      this.committing = true;           // ab hier ist der Dateiabschluss die Commit-Grenze
      progress('saving', 'Das Hörbuch wird abgeschlossen …');
      let blob = await o.store.finish(), bytes = o.output.bytes;
      if (blob && format === 'mp3') { const tag = id3Tag({ title: split === 'chapters' ? list[o.outIndex].title : title, chapters: o.chapters }); if (tag.length) { blob = new Blob([tag, blob], { type: mime }); bytes += tag.length; } }
      done.push({ filename: names[o.outIndex], mime, bytes, duration: o.samples / o.rate, sampleRate: o.rate, samples: o.samples, storage: o.store.kind, blob, cleanup: o.store.cleanup, chapters: o.chapters, savedDirect: o.supplied });
      this.committing = false;
    };

    try {
      progress('preparing', 'Der vollständige Text wird für den lokalen Export vorbereitet …');
      for (const t of tasks()) { if (!t.announce) totalChunks++; if (totalChunks % 2000 === 0) { await yieldToLoop(); check(); } }
      if (!totalChunks) throw new Error('Der Text enthält keine vorlesbaren Zeichen.');
      check();

      const iterator = tasks(), start = () => { const n = iterator.next(); if (n.done) return null; const task=n.value,prepared=task.prepared;const synth=async({text,words})=>{check();const result=await this.engine.synth(modelId,text,generation,{normalize:prepared?false:normalize,lang,owner:controller,...(words?{words}:{})});return {...result,pcm:result.pcm??result.samples};};const work=prepared?synthesizeReading(prepared,synth,{paragraphEnd:task.paragraphEnd}):synth({text:task.text});const p = raceAbort(work, active); p.catch(() => {}); return { task, p }; };
      let next = start();
      while (next) {
        const { task, p } = next; check();
        progress('synthesizing', `Abschnitt ${completedChunks + 1} von ${totalChunks} wird auf diesem Gerät gesprochen …`);
        const result = await p; check();
        next = lookahead ? start() : null;   // nächsten Abschnitt synthetisieren, während dieser kodiert wird
        const { pcm, rate } = checkSynthesis(result, task.text, sampleRate);
        if (cur && cur.outIndex !== task.outIndex) await close();
        if (!cur) {
          cur = await open(task.outIndex); check();
          if (format === 'wav') { await cur.output.write(waveHeader(0, 22050)); await cur.output.flush(); }
        }
        if (!sampleRate) sampleRate = rate;
        if (!cur.rate) { cur.rate = rate; if (format === 'mp3') cur.encoder = await createMp3Encoder(rate, kbps); }
        if (format === 'wav' && cur.samples + pcm.length > WAV_MAX_SAMPLES) throw new Error('WAV-Dateien sind auf knapp 4 GiB begrenzt. Bitte das platzsparende MP3-Format wählen oder je Kapitel exportieren.');
        chapterIndex = task.ci;
        let entry = cur.chapters.at(-1);
        if (!entry || entry.index !== task.ci) { entry = { index: task.ci, title: list[task.ci].title, startSec: cur.samples / rate, endSec: cur.samples / rate }; cur.chapters.push(entry); }
        progress('encoding', `Abschnitt ${completedChunks + 1} von ${totalChunks} wird als ${format.toUpperCase()} gespeichert …`);
        for (let off = 0, block = 0; off < pcm.length; off += BLOCK, block++) {
          check(); const ints = pcm16(pcm.subarray(off, off + BLOCK));
          await cur.output.write(cur.encoder ? cur.encoder.encodeBuffer(ints) : bytesOf(ints));
          if (block % 32 === 31) { await yieldToLoop(); check(); }
        }
        cur.samples += pcm.length; totalSamples += pcm.length; entry.endSec = cur.samples / rate;
        if (!task.announce) { completedChunks++; processedCharacters = task.offset + task.end; }
        progress('synthesizing', `${completedChunks} von ${totalChunks} Abschnitten vollständig verarbeitet.`);
        if (!next) next = start();
      }
      check();
      if (!cur || completedChunks !== totalChunks) throw new Error('Der vollständige Buchtext konnte nicht verarbeitet werden.');
      await close(); processedCharacters = totalCharacters;
      const result = { files: done.map(({ savedDirect, ...f }) => f), format, split, totalChunks, completedChunks, totalCharacters, duration: totalSamples / sampleRate, sampleRate };
      progress('done', 'Das vollständige Hörbuch ist fertig.');
      return result;
    } catch (error) {
      if (cur) await cur.store.discard().catch(() => {}); else await sink?.abort?.().catch(() => {});
      for (const f of done) if (!f.savedDirect) await f.cleanup?.().catch(() => {});
      const failure = active.aborted ? abortError() : storageError(error);
      if (failure && typeof failure === 'object') failure.savedFiles = done.filter(f => f.savedDirect).map(f => f.filename);
      progress(failure.name === 'AbortError' ? 'aborted' : 'error', failure.message); throw failure;
    } finally { signal?.removeEventListener('abort', onOuter); active.removeEventListener('abort', onStop); this.running = false; this.committing = false; this.controller = null; }
  }
}
