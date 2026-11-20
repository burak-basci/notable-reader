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
  /* Letter-spaced print ("G r u n d g e s e t z", gesperrte Schrift: gesetze-im-internet.de, old legal and headline typography) comes out of pdf.js as one text item per word
     whose letters are separated by single spaces, so the reading would spell it. Conservative rule: only a visual line that carries real evidence (at least SPERR_MIN
     single-letter tokens inside items made only of single-character tokens), or sits next to such a line (a short last line "u n d"), is collapsed, and then only items made
     purely of single-character tokens with at least two letters: "z. B.", "a b c", "x y z", a table row "1 2 3 4 5 6 7" and every normal word stay as they are.
     Two or more spaces inside one item separate words ("G r u n d  f ü r" -> "Grund für"); otherwise the item is one word. */
  const SPERR_MIN = 6, SPERR_ITEM = /^\S(?: \S)+$/u, LETTER = /\p{L}/u;
  function sperrTokens(str) {
    if (typeof str !== 'string' || str.length < 3 || str.length > 400 || !/^\S/u.test(str) || !/\S$/u.test(str)) return 0;
    const words = str.split(/ {2,}/u);
    if (!words.every(word => SPERR_ITEM.test(word) || word.length === 1)) return 0;
    const letters = str.split(/ +/u).filter(token => token.length === 1 && LETTER.test(token)).length;
    return letters >= 2 ? letters : 0;
  }
  const sperrJoin = str => str.split(/ {2,}/u).map(word => word.replace(/ /gu, '')).join(' ');
  function despaceItems(items) {
    const strs = items.map(item => typeof item?.str === 'string' ? item.str : ''), lines = [];
    let current = null, y0 = null, h0 = 0;
    items.forEach((item, index) => {
      const y = Number(item?.transform?.[5]), height = Math.abs(Number(item?.height) || Number(item?.transform?.[3]) || 0);
      if (!current || !(Number.isFinite(y) && Number.isFinite(y0) && Math.abs(y - y0) <= Math.max(height, h0, 1) * .5)) { current = []; lines.push(current); y0 = y; h0 = height; }
      current.push(index);
    });
    const rich = lines.map(line => line.reduce((sum, index) => sum + sperrTokens(strs[index]), 0) >= SPERR_MIN);
    if (!rich.some(Boolean)) return strs;
    lines.forEach((line, n) => {
      if (!(rich[n] || rich[n - 1] || rich[n + 1])) return;
      for (const index of line) if (sperrTokens(strs[index])) strs[index] = sperrJoin(strs[index]);
    });
    return strs;
  }
  function textFromPdfItems(items) {
    const strs = despaceItems(items), paragraphs=[];let line='',previousY=null,previousHeight=0;
    const flush=()=>{if(line.trim())paragraphs.push(line.trim());line='';};
    for(const [position,item] of items.entries()){
      if(typeof item.str!=='string')continue;const str=strs[position];
      const y=Number(item.transform?.[5]),height=Math.abs(Number(item.height)||Number(item.transform?.[3])||0);
      if(Number.isFinite(y)&&previousY!==null&&Math.abs(y-previousY)>Math.max(height,previousHeight,1)*1.65)flush();
      line+=(line&&!/\s$/.test(line)&&str&&!/^\s/.test(str)?' ':'')+str;
      if(Number.isFinite(y)){previousY=y;previousHeight=height;}
    }
    flush();return paragraphs.join('\n\n');
  }
  globalThis.NotableReaderCore = {cleanText, chunksForLegacy, fingerprint, textFromPdfItems};
})();
