/* Download menu (round 3, owner request): "What?" (whole page / from here / selection) and "As?" (listen: MP3, WAV; read: PDF, HTML), each format
   with a half-sentence benefit and an estimated length / size, the voice and tempo of an audio file, one "Download" button, then progress with
   percent, remaining time and Cancel, at the end "Done · Show file" or the error with "Retry". The bar (page overlay and file view) builds it inside
   its download dialog; the popup reaches the same dialog through the bar. Self-contained: the native bridge serializes this function. */
export const DOWNLOAD_MENU_CSS = `
.dlm:focus{outline:none}
.dlm{display:flex;flex-direction:column;gap:10px;min-width:0;color:var(--reader-ink);font:12px/1.35 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.dlm [hidden]{display:none!important}
.dlm-group{display:flex;flex-direction:column;gap:5px;min-width:0;margin:0;padding:0;border:0}
.dlm-label{margin:0;font-size:11px;font-weight:700;line-height:1.3;color:var(--reader-ink)}
.dlm-ranges{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border:1px solid var(--reader-field-line,var(--reader-line));border-radius:8px;overflow:hidden}
.dlm-range{min-width:0;min-height:30px;margin:0;padding:4px 6px;border:0;border-left:1px solid var(--reader-field-line,var(--reader-line));border-radius:0;background:var(--reader-paper);color:var(--reader-ink);font:inherit;font-weight:600;line-height:1.2;text-align:center;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dlm-range:first-child{border-left:0}
.dlm-range[aria-checked=true]{background:var(--reader-option-current,var(--reader-accent));color:var(--reader-option-current-ink,var(--reader-on-accent))}
.dlm-range:not([aria-checked=true]):not(:disabled):hover{background:var(--reader-option-hover,var(--reader-soft))}
.dlm-range:disabled,.dlm-range[aria-disabled=true]{color:var(--reader-muted);cursor:default}
.dlm-why{margin:0;font-size:11px;color:var(--reader-muted)}
.dlm-range:focus-visible,.dlm-format:focus-visible,.dlm-action:focus-visible{outline:2px solid var(--reader-option-ring,var(--reader-accent));outline-offset:-2px}
.dlm-formats{display:flex;flex-direction:column;gap:2px}
.dlm-kind{margin:4px 0 0;font-size:10px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--reader-muted)}
.dlm-kind:first-child{margin-top:0}
.dlm-format{display:grid;grid-template-columns:16px minmax(0,1fr) auto;align-items:center;gap:2px 8px;width:100%;min-height:36px;margin:0;padding:5px 8px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--reader-ink);font:inherit;text-align:left;cursor:pointer}
.dlm-format:not(:disabled):hover{background:var(--reader-option-hover,var(--reader-soft))}
.dlm-format[aria-checked=true]{border-color:var(--reader-option-ring,var(--reader-accent));background:var(--reader-option-hover,var(--reader-soft))}
.dlm-format:disabled{opacity:.55;cursor:default}
.dlm-dot{grid-row:1/3;width:14px;height:14px;box-sizing:border-box;border:1.5px solid var(--reader-field-line,var(--reader-muted));border-radius:50%}
.dlm-format[aria-checked=true] .dlm-dot{border:4.5px solid var(--reader-option-ring,var(--reader-accent))}
.dlm-name{font-weight:700;white-space:nowrap}
.dlm-hint{grid-column:2/4;min-width:0;font-size:11px;color:var(--reader-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dlm-size{justify-self:end;font-size:11px;font-variant-numeric:tabular-nums;color:var(--reader-muted);white-space:nowrap}
.dlm-voice{margin:0;font-size:11px;color:var(--reader-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dlm-action{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;min-height:32px;margin:0;padding:5px 10px;border:1px solid var(--reader-accent);border-radius:8px;background:var(--reader-accent);color:var(--reader-on-accent);font:inherit;font-weight:700;cursor:pointer}
.dlm-action:disabled{opacity:.5;cursor:default}
.dlm-action.dlm-secondary{background:var(--reader-paper);color:var(--reader-ink);border-color:var(--reader-field-line,var(--reader-line))}
.dlm-action svg{width:16px;height:16px;flex:none}
.dlm-status{display:flex;flex-direction:column;gap:6px}
.dlm-line{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.dlm-state{margin:0;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dlm-eta{margin:0;font-size:11px;color:var(--reader-muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.dlm-message{margin:0;font-size:11px;color:var(--reader-muted);overflow-wrap:anywhere}
.dlm-meter{display:block;box-sizing:border-box;width:100%;height:6px;margin:0;border:0;border-radius:3px;overflow:hidden;-webkit-appearance:none;appearance:none;background:var(--reader-line)}
.dlm-meter::-webkit-progress-bar{background:transparent}.dlm-meter::-webkit-progress-value{background:var(--reader-accent)}.dlm-meter::-moz-progress-bar{background:var(--reader-accent)}
.dlm-buttons{display:flex;gap:6px}.dlm-buttons>.dlm-action{flex:1 1 0}
`;

