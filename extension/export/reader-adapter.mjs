/* beNotable! Reader · Export: bridges the reader page (exporter.exportBook) to the export module (OPFS, chapters/ID3, windows-safe names). MIT. */
import {AudiobookExporter} from './index.mjs';
const MESSAGES = {preparing: 'Hörbuch wird vorbereitet …', synthesizing: 'Hörbuch wird lokal berechnet …', encoding: 'Audio wird kodiert …', saving: 'Datei wird gespeichert …', done: 'Hörbuch ist fertig.', aborted: 'Export abgebrochen.', error: 'Der Export ist fehlgeschlagen.'};
export class ReaderAudiobookExport {
  constructor({models}) { this.models = models; this.exporter = null; }
  async exportBook({text, modelId, format = 'mp3', title = 'Hörbuch', signal, onProgress = () => {},reading,normalize=true,lang=''} = {}) {
    if (this.exporter) throw Object.assign(new Error('Ein Hörbuchexport läuft bereits.'), {code: 'export-busy'});
    const exporter = this.exporter = new AudiobookExporter({engine: this.models.engine});
    try {
      const result = await exporter.export({text, title, modelId, format, split: 'single', detectChapters: true, signal,reading,normalize,lang, onProgress: e => onProgress({...e, message: MESSAGES[e.phase] || MESSAGES.synthesizing})});
      const file = result.files[0];
      let historySaved=false,historyError='';
      if(['chrome-extension:','moz-extension:'].includes(globalThis.location?.protocol)&&file.blob){try{const {saveAudio}=await import('../library/store.mjs');await saveAudio({blob:file.blob,title,voice:modelId,format,filename:file.filename});historySaved=true;}catch(error){historyError=error?.code||'library_storage_failed';}}
      return {blob: file.blob, filename: file.filename, bytes: file.bytes, duration: file.duration, sampleRate: file.sampleRate, chapters: file.chapters, cleanup: file.cleanup,historySaved,historyError};
    } finally {
      this.exporter = null;
      /* the file view's engine exists only for the export: free its model now instead of holding it until the tab closes */
      this.models.engine?.terminate?.();
    }
  }
  cancel() { this.exporter?.cancel(); }
}
