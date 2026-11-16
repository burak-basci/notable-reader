/* beNotable! Reader · two blocks of the settings panel (own code, MIT): the shortcut editor and the backup of all settings (export / import).
   ONE implementation for the bar on a page, the file view / Focus Reader and the toolbar popup (they all mount this module into the settings panel of the one player surface,
   like mark-settings.mjs). Everything the blocks change goes through `onChange` / `onImport`, i.e. through the central configuration (config.mjs): they keep no state of their own.
   shadow: the surface shadow root. t(key): label lookup. get(): the settings. keyboard(): the keyboard layer of the surface (comboOf, commit, capture ...) or null.
   onChange(key, value): one setting. onImport(values): many settings at once (already validated). */
import {installReadingTools} from './reading-tools.mjs';
import {validateCombo, defaultCombo, conflictWith, detectPlatform} from '../platform/keycombo.mjs';
import {createFileApi} from './settings-file.mjs';
import {KEY_DEFAULTS, exportDocument, exportFileName, parseImport, resetPatch, MAX_IMPORT_BYTES} from '../config.mjs';

const CSS = '.kb-edit-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:2px}.kb-edit-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;min-width:0;padding:3px 0;border-top:1px solid var(--reader-line)}.kb-edit-row:first-child{border-top:0}' +
  '.kb-edit-name{flex:1 1 9em;min-width:0;overflow-wrap:anywhere}.kb-edit-row kbd{font:inherit;font-weight:600;padding:2px 7px;border:1px solid var(--reader-line);border-radius:6px;background:var(--reader-soft);white-space:nowrap}.kb-edit-row[data-custom=true] kbd{border-color:var(--reader-accent)}' +
  '.kb-edit-btn,.backup-btn{margin:0;padding:5px 10px;min-height:28px;border:1px solid var(--reader-line);border-radius:8px;background:var(--reader-soft);color:var(--reader-ink);font:inherit;font-size:.92em;cursor:pointer;white-space:nowrap}.kb-edit-btn:focus-visible,.backup-btn:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}' +
  '.kb-edit-btn:disabled{opacity:.45;cursor:default}.kb-edit-btn[data-recording=true]{border-color:var(--reader-accent);background:var(--reader-accent);color:var(--reader-on,#fff)}.kb-edit-group{margin:10px 0 0;font-weight:600}' +
  '.kb-edit-status,.backup-status{margin:8px 0 0;padding:6px 10px;border-radius:6px;border:1px solid var(--reader-line);background:var(--reader-soft);font-size:.92em}.kb-edit-status:empty,.backup-status:empty{visibility:hidden}.kb-edit-status,.backup-status{box-sizing:border-box;height:calc(2 * 1.4em + 14px);line-height:1.4;overflow-y:auto;overflow-x:hidden}.kb-edit-status{position:sticky;top:0;z-index:1;margin:0 0 8px;background:var(--reader-paper)}.kb-edit-row[data-active=true]{background:var(--reader-soft)}.kb-edit-status[data-level=error],.backup-status[data-level=error]{border-color:#c0392b}' +
  '.kb-edit-actions,.backup-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}.backup-block [hidden]{display:none!important}.backup-danger{border-color:#b42318!important;background:#b42318!important;color:#fff!important;font-weight:600}.backup-danger:focus-visible{outline:2px solid #b42318!important;outline-offset:2px}.backup-btn:disabled{opacity:.5;cursor:default}' +
  '.settings-modal{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.5)}.settings-modal-box{box-sizing:border-box;width:min(420px,100%);max-height:100%;overflow:auto;padding:16px 18px;border:1px solid var(--reader-line);border-radius:12px;background:var(--reader-paper);color:var(--reader-ink);box-shadow:0 16px 48px rgba(0,0,0,.45);font:inherit;line-height:1.5;white-space:normal;text-align:left}.settings-modal-box h3{margin:0 0 8px;font-size:1.1em}.settings-modal-box p{margin:0 0 14px}.settings-modal-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.settings-modal-actions button{margin:0;padding:7px 14px;min-height:34px;border:1px solid var(--reader-line);border-radius:8px;background:var(--reader-soft);color:var(--reader-ink);font:inherit;cursor:pointer}.settings-modal-actions button:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}.settings-modal-actions .backup-danger{background:#b42318;color:#fff}.settings-modal-actions .settings-modal-ok{background:var(--reader-accent);border-color:var(--reader-accent);color:var(--reader-on-accent,#fff)}' +
  /* G2e: success / hint messages are only announced (screen reader, same live region), never a permanent visible text; errors stay visible. A short "Reset" flash next to the button shows what happened. G2f: small heading above the red reset button */
  '.kb-edit-status:not([data-level=error]){position:absolute;box-sizing:border-box;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.kb-edit-flash{align-self:center;font-size:.92em;color:var(--reader-muted)}.kb-edit-flash:empty{display:none}' +
  '.backup-danger-zone{display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin:0}.backup-danger-title{margin:0;font-size:11px;font-weight:700;line-height:1.3;color:var(--reader-ink)}.backup-danger-zone .backup-actions{margin:0}';