export function createDownloadMenu({document: doc = globalThis.document, t, number = (value, options) => new Intl.NumberFormat(undefined, options).format(value), send, announce = () => {}, glyph = () => ''}) {
  const el = (tag, cls, attrs = {}) => { const node = doc.createElement(tag); if (cls) node.className = cls; for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; };
  const RANGES = ['all', 'here', 'selection'], FORMATS = [['mp3', 'listen'], ['wav', 'listen'], ['pdf', 'read'], ['html', 'read']];
  const CHARS_PER_SECOND = 14;   // the session's own estimate at 1x (metrics, keyboard seconds); the file is synthesized at 1x
  const root = el('section', 'dlm', {tabindex: '-1'});
  const what = el('div', 'dlm-group', {role: 'group'}), whatLabel = el('p', 'dlm-label', {id: 'dlm-what'}); what.setAttribute('aria-labelledby', 'dlm-what');
  const ranges = el('div', 'dlm-ranges', {role: 'radiogroup', 'aria-labelledby': 'dlm-what'});
  const rangeButtons = RANGES.map(range => { const b = el('button', 'dlm-range', {type: 'button', role: 'radio', 'aria-checked': 'false'}); b.dataset.range = range; ranges.append(b); return b; });
  const why = el('p', 'dlm-why', {hidden: ''});   // shown text; screen readers hear it through the bar's one live region (announce)
  what.append(whatLabel, ranges, why);
  const as = el('div', 'dlm-group', {role: 'group'}), asLabel = el('p', 'dlm-label', {id: 'dlm-as'}); as.setAttribute('aria-labelledby', 'dlm-as');
  const formatList = el('div', 'dlm-formats', {role: 'radiogroup', 'aria-labelledby': 'dlm-as'});
  const kinds = {listen: el('p', 'dlm-kind', {'aria-hidden': 'true'}), read: el('p', 'dlm-kind', {'aria-hidden': 'true'})};
  const formatButtons = FORMATS.map(([format, kind], i) => {
    if (i === 0 || FORMATS[i - 1][1] !== kind) formatList.append(kinds[kind]);
    const b = el('button', 'dlm-format', {type: 'button', role: 'radio', 'aria-checked': 'false'}); b.dataset.format = format; b.dataset.kind = kind;
    b.innerHTML = '<span class="dlm-dot" aria-hidden="true"></span><span class="dlm-name"></span><span class="dlm-size"></span><span class="dlm-hint"></span>'; formatList.append(b); return b;
  });
  as.append(asLabel, formatList);
  const voice = el('p', 'dlm-voice');
  const start = el('button', 'dlm-action dlm-start', {type: 'button'});
  const status = el('div', 'dlm-status', {hidden: ''});
  const line = el('div', 'dlm-line'), state = el('p', 'dlm-state'), eta = el('p', 'dlm-eta'); line.append(state, eta);
  const meter = el('progress', 'dlm-meter', {max: '100', value: '0'}), message = el('p', 'dlm-message');
  const buttons = el('div', 'dlm-buttons'), cancel = el('button', 'dlm-action dlm-secondary dlm-cancel', {type: 'button'}), show = el('button', 'dlm-action dlm-show', {type: 'button'}), retry = el('button', 'dlm-action dlm-retry', {type: 'button'}), again = el('button', 'dlm-action dlm-secondary dlm-again', {type: 'button'});
  buttons.append(cancel, show, retry, again); status.append(line, meter, message, buttons);
  root.append(what, as, voice, start, status);

  let range = 'all', format = 'mp3', latest = {}, lastRequest = null, runningSince = 0, spoken = '', form = true;
  const job = () => latest.exportState || {};
  const chars = r => { const v = latest.exportRanges?.[r]; return Number.isFinite(v) && v > 0 ? v : 0; };
  const offered = r => r === 'all' ? chars('all') > 0 || Number(latest.sectionCount) > 0 : chars(r) > 0;   // a host without range lengths still offers the whole text
  const supported = f => !Array.isArray(latest.exportFormats) || latest.exportFormats.includes(f);
  const minutes = seconds => { const s = Math.max(1, Math.round(seconds)); if (s < 60) return number(s, {style: 'unit', unit: 'second', unitDisplay: 'short'}); if (s < 3600) return number(Math.round(s / 60), {style: 'unit', unit: 'minute', unitDisplay: 'short'}); return number(Math.floor(s / 3600), {style: 'unit', unit: 'hour', unitDisplay: 'short'}) + ' ' + number(Math.round(s / 60) % 60, {style: 'unit', unit: 'minute', unitDisplay: 'short'}); };
  const bytes = n => n >= 1e6 ? number(n / 1e6, {style: 'unit', unit: 'megabyte', unitDisplay: 'short', maximumFractionDigits: n >= 1e8 ? 0 : 1}) : number(Math.max(1, Math.round(n / 1e3)), {style: 'unit', unit: 'kilobyte', unitDisplay: 'short'});
  /* estimates: speech at 1x from the character count; MP3 64 kbit/s, WAV 16-bit mono at the voice's rate (Kokoro 24 kHz, Piper 22.05 kHz);
     the PDF is a page raster (about 1800 characters and 160 kB a page), the HTML file the text itself plus its frame */
  const estimate = (f, r) => {
    const n = chars(r); if (!n) return '';
    const seconds = n / CHARS_PER_SECOND, rate = /kokoro/i.test(String(latest.voice || '')) ? 24000 : 22050;
    if (f === 'mp3') return t('downloadEstimateAudio', {time: minutes(seconds), size: bytes(seconds * 8000)});
    if (f === 'wav') return t('downloadEstimateAudio', {time: minutes(seconds), size: bytes(seconds * rate * 2 + 44)});
    const pages = Math.max(1, Math.ceil(n / 1800));
    if (f === 'pdf') return t('downloadEstimatePages', {pages: number(pages), size: bytes(pages * 160e3)});
    return t('downloadEstimateSize', {size: bytes(n * 1.05 + 3e3)});
  };
  const focusables = group => [...group.querySelectorAll('[role=radio]')].filter(b => !b.disabled && !b.hidden && b.getAttribute('aria-disabled') !== 'true');
  const roving = (group, selected) => { for (const b of group.querySelectorAll('[role=radio]')) b.tabIndex = b === selected && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? 0 : -1; if (![...group.querySelectorAll('[role=radio]')].some(b => b.tabIndex === 0)) { const first = focusables(group)[0]; if (first) first.tabIndex = 0; } };
  const choose = (kind, value, focus) => { if (kind === 'range') range = value; else format = value; paint(); if (focus) (kind === 'range' ? rangeButtons : formatButtons).find(b => (b.dataset.range || b.dataset.format) === value)?.focus({preventScroll: true}); };
  const keys = (group, kind) => group.addEventListener('keydown', event => {
    const list = focusables(group), at = list.indexOf(group.getRootNode().activeElement); if (!list.length) return;
    const move = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key]; let next = null;
    if (move) next = list[(Math.max(0, at) + move + list.length) % list.length]; else if (event.key === 'Home') next = list[0]; else if (event.key === 'End') next = list.at(-1);
    if (!next) return; event.preventDefault(); event.stopPropagation(); choose(kind, next.dataset.range || next.dataset.format, true);
  });
  keys(ranges, 'range'); keys(formatList, 'format');
  /* an unavailable range stays visible and says why when it is chosen (round 4: "Auswahl" needs text marked on the page) */
  let whyKey = '';
  rangeButtons.forEach(b => b.addEventListener('click', () => { if (b.disabled) return; if (b.getAttribute('aria-disabled') === 'true') { whyKey = b.dataset.range === 'selection' ? 'downloadSelectionNone' : 'downloadHereNone'; paint(); announce(t(whyKey)); return; } whyKey = ''; choose('range', b.dataset.range, false); }));
  formatButtons.forEach(b => b.addEventListener('click', () => { if (!b.disabled) choose('format', b.dataset.format, false); }));
  const request = () => { if (start.disabled) return; lastRequest = {format, range}; runningSince = 0; send('export', {format, range}); };
  start.addEventListener('click', request);
  retry.addEventListener('click', () => { if (lastRequest) { runningSince = 0; send('export', lastRequest); } });
  cancel.addEventListener('click', () => send('cancelExport'));
  show.addEventListener('click', () => send('downloadResult'));
  again.addEventListener('click', () => { form = true; paint(); start.focus({preventScroll: true}); });

  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const setAttr = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };
  const setProp = (node, key, value) => { if (node[key] !== value) node[key] = value; };
  /* the status words of a job (also announced while the menu is closed) */
  const words = j => {
    const percent = Number.isFinite(j.percent) ? Math.max(0, Math.min(100, j.percent)) : 0;
    if (j.state === 'running') { const elapsed = (Date.now() - runningSince) / 1000; return {percent, state: t('downloadRunning', {percent: number(Math.round(percent))}), eta: runningSince && percent >= 2 && elapsed >= 3 ? t('downloadRemaining', {time: minutes(elapsed * (100 - percent) / percent)}) : '', note: Number(j.totalChunks) > 1 ? t('downloadParts', {done: number(Number(j.completedChunks) || 0), total: number(Number(j.totalChunks) || 0)}) : ''}; }
    if (j.state === 'complete') return {percent, state: t('downloadDone'), eta: '', note: String(j.filename || '').split(/[\\/]/).at(-1)};
    if (j.state === 'error') return {percent, state: t('downloadFailedTitle'), eta: '', note: t(j.errorKey === 'export_no_voice' ? 'export_no_voice' : 'downloadFailed')};
    if (j.state === 'cancelled') return {percent, state: t('downloadCancelled'), eta: '', note: ''};
    return {percent, state: '', eta: '', note: ''};
  };
  /* job bookkeeping on every state: start time, the form gives way to the status while a job runs or failed, one announcement per outcome */
  const track = () => {
    const j = job();
    if (j.state !== 'running') runningSince = 0; else if (!runningSince) runningSince = Date.now();
    if (j.state === 'running' || j.state === 'error') form = false;
    const key = j.state + '|' + (j.filename || '');
    if (key !== spoken) { const before = spoken; spoken = key; if (before && ['complete', 'error', 'cancelled'].includes(j.state)) { const w = words(j); announce([w.state, w.note].filter(Boolean).join(' · ')); } }
  };

  function paint() {
    const j = job(), running = j.state === 'running', kind = format === 'mp3' || format === 'wav' ? 'listen' : 'read';
    if (!offered(range)) range = RANGES.find(offered) || 'all';
    if (!supported(format)) format = FORMATS.map(f => f[0]).find(supported) || 'mp3';
    setText(whatLabel, t('downloadWhat')); setText(asLabel, t('downloadAs'));
    for (const b of rangeButtons) {
      const r = b.dataset.range, label = t({all: 'downloadRangeAll', here: 'downloadRangeHere', selection: 'downloadRangeSelection'}[r]);
      setText(b, label); setProp(b, 'disabled', running); setAttr(b, 'aria-disabled', String(!offered(r))); setAttr(b, 'aria-checked', String(r === range));
      setProp(b, 'title', r === 'selection' && !offered(r) ? t('downloadSelectionNone') : r === 'here' && !offered(r) ? t('downloadHereNone') : label);
    }
    roving(ranges, rangeButtons.find(b => b.dataset.range === range));
    if (whyKey && offered(whyKey === 'downloadSelectionNone' ? 'selection' : 'here')) whyKey = '';
    setText(why, whyKey ? t(whyKey) : ''); setProp(why, 'hidden', !whyKey);
    setText(kinds.listen, t('downloadListen')); setText(kinds.read, t('downloadRead'));
    for (const b of formatButtons) {
      const f = b.dataset.format, name = f.toUpperCase(), hint = t({mp3: 'downloadMp3Hint', wav: 'downloadWavHint', pdf: 'downloadPdfHint', html: 'downloadHtmlHint'}[f]), size = estimate(f, range);
      setText(b.querySelector('.dlm-name'), name); setText(b.querySelector('.dlm-hint'), hint); setText(b.querySelector('.dlm-size'), size);
      setProp(b, 'disabled', running || !supported(f)); setAttr(b, 'aria-checked', String(f === format));
      setAttr(b, 'aria-label', [t(b.dataset.kind === 'listen' ? 'downloadListen' : 'downloadRead') + ': ' + name, hint, size].filter(Boolean).join(', ')); setProp(b, 'title', hint);
    }
    roving(formatList, formatButtons.find(b => b.dataset.format === format));
    const voiceName = String(latest.voiceLabel || '').trim(), systemVoice = /^system:/.test(String(latest.voice || ''));
    const voiceText = systemVoice ? t('downloadSystemVoice') : t('downloadVoiceHint', {voice: voiceName, speed: number(1, {maximumFractionDigits: 2}) + '×'});
    setText(voice, voiceText); setProp(voice, 'title', voiceText);
    if (!start.firstChild) start.innerHTML = glyph('download') + '<span></span>'; setText(start.lastChild, t('downloadStart'));
    setProp(start, 'disabled', running || !offered(range) || !supported(format) || !(Number(latest.sectionCount) > 0 || chars('all') > 0));
    /* status: progress while running, the result (or the error) afterwards; the form returns with "Another file" */
    const active = ['running', 'complete', 'error', 'cancelled'].includes(j.state), showForm = form || !active;
    for (const node of [what, as, start]) setProp(node, 'hidden', !showForm);
    setProp(voice, 'hidden', !showForm || kind !== 'listen' || !voiceName);
    setProp(status, 'hidden', !active || showForm && !running);
    const w = words(j); setProp(meter, 'value', w.percent); setProp(meter, 'hidden', !running);
    setAttr(meter, 'aria-label', t('downloadProgress')); setAttr(meter, 'aria-valuetext', number(Math.round(w.percent)) + ' %');
    setText(state, w.state); setText(eta, w.eta); setText(message, w.note); setProp(message, 'title', w.note); setProp(eta, 'hidden', !w.eta); setProp(message, 'hidden', !w.note);
    setProp(cancel, 'hidden', !running); setProp(show, 'hidden', j.state !== 'complete' || j.resultReady !== true); setProp(retry, 'hidden', j.state !== 'error' || !lastRequest); setProp(again, 'hidden', running || showForm);
    setText(cancel, t('downloadCancel')); setText(show, t('downloadShow')); setText(retry, t('downloadRetry')); setText(again, t('downloadAnother'));
  }
  const shown = () => root.isConnected && root.getClientRects().length > 0;
  return {
    root,
    /* every bar state: bookkeeping always, drawing only while the menu is open (the bar updates on every spoken word) */
    update(next) { latest = next && typeof next === 'object' ? next : {}; track(); if (shown()) paint(); },
    /* on open: the form comes back unless a job runs, failed or holds a finished file; the first enabled control gets the focus */
    opened() { whyKey = ''; track(); const j = job(); if (!['running', 'error', 'complete'].includes(j.state)) form = true; paint(); },
    focusFirst() { const target = !start.hidden ? (focusables(ranges).find(b => b.getAttribute('aria-checked') === 'true') || focusables(ranges)[0] || focusables(formatList)[0] || (!start.disabled && start) || root) : [cancel, show, retry, again].find(b => !b.hidden) || root; target.focus({preventScroll: true}); },
    state: () => ({range, format, form, lastRequest})
  };
}
