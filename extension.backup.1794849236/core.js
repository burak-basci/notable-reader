/* Notable Reader · Copyright (c) 2026 Burak Basci · MIT */
(() => {
  'use strict';
  const cleanText = text => String(text || '').replace(/\r\n?/g, '\n').replace(/\u00ad/g, '').replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  function chunksFor(input) {
    const text = cleanText(input), chunks = [];
    // Short utterances avoid Chromium's long-utterance stop. All offsets refer
    // to the exact display string, including punctuation and non-Latin scripts.
    const re = /[^\n.!?。！？]+[.!?。！？]*(?:["'»”’)]*)|[\n.!?。！？]+/gu;
    for (const match of text.matchAll(re)) {
      let start = match.index, part = match[0];
      while (part.length) {
        const limit = 230;
        let end = Math.min(part.length, limit);
        if (end < part.length) {
          const space = part.lastIndexOf(' ', end);
          if (space > limit / 2) end = space + 1;
          // Never split a UTF-16 surrogate pair.
          if (/[\uD800-\uDBFF]/.test(part[end - 1])) end--;
        }
        const raw = part.slice(0, end), spoken = raw.trim();
        if (spoken) chunks.push({text: spoken, start: start + raw.indexOf(spoken), end: start + raw.indexOf(spoken) + spoken.length});
        start += end; part = part.slice(end);
      }
    }
    return {text, chunks};
  }
  function fingerprint(text) {
    let a = 2166136261;
    for (let i = 0; i < text.length; i++) { a ^= text.charCodeAt(i); a = Math.imul(a, 16777619); }
    return `${text.length}-${(a >>> 0).toString(16)}`;
  }
  function textFromPdfItems(items) {
    const paragraphs=[];let line='',previousY=null,previousHeight=0;
    const flush=()=>{if(line.trim())paragraphs.push(line.trim());line='';};
    for(const item of items){
      if(typeof item.str!=='string')continue;
      const y=Number(item.transform?.[5]),height=Math.abs(Number(item.height)||Number(item.transform?.[3])||0);
      if(Number.isFinite(y)&&previousY!==null&&Math.abs(y-previousY)>Math.max(height,previousHeight,1)*1.65)flush();
      line+=(line&&!/\s$/.test(line)&&item.str&&!/^\s/.test(item.str)?' ':'')+item.str;
      if(Number.isFinite(y)){previousY=y;previousHeight=height;}
    }
    flush();return paragraphs.join('\n\n');
  }
  class Reader {
    constructor({speech = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, onstate = () => {}, onword = () => {}, onposition = () => {}} = {}) {
      this.speech = speech; this.Utterance = Utterance; this.onstate = onstate; this.onword = onword; this.onposition = onposition;
      this.state = 'idle'; this.index = 0; this.offset = 0; this.generation = 0; this.rate = 1; this.volume = 1; this.voice = null; this.chunks = []; this.text = '';
    }
    load(text, index = 0) { this.stop(); Object.assign(this, chunksFor(text)); this.index = Math.max(0, Math.min(index, this.chunks.length - 1)); this.offset = 0; this.emit(); }
    emit(error = '') { this.onstate({state: this.state, index: this.index, count: this.chunks.length, error}); }
    play() {
      if (!this.chunks.length) return;
      if (!this.speech || !this.Utterance) { this.state = 'error'; this.emit('Dieser Browser bietet keine Sprachausgabe. Bitte einen aktuellen Chrome, Edge oder Safari verwenden.'); return; }
      if (!this.voice) { this.state = 'error'; this.emit('Keine passende Stimme verfügbar. Installiere eine Systemstimme oder aktiviere bewusst Online-Stimmen.'); return; }
      this.cancel(); this.state = 'playing'; this.emit(); this.speak();
    }
    cancel() { this.generation++; this.speech?.cancel(); }
    speak() {
      const chunk = this.chunks[this.index];
      if (!chunk || this.state !== 'playing') return;
      const gen = this.generation, startOffset = this.offset;
      const utterance = new this.Utterance(chunk.text.slice(startOffset));
      this.utterance = utterance; utterance.voice = this.voice; utterance.lang = this.voice.lang;
      utterance.rate = this.rate; utterance.volume = this.volume;
      this.onword({start: chunk.start + startOffset, end: chunk.start + startOffset + (chunk.text.slice(startOffset).match(/^\S+/u)?.[0].length || 1), sentence: this.index});
      this.onposition(this.index);
      utterance.onboundary = event => {
        if (gen !== this.generation || this.state !== 'playing') return;
        const relative = startOffset + Math.max(0, event.charIndex || 0);
        this.offset = relative;
        const tail = chunk.text.slice(relative), word = tail.match(/^\S+/u)?.[0] || '';
        this.onword({start: chunk.start + relative, end: chunk.start + relative + (event.charLength || word.length || 1), sentence: this.index});
      };
      utterance.onend = () => {
        if (gen !== this.generation || this.state !== 'playing') return;
        this.offset = 0;
        if (this.index + 1 < this.chunks.length) { this.index++; this.emit(); this.speak(); }
        else { this.state = 'ended'; this.emit(); this.onposition(0); }
      };
      utterance.onerror = event => {
        if (gen !== this.generation || this.state !== 'playing') return;
        this.state = 'error'; this.emit('Die gewählte Stimme konnte nicht sprechen. Bitte eine andere Stimme wählen.');
      };
      try { this.speech.speak(utterance); if(this.chunks[this.index+1])this.speech.prefetch?.(this.chunks[this.index+1].text,this.voice,this.rate); } catch { this.state = 'error'; this.emit('Die Sprachausgabe konnte nicht gestartet werden.'); }
    }
    pause() { if (this.state !== 'playing') return; this.cancel(); this.state = 'paused'; this.emit(); }
    toggle() { if (this.state === 'playing') this.pause(); else { if (this.state === 'ended') { this.index = 0; this.offset = 0; } this.play(); } }
    seek(index, offset = 0) {
      const resume = this.state === 'playing'; this.cancel(); this.offset = 0;
      this.index = Math.max(0, Math.min(Number(index) || 0, this.chunks.length - 1));
      const chunk = this.chunks[this.index];this.offset=Number.isSafeInteger(offset)&&offset>=0?Math.min(offset,Math.max(0,(chunk?.text.length||1)-1)):0;
      while(this.offset>0&&!/\s/u.test(chunk.text[this.offset-1]))this.offset--;
      this.state = resume ? 'playing' : 'paused'; this.emit(); this.onposition(this.index);
      if (chunk) this.onword({start: chunk.start + this.offset, end: chunk.start + this.offset + (chunk.text.slice(this.offset).match(/^\S+/u)?.[0].length || 1), sentence: this.index});
      if (resume) this.speak();
    }
    configure({rate = this.rate, volume = this.volume, voice = this.voice} = {}) {
      const resume = this.state === 'playing'; if (resume) this.pause();
      this.rate = Math.max(0.8, Math.min(4, Number(rate) || 1)); this.volume = Math.max(0, Math.min(1, Number(volume))); this.voice = voice;
      if (resume) this.play();
    }
    stop() { this.cancel(); this.state = 'idle'; this.offset = 0; this.emit(); }
  }
  globalThis.NotableReaderCore = {cleanText, chunksFor, fingerprint, textFromPdfItems, Reader};
})();