export function installSettingsExtras(shadow, {t = key => key, get, keyboard = () => null, onChange, onImport, locales = null, appVersion = '', files = null} = {}) {
  const fileApi = files || createFileApi();
  const content = shadow?.querySelector('.settings-content');
  if (!content || content.querySelector('[data-settings-block=shortcuts],[data-settings-block=backup]')) return {sync() {}, nodes: []};
  const doc = shadow.ownerDocument || document, platform = detectPlatform(), nodes = [];
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const tt = (key, args = {}) => t(key, args);           // the host's t(key, params) fills {placeholders}; without params it would blank them
  const text = (node, key, args = {}) => { node.dataset.i18n = key; node.textContent = tt(key, args); return node; };
  const block = (key, titleKey, subKey) => {
    const fs = el('fieldset', 'settings-block'); fs.dataset.settingsBlock = key; const style = el('style'); style.textContent = CSS; const legend = el('legend'); text(legend, titleKey); fs.append(style, legend);
    if (subKey) { const sub = el('p', 'block-sub'); text(sub, subKey); fs.append(sub); }
    return fs;
  };

  /* -- shortcut editor ------------------------------------------------------------------------------------------------------------------------- */
  let shortcuts = null, list = null, status = null, cancelCapture = null, recordingId = null, message = null;
  let flash = null, flashTimer = 0;
  const SHORT = {kbEditResetDone: 'kbEditResetShort', kbEditSaved: 'kbEditSavedShort'};
  const say = (key, args, level = 'info') => {
    message = {key, args, level}; paintStatus();
    if (!flash) return; clearTimeout(flashTimer); const short = SHORT[key];
    flash.dataset.i18n = short || ''; flash.textContent = short ? tt(short) : '';
    if (short) flashTimer = setTimeout(() => { flash.textContent = ''; delete flash.dataset.i18n; }, 2600);
  };
  const paintStatus = () => { if (!status) return; if (!message) { status.textContent = ''; status.removeAttribute('data-level'); return; } status.dataset.level = message.level; status.textContent = tt(message.key, message.args || {}); };
  const keys = () => keyboard();
  /* ONE list: the Help panel of the bar and this editor both come from KEYMAP of player-surface.mjs. The Help shows what the bar of the current page can do right now, the editor shows ALL actions (also those whose button this surface does not have), so everything the Help names is editable here. */
  function renderList() {
    const kb = keys(); if (!kb || !list) return;
    const entries = kb.keymap, bindings = kb.bindings().keys, active = shadow.activeElement, ref = active && list.contains(active) ? [active.closest('[data-kb-row]')?.dataset.kbRow, active.dataset.kbChange !== undefined ? 'kbChange' : 'kbReset'] : null;
    list.replaceChildren(...entries.map(entry => {
      const id = entry[0], custom = Object.hasOwn(bindings, id), name = t(entry[3]), combo = kb.comboOf(id), shown = kb.comboLabel(combo);
      const row = el('li', 'kb-edit-row'); row.dataset.kbRow = id; row.dataset.custom = String(custom); row.dataset.active = String(recordingId === id);
      const label = el('span', 'kb-edit-name'); label.textContent = name;
      const key = el('kbd'); key.textContent = shown;
      const change = el('button', 'kb-edit-btn', {type: 'button'}); change.dataset.kbChange = id; change.textContent = recordingId === id ? t('kbEditPress') : t('kbEditChange'); change.dataset.recording = String(recordingId === id);
      change.setAttribute('aria-label', tt('kbEditChangeAria', {action: name, key: shown}));
      change.addEventListener('click', () => startRecording(id));
      const reset = el('button', 'kb-edit-btn', {type: 'button'}); reset.dataset.kbReset = id; reset.textContent = t('kbEditReset'); reset.disabled = !custom; reset.setAttribute('aria-label', tt('kbEditResetAria', {action: name}));
      reset.addEventListener('click', () => { stopRecording(); const next = {...kb.bindings().keys}; delete next[id];
        const back = defaultCombo(KEY_DEFAULTS[id]), taken = conflictWith(back, id, kb.keymap.map(e => [e[0], e[0] === id ? back : kb.comboOf(e[0])]));
        if (taken) { say('kbErr_duplicate', {key: kb.comboLabel(back), action: t(kb.keymap.find(e => e[0] === taken)[3])}, 'error'); renderList(); focusRow(id, 'kbReset'); return; } kb.commit({enabled: kb.bindings().enabled, keys: next}); say('kbEditResetDone', {action: name, key: kb.comboLabel(kb.comboOf(id))}); renderList(); focusRow(id, 'kbChange'); });
      row.append(label, key, change, reset); return row;
    }));
    shortcuts.querySelector('[data-kb-reset-all]').disabled = !Object.keys(bindings).length;
    if (ref?.[0]) focusRow(ref[0], ref[1]);
  }
  const focusRow = (id, which) => { const n = list.querySelector(`[data-kb-row="${id}"] [data-${which === 'kbChange' ? 'kb-change' : 'kb-reset'}]`) || list.querySelector(`[data-kb-row="${id}"] button`); n?.focus({preventScroll: true}); };
  function stopRecording() { cancelCapture?.(); cancelCapture = null; if (recordingId) { recordingId = null; renderList(); } }
  /* Recording: the next key press is swallowed and checked. A combination that is not allowed does NOT end the recording: the message under the tabs says why and the next key press is taken (Esc or Tab ends it). */
  function arm(id) {
    const kb = keys(); if (!kb) return;
    const name = t(kb.keymap.find(e => e[0] === id)[3]);
    const retry = (key, args) => { say(key, args, 'error'); renderList(); focusRow(id, 'kbChange'); arm(id); };
    cancelCapture = kb.capture(result => {
      cancelCapture = null;
      if (!result) { recordingId = null; say('kbEditCancelled', {action: name}); renderList(); focusRow(id, 'kbChange'); return; }
      const combo = result.combo, shown = combo ? kb.comboLabel(combo) : '';
      const why = combo ? validateCombo(combo, platform) : 'invalid';
      if (why) { retry('kbErr_' + why, {key: shown || result.code || '', action: name}); return; }
      const table = kb.keymap.map(entry => [entry[0], kb.comboOf(entry[0])]), other = conflictWith(combo, id, table);
      if (other) { retry('kbErr_duplicate', {key: shown, action: t(kb.keymap.find(e => e[0] === other)[3])}); return; }
      recordingId = null;
      const next = {...kb.bindings().keys}; if (combo === defaultCombo(KEY_DEFAULTS[id])) delete next[id]; else next[id] = combo;
      kb.commit({enabled: kb.bindings().enabled, keys: next}); say('kbEditSaved', {action: name, key: shown}); renderList(); focusRow(id, 'kbChange');
    }, {onModifier: mods => { const b = list?.querySelector(`[data-kb-row="${id}"] [data-kb-change]`); if (!b || recordingId !== id) return; if (!mods.length) { b.textContent = t('kbEditPress'); return; } const lab = kb.comboLabel([...mods, 'KeyA'].join('+')); b.textContent = lab.slice(0, lab.length - 1) + '…'; }});
  }
  function startRecording(id) {
    const kb = keys(); if (!kb) return;
    stopRecording(); recordingId = id; renderList(); focusRow(id, 'kbChange'); say('kbEditPressHint', {action: t(kb.keymap.find(e => e[0] === id)[3])});
    try { list.querySelector(`[data-kb-row="${id}"]`)?.scrollIntoView({block: 'nearest'}); } catch {}
    arm(id);
  }
  /* a click anywhere else than on the Change button of the row being recorded ends the recording (a recording that stays armed after a rejected key must never swallow keys later) */
  doc.addEventListener('pointerdown', e => { if (!recordingId) return; const path = e.composedPath?.() || []; if (path.some(n => n?.dataset?.kbChange === recordingId)) return; stopRecording(); }, true);
  if (keyboard()) {
    shortcuts = block('shortcuts', 'kbEditTitle', 'kbEditHint');
    list = el('ul', 'kb-edit-list'); list.setAttribute('aria-label', t('kbEditTitle')); list.dataset.kbEditList = '';
    status = el('p', 'kb-edit-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.kbEditStatus = '';
    const actions = el('div', 'kb-edit-actions'), all = el('button', 'backup-btn', {type: 'button'}); all.dataset.kbResetAll = ''; text(all, 'kbEditResetAll');
    all.addEventListener('click', () => { stopRecording(); const kb = keys(); kb.commit({enabled: kb.bindings().enabled, keys: {}}); say('kbEditResetAllDone', {}); renderList(); all.focus({preventScroll: true}); });
    const note = el('p', 'block-sub'); text(note, 'kbEditGlobal');
    flash = el('span', 'kb-edit-flash'); flash.setAttribute('aria-hidden', 'true'); flash.dataset.kbEditFlash = '';
    actions.append(all, flash); shortcuts.append(status, list, actions, note);
    const anchor = content.querySelector('[data-settings-block=keyboard]');
    if (anchor) anchor.after(shortcuts); else (content.querySelector('[data-settings-section=view]') || content).append(shortcuts);
    nodes.push(shortcuts); renderList();
  }

  /* -- backup: export / import --------------------------------------------------------------------------------------------------------------- */
  const backup = block('backup', 'backupTitle', 'backupHint'); backup.classList.add('backup-block');
  const excluded = el('p', 'block-sub'); text(excluded, 'backupExcluded');
  const bStatus = el('p', 'backup-status'); bStatus.setAttribute('role', 'status'); bStatus.setAttribute('aria-live', 'polite'); bStatus.dataset.backupStatus = '';
  let bmsg = null;
  const paintB = () => { if (!bmsg) { bStatus.textContent = ''; bStatus.removeAttribute('data-level'); bStatus.removeAttribute('data-key'); return; } bStatus.dataset.level = bmsg.level; bStatus.dataset.key = bmsg.key; bStatus.textContent = tt(bmsg.key, bmsg.args); };
  const bsay = (key, args = {}, level = 'info') => { bmsg = {key, args, level}; paintB(); };
  const btn = (attr, key, fn) => { const b = el('button', 'backup-btn', {type: 'button'}); b.dataset[attr] = ''; text(b, key); b.addEventListener('click', fn); return b; };
  const file = el('input', '', {type: 'file', accept: '.json,application/json', hidden: '', tabindex: '-1', 'aria-hidden': 'true'}); file.dataset.backupFile = '';
  let pending = null, lastDownload = null;
  /* Modal confirmation (role=alertdialog, focus trap, Esc / Cancel / click outside = no): nothing in the panel moves while it is open and no message pops up between the elements. Focus starts on Cancel. */
  const ask = ({title, message, confirm, danger = false, attrs = {}}) => new Promise(resolve => {
    const opener = shadow.activeElement; let settled = false;
    const root = el('div', 'settings-modal'); root.dataset.settingsModal = ''; for (const [k, v] of Object.entries(attrs.dialog || {})) root.dataset[k] = v;
    const box = el('div', 'settings-modal-box', {role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-modal-title', 'aria-describedby': 'settings-modal-text', tabindex: '-1'});
    const h = el('h3'); h.id = 'settings-modal-title'; h.textContent = title; const p = el('p'); p.id = 'settings-modal-text'; p.textContent = message;
    const row = el('div', 'settings-modal-actions'), no = el('button', '', {type: 'button'}), yes = el('button', danger ? 'backup-danger' : 'settings-modal-ok', {type: 'button'});
    no.textContent = tt('backupCancel'); yes.textContent = confirm; for (const [k] of Object.entries(attrs.no || {})) no.dataset[k] = ''; for (const [k] of Object.entries(attrs.yes || {})) yes.dataset[k] = '';
    row.append(no, yes); box.append(h, p, row); root.append(box);
    const done = value => { if (settled) return; settled = true; root.remove(); try { opener?.focus({preventScroll: true}); } catch {} resolve(value); };
    no.addEventListener('click', () => done(false)); yes.addEventListener('click', () => done(true));
    root.addEventListener('pointerdown', e => { if (e.target === root) done(false); });
    root.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(false); return; }
      if (e.key !== 'Tab') return;
      const order = [no, yes], at = order.indexOf(shadow.activeElement); e.preventDefault(); order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus({preventScroll: true});
    });
    root.addEventListener('wheel', e => e.stopPropagation(), {passive: true});
    shadow.append(root); no.focus({preventScroll: true});
  });
  const exportBtn = btn('backupExport', 'backupExport', async () => {
    let body, name; try { body = JSON.stringify(exportDocument(get() || {}, {appVersion}), null, 2) + '\n'; name = exportFileName(); } catch { bsay('backupFail', {}, 'error'); return; }
    /* with the optional permission "downloads" (asked now, on the first click) the file is saved by the browser's download manager and can be shown in the folder; without it: plain download */
    const saved = await fileApi.save(name, body).catch(() => ({ok: false, reason: 'failed'}));
    if (saved?.ok && Number.isSafeInteger(saved.id)) { lastDownload = {id: saved.id, name}; showBtn.disabled = false; bsay('backupExported', {file: name}); return; }
    try {
      const url = URL.createObjectURL(new Blob([body], {type: 'application/json'})), a = el('a'); a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none'; backup.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      lastDownload = null; showBtn.disabled = true; bsay('backupExportedPlain', {file: name});
    } catch { bsay('backupFail', {}, 'error'); }
  });
  const showBtn = btn('backupShow', 'backupShow', async () => {
    if (!lastDownload) return;
    const r = await fileApi.show(lastDownload.id).catch(() => ({ok: false})); if (!r?.ok) bsay('backupShowFailed', {file: lastDownload.name}, 'error');
  });
  showBtn.disabled = true;
  new MutationObserver(() => { if (!lastDownload && !showBtn.disabled) showBtn.disabled = true; }).observe(showBtn, {attributes: true, attributeFilter: ['disabled']});   // the popup adapter re-enables every button when the connection returns: without a saved file this one stays off
  const importBtn = btn('backupImport', 'backupImport', () => { file.value = ''; file.click(); });
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; pending = null; if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) { bsay('backupErr_tooLarge', {}, 'error'); return; }
    let body = ''; try { body = await f.text(); } catch { bsay('backupErr_notJson', {}, 'error'); return; }
    const result = parseImport(body, {current: get() || {}, ctx: {uiLanguages: locales?.languages?.map(l => l.code), formatLocales: locales?.formatLocales, platform}});
    if (!result.ok) { const d = result.detail; bsay('backupErr_' + result.code, {detail: typeof d === 'object' && d ? [d.id, d.combo].filter(Boolean).join(' ') || d.code : d || '', version: d || ''}, 'error'); return; }
    pending = result; bmsg = null; paintB();
    const message = tt('backupPreview', {n: result.count, m: result.changed}) + (result.app?.version ? ' ' + tt('backupPreviewApp', {app: result.app.version}) : '');
    const yes = await ask({title: tt('backupImport'), message, confirm: tt('backupApply'), attrs: {dialog: {backupPreview: ''}, yes: {backupApply: ''}, no: {backupCancel: ''}}});
    if (!yes) { pending = null; file.value = ''; bsay('backupCancelled'); importBtn.focus({preventScroll: true}); return; }
    const values = pending.values, n = pending.count; pending = null;
    let ok = true; try { ok = (await onImport?.(values)) !== false; } catch { ok = false; }
    ok ? bsay('backupDone', {n}) : bsay('backupFail', {}, 'error'); exportBtn.focus({preventScroll: true});
  });
  const resetBtn = btn('backupReset', 'backupReset', async () => {
    const yes = await ask({title: tt('backupReset'), message: tt('backupResetConfirm'), confirm: tt('backupResetDo'), danger: true, attrs: {dialog: {backupResetConfirm: ''}, yes: {backupResetDo: ''}, no: {backupResetNo: ''}}});
    if (!yes) return;
    let ok = true; try { ok = (await onImport?.(resetPatch())) !== false; } catch { ok = false; } ok ? bsay('backupResetDone') : bsay('backupFail', {}, 'error');
  });
  resetBtn.classList.add('backup-danger');
  const resetBox = el('div', 'backup-danger-zone'), resetRow = el('div', 'backup-actions'), dangerTitle = el('h4', 'backup-danger-title'); dangerTitle.dataset.backupDanger = ''; text(dangerTitle, 'backupDanger'); resetRow.append(resetBtn); resetBox.append(dangerTitle, resetRow);
  const actions = el('div', 'backup-actions'); actions.append(exportBtn, showBtn, importBtn);
  backup.append(excluded, actions, file, bStatus, resetBox);
  const tail = content.querySelector(':scope>.settings-actions'); if (tail) tail.before(backup); else content.append(backup);
  nodes.push(backup);

  const readingTools = installReadingTools(shadow, {get, onChange});
  nodes.push(...readingTools.nodes);
  const sync = () => {
    readingTools.sync();
    for (const n of nodes) for (const i of n.querySelectorAll('[data-i18n]')) { const label = tt(i.dataset.i18n); if (i.textContent !== label && !i.matches('[data-backup-status],[data-kb-edit-status]')) i.textContent = label; }
    if (list) { list.setAttribute('aria-label', t('kbEditTitle')); if (!recordingId) renderList(); }
    paintStatus();
    paintB();
  };
  return {sync, nodes, stopRecording};
}
