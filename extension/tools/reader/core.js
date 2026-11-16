/* Notable Reader · Copyright (c) 2026 Burak Basci · MIT */
(() => {
  'use strict';
  const cleanText = text => String(text || '').replace(/\r\n?/g, '\n').replace(/\u00ad/g, '').replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // Chunking of releases up to 2.4.0 (every line break ended a section); only used to translate saved reading positions.
  function chunksForLegacy(input) {
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
  globalThis.NotableReaderCore = {cleanText, chunksForLegacy, fingerprint, textFromPdfItems};
})();
