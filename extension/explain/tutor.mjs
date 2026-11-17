/* beNotable! Reader · guided explanation ("tutor", shown as "Zusammenfassen") in a reading session (own code, MIT).
   One click on the bar: the page is walked through step by step. Per step the page (and the frames around an embedded
   text) scrolls to the passage, always, a soft band marks the passage being talked about, a pen draws on the original
   words (tutor-marks.mjs), the spoken word is marked while a key sentence is read, and a slim subtitle line at the bar
   shows only what is being said ("3/9"). Play/Pause, Previous/Next, the timeline and the chapter menu of the bar steer
   the steps while the tour is shown (also at its end); a numbered badge replays its step.
   - With the local model (engine host, explain/tutor-host.mjs): the session picks the key sentences itself, the model
     only writes explanation, note, phrase and style per sentence; every answer is validated against the live source.
   - Without a model (or when it fails): a deterministic tour over the key sentences (read in the page's voice), so there
     is never an empty or broken explanation.
   Page text never leaves the extension; the model is only downloaded after an explicit click. */
import {anchors, modelStep, extractiveStep, validateExplanation, validateSummary, fallbackSummary, planTiming, estimateMs, TUTOR_LANGUAGES, AI_LANGUAGES} from './tutor-plan.mjs';
import {createTutorMarks} from './tutor-marks.mjs';
import {mountTutorCard} from './tutor-card.mjs';
export const TUTOR_PORT = 'notable-explain';
/* the tour starts within ~10 s and never waits long between steps: a passage the model has not explained by then is read
   as its key sentence (named so in the card) and the worker moves on to the next one */
const FIRST_STEP_BUDGET_MS = 6500, NEXT_STEP_BUDGET_MS = 6000, SUMMARY_BUDGET_MS = 8000;   // first: room for the voice to start (≈2–3 s on a busy processor)
const STEP_GAP_MS = 450, START_MS = {neural: 20000, system: 5000};   // a voice that does not start in time is given up for this tour (text pacing instead)
const words = text => String(text).match(/\S+/gu) || [];
const fmtMB = bytes => Math.round(bytes / 1e6);

/* host = the session side:
   document, shadow() (bar shadow root), text(key, params), uiLanguage(), pageLanguage(), settings() ({speed, volume, muted, follow, followPosition, pitch, bass, treble}),
   source() -> {epoch, blocks:[{id, text, skip}]}, rangeOf(blockId, start, end) -> Range|null, selection() -> [{blockId,start,end}]|null, here() -> blockId|null,
   voiceFor(lang) -> {voice, spec}|null, pipelineFor(voice) -> Promise<Pipeline>, pauseReading() -> Promise, connect() -> Promise<runtime Port>, changed() */
export function createTutor(host) {
  const doc = host.document || document, win = doc.defaultView;
  let card = null, marks = null, port = null, portReady = null, run = null, status = null, download = null, view = {mode: ''}, disposed = false, runs = 0;
  /* The tour's options ARE the stored settings (one source with the settings panel; the card's menu writes them back):
     explainScope auto|page|here, explainDepth short|long, explainLanguage ui|page|<code>, explainKeepMarks.
     "Auf Englisch erklären (KI)" is an action for this tour only, not a setting (english). */
  const SCOPES = ['auto', 'page', 'here'], LANGUAGE_CHOICES = ['ui', 'page', ...TUTOR_LANGUAGES];
  const prefs = () => { const s = host.settings?.() || {}; return {scope: SCOPES.includes(s.explainScope) ? s.explainScope : 'auto', depth: s.explainDepth === 'long' ? 'long' : 'short', language: LANGUAGE_CHOICES.includes(s.explainLanguage) ? s.explainLanguage : 'page', keep: s.explainKeepMarks === true}; };
  let english = false;
  const t = (key, params) => host.text(key, params);
  const reduced = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  /* the tour's language: the setting (page = the language of the text it reads, the session's pageLang detected from the
     text itself; ui = the interface language; or one of the six); whether the model explains depends on it (AI_LANGUAGES) */
  const pageLanguage = () => String(host.pageLanguage() || 'en').slice(0, 2).toLowerCase();
  const uiLanguage = () => String(host.uiLanguage?.() || 'en').slice(0, 2).toLowerCase();
  const language = () => { const c = prefs().language, l = english ? AI_LANGUAGES[0] : c === 'page' ? pageLanguage() : c === 'ui' ? uiLanguage() : c; return /^[a-z]{2}$/.test(l) ? l : 'en'; };

  function ensureUi() {
    const shadow = host.shadow(); if (!shadow) return false;
    if (!card || !card.card.isConnected) card = mountTutorCard(shadow, {t, onAction: (name, value, trusted) => void action(name, value, trusted)});
    if (!marks || marks.disposed) marks = createTutorMarks({document: doc, rangeOf: (id, s, e) => host.rangeOf(id, s, e), onBadge: index => void replay(index), badgeLabel: n => t('tutor_badge', {n})});
    return true;
  }
  /* -- engine host port (model status, download, plan) ------------------------------------------------------------------- */
  function connect() {
    if (port) return portReady;
    portReady = (async () => {
      const p = await host.connect(); port = p; const listeners = new Set();
      p.onMessage.addListener(m => { for (const fn of listeners) fn(m); onHost(m); });
      p.onDisconnect.addListener(() => { if (port !== p) return; port = null; portReady = null; if (download?.state === 'running') { download = {...download, state: 'error', code: 'host-lost'}; render(); } if (run?.mode === 'model' && !run.planDone) planFailed('host-lost'); });
      p.listen = fn => { listeners.add(fn); return () => listeners.delete(fn); };
      return p;
    })().catch(error => { port = null; portReady = null; throw error; });
    return portReady;
  }
  const ask = async (message, answer, ms = 8000) => { const p = await connect(); return new Promise((resolve, reject) => { const timer = setTimeout(() => { off(); reject(Object.assign(Error('timeout'), {code: 'timeout'})); }, ms), off = p.listen(m => { if (m?.t === answer) { clearTimeout(timer); off(); resolve(m); } }); p.postMessage(message); }); };
  function onHost(m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'download') { download = {tier: m.tier, state: m.phase === 'ready' ? 'ready' : m.phase === 'error' ? 'error' : m.phase === 'cancelled' ? 'cancelled' : 'running', loaded: m.loaded || 0, total: m.total || 0, code: m.code || ''}; if (download.state === 'ready') { status = null; void begin(true); } else render(); return; }
    if (!run || m.id !== run.id || run.mode !== 'model') return;
    if (m.t === 'step') onModelStep(m);
    else if (m.t === 'summary') { if (run.summaryPlayed) return; clearDeadline(run); const v = validateSummary(m.raw, {language: run.language, context: run.anchors.map(a => a.context).join(' ') + ' ' + run.steps.filter(x => x?.source === 'model').map(x => x.say).join(' ')}); run.summary = v.ok ? {points: v.points, source: 'model'} : {points: fallbackSummary(run.anchors), source: 'extractive'}; run.timing.push({phase: 'summary', ms: m.ms, ok: v.ok, reasons: v.reasons}); maybeContinue(); prepareSpeech(run); }
    else if (m.t === 'done') { run.planDone = true; if (!run.summary) run.summary = {points: fallbackSummary(run.anchors), source: 'extractive'}; for (const a of run.anchors) if (run.steps[a.index] === undefined) { run.steps[a.index] = extractiveStep(a, label); marks.add(run.steps[a.index]); } maybeContinue(); }
    else if (m.t === 'progress') { run.progress = m; if (view.mode === 'preparing') render(); }
    else if (m.t === 'error') planFailed(m.code || 'failed');
    else if (m.t === 'timing') run.timing.push({phase: m.phase, ms: m.ms, ...(m.device ? {device: String(m.device).slice(0, 8), threads: Number(m.threads) || 0} : {})});
  }
  const label = (key, params) => t(key, params);
  /* one explanation sentence of the model: valid -> the explained step; invalid after the worker's second try -> the
     passage is read honestly as key sentence (named so in the card), never a made-up explanation */
  function onModelStep(m) {
    const a = run.anchors.find(x => x.index === m.index); if (!a) return;
    const v = validateExplanation(m.raw, a, {language: run.language});
    run.timing.push({phase: 'step', index: a.index, ms: m.ms, attempts: m.attempts || 1, ok: v.ok, reasons: v.reasons, at: Date.now() - run.startedAt, ...(run.steps[a.index] ? {late: true} : {})});
    if (run.steps[a.index]) return;   // came after its deadline: the key sentence was already used
    if (run.deadline?.index === a.index) { clearTimeout(run.deadline.timer); run.deadline = null; }
    run.steps[a.index] = v.ok ? modelStep(a, v.say, run.language, label) : extractiveStep(a, label);
    marks.add(run.steps[a.index]);
    maybeContinue(); prepareSpeech(run);
  }
  /* model failed before the tour could start: the deterministic tour; during the tour: what is there, plus the fallback summary */
  function planFailed(code) {
    if (!run) return; run.planDone = true; run.failure = code; clearDeadline(run);
    if (run.current < 0 && !run.steps.some(Boolean)) { startExtractive(run, 'tutor_fallback_model_failed'); return; }
    for (const a of run.anchors) if (run.steps[a.index] === undefined) { run.steps[a.index] = extractiveStep(a, label); marks.add(run.steps[a.index]); }
    if (!run.summary) run.summary = {points: fallbackSummary(run.anchors), source: 'extractive'};
    maybeContinue();
  }
  /* -- start ---------------------------------------------------------------------------------------------------------- */
  function scopeOf() {
    const selection = host.selection(), scope = prefs().scope, want = scope === 'auto' ? (selection ? 'selection' : 'page') : scope;
    if (want === 'selection' && selection) return {kind: 'selection', scope: {ranges: selection}};
    if (want === 'here') { const id = host.here(); if (id) return {kind: 'here', scope: {fromBlock: id}}; }
    return {kind: 'page', scope: null};
  }
  async function start(opts = {}) {
    if (disposed || !ensureUi()) return {ok: false};
    /* a finished tour whose marks were kept and whose line was closed: the button shows it again (Noch einmal, study sheet, remove marks) */
    if (run?.hidden && run.state === 'ended' && !opts.restart) { run.hidden = false; render(); return {ok: true, reopened: true}; }
    if (run && run.state !== 'ended' && !opts.restart) { render(); return {ok: true, running: true}; }
    english = false; await host.pauseReading();
    return begin(false);
  }
  async function begin(afterDownload) {
    if (disposed || !ensureUi()) return {ok: false};
    stopRun(); marks.clear();
    const source = host.source(), {kind, scope} = scopeOf(), want = prefs(), list = anchors(source, {depth: want.depth, language: pageLanguage(), scope});
    const id = 'r' + (++runs) + '-' + Date.now().toString(36);
    run = {id, epoch: source.epoch, signature: signature(source), language: language(), scopeKind: kind, scopeSetting: want.scope, depth: want.depth, anchors: list, steps: [], current: -1, state: 'preparing', mode: 'model', planDone: false, summary: null, summaryPlayed: false, timing: [], playing: false, paused: false, pipelines: new Map(), voices: new Map(), speak: 0, startedAt: Date.now()};
    if (!list.length) { run.state = 'ended'; run.empty = true; render(); return {ok: false, code: 'no_readable_text'}; }
    /* no usable AI explanation in this language: the key-sentence tour starts at once, no model card, nothing to download */
    if (!AI_LANGUAGES.includes(run.language)) { startExtractive(run, 'tutor_fallback_language'); return {ok: true, mode: 'extractive'}; }
    render();
    let s = null; try { s = await refreshStatus(); } catch { s = null; }
    /* the engine host can be stale after an extension reload (getContexts still lists a dead document): ask once more,
       the session's connect() ensures the host document again. Without this the tour silently fell back to reading. */
    if (!s) { await new Promise(r => setTimeout(r, 1500)); try { s = await refreshStatus(); } catch { s = null; } }
    if (!run || run.id !== id) return {ok: true};
    if (!s) { startExtractive(run, 'tutor_fallback_unavailable'); return {ok: true, mode: 'extractive'}; }
    const usable = x => x.installed && x.available !== false, tier = s.tiers.find(x => x.id === s.preferred && usable(x)) || s.tiers.find(usable);
    if (!tier) { if (afterDownload) { startExtractive(run, 'tutor_fallback_model_failed'); return {ok: true, mode: 'extractive'}; } run.state = 'offer'; render(); return {ok: true, offer: true}; }
    run.tier = tier.id;
    let p = await connect().catch(() => null);
    if (!p) { await new Promise(r => setTimeout(r, 1200)); p = await connect().catch(() => null); }
    if (!p || !run || run.id !== id) { if (run?.id === id) startExtractive(run, 'tutor_fallback_unavailable'); return {ok: true}; }
    p.postMessage({t: 'plan', id, tier: tier.id, language: run.language, anchors: list.map(a => ({index: a.index, title: a.title, heading: a.heading, before: a.before, sentence: a.sentence, after: a.after}))});
    armDeadline(); warmVoice(run); render(); return {ok: true, mode: 'model'};
  }
  async function refreshStatus() { const m = await ask({t: 'status'}, 'status'); status = {tiers: Array.isArray(m.tiers) ? m.tiers : [], preferred: m.preferred || 'small', download: m.download || null}; if (m.download?.state === 'running') download = m.download; return status; }
  function startExtractive(r, reason) {
    if (!r || r !== run) return;
    r.mode = 'extractive'; r.reason = reason; r.planDone = true; clearDeadline(r);
    r.steps = r.anchors.map(a => extractiveStep(a, label));
    for (const step of r.steps) marks.add(step);
    r.summary = {points: fallbackSummary(r.anchors), source: 'extractive'}; r.state = 'running'; maybeContinue(); prepareSpeech(r);
  }
  /* The sentences the tour will speak after the current step (all of them for the key-sentence tour, the written ones for the model) are prepared in
     advance in the engine host's audio cache, so the next step starts without waiting for its synthesis; a sentence reading already synthesized is cut
     out of that audio (RemotePipeline.precompute -> LocalPipeline.precompute). The current step plays through the normal start (first sentence first). */
  function prepareSpeech(r) {
    if (!r || r !== run) return;
    const groups = new Map(), add = (say, lang) => { if (!say) return; if (!groups.has(lang)) groups.set(lang, []); groups.get(lang).push({text: say, words: words(say)}); };
    for (const a of r.anchors) { const step = r.steps[a.index]; if (step && a.index > r.current) add(step.say, step.sayLanguage === 'page' ? pageLanguage() : step.sayLanguage); }
    if (r.summary?.points?.length) add(r.summary.points.join(' '), r.summary.source === 'model' ? r.language : pageLanguage());
    for (const [lang, items] of groups) {
      let voice = r.voices.get(lang); if (voice === undefined) { voice = host.voiceFor(lang) || null; r.voices.set(lang, voice); }
      if (voice?.voice?.kind === 'neural') void pipelineOf(r, lang, voice).then(p => { if (p && run === r) p.precompute?.(items, {voice: voice.spec, lang, normalize: host.settings().normalizeSpeech !== false}); }).catch(() => {});
    }
  }
  const signature = source => source.blocks.map(b => b.id + ':' + b.text.length + ':' + b.text.slice(0, 24)).join('|');
  /* -- the tour --------------------------------------------------------------------------------------------------------- */
  const order = () => run.anchors.map(a => a.index).filter(i => run.steps[i]);
  const total = () => run.mode === 'extractive' || run.planDone ? order().length + (run.summary?.points?.length ? 1 : 0) : run.anchors.length + 1;
  function maybeContinue() {
    if (!run || run.state === 'ended' || run.state === 'offer' || run.paused) { render(); return; }
    if (run.current >= 0 && (run.playing || run.wait)) { render(); return; }
    const next = nextIndex(run.current);
    if (next !== undefined) { run.state = 'running'; void playStep(next); return; }
    if (run.planDone && !run.summaryPlayed && run.summary?.points?.length) { run.state = 'running'; void playSummary(); return; }
    if (run.planDone) { finish(); return; }
    armDeadline(); render();
  }
  /* the passage the tour waits for gets a deadline (counted from the start for the first step, from the moment the
     tour runs dry for later ones); when it passes, the key sentence is read and the worker skips that passage */
  function armDeadline() {
    const r = run; if (!r || r.mode !== 'model' || r.planDone || r.paused) return;
    const waiting = r.anchors.find(a => a.index > r.current && r.steps[a.index] === undefined);
    if (!waiting) { armSummaryDeadline(r); return; }
    if (r.deadline?.index === waiting.index) return;
    clearDeadline(r);
    const first = !r.steps.some(Boolean), budget = first ? Math.max(0, FIRST_STEP_BUDGET_MS - (Date.now() - r.startedAt)) : NEXT_STEP_BUDGET_MS;
    r.deadline = {index: waiting.index, timer: setTimeout(() => {
      if (run !== r || r.deadline?.index !== waiting.index) return; r.deadline = null;
      if (r.paused || r.planDone || r.steps[waiting.index] !== undefined) { maybeContinue(); return; }
      r.steps[waiting.index] = {...extractiveStep(waiting, label), late: true}; marks.add(r.steps[waiting.index]);
      r.timing.push({phase: 'step', index: waiting.index, deadline: budget, at: Date.now() - r.startedAt});
      try { port?.postMessage({t: 'skip', id: r.id, index: waiting.index}); } catch {}
      maybeContinue();
    }, budget)};
  }
  /* every passage is there and only the three points are still being written: after SUMMARY_BUDGET_MS the key sentences
     close the tour (named so) and the plan is cancelled */
  function armSummaryDeadline(r) {
    if (r.current < 0 || r.summary || r.deadline?.index === 'summary' || r.anchors.some(a => r.steps[a.index] === undefined)) return;
    clearDeadline(r);
    r.deadline = {index: 'summary', timer: setTimeout(() => {
      if (run !== r || r.deadline?.index !== 'summary') return; r.deadline = null;
      if (r.paused || r.planDone || r.summary) { maybeContinue(); return; }
      r.summary = {points: fallbackSummary(r.anchors), source: 'extractive'}; r.planDone = true;
      r.timing.push({phase: 'summary', deadline: SUMMARY_BUDGET_MS, at: Date.now() - r.startedAt});
      try { port?.postMessage({t: 'cancel', id: r.id}); } catch {}
      maybeContinue();
    }, SUMMARY_BUDGET_MS)};
  }
  function clearDeadline(r) { if (r?.deadline) { clearTimeout(r.deadline.timer); r.deadline = null; } }
  /* the next step after `index` that exists, or undefined (still being written / none) */
  function nextIndex(index) { for (const a of run.anchors) { if (a.index <= index) continue; if (run.steps[a.index] === undefined) return undefined; if (run.steps[a.index]) return a.index; } return undefined; }
  function previousIndex(index) { const list = order().filter(i => i < index); return list.at(-1); }
  /* Every step brings its passage into the free part of the view (not under the bar or its subtitle line), at the
     reading position of "Folgen". The tour always follows: that is its point, also when "Folgen" is off or the reader
     scrolled by hand meanwhile (the bar shows "Folgen" on while the tour runs, the setting itself is untouched).
     In an embedded frame (an artifact) the frames around it are scrolled as well, until the passage is on screen. */
  async function scrollTo(index) {
    const s = host.settings(), rect = marks.rect(index) || anchorRect(index); if (!rect) return;
    const owner = scrollOwner(rect, index), box = owner ? owner.getBoundingClientRect() : {top: 0, bottom: win.innerHeight}, free = freeBand(box), behavior = reduced() ? 'instant' : 'smooth';
    if (rect.top < free.top + 8 || rect.bottom > free.bottom - 8) {
      const room = free.bottom - free.top, at = (Number.isFinite(s.followPosition) ? Math.max(10, Math.min(90, s.followPosition)) : 33) / 100;
      const delta = rect.top - (free.top + Math.max(8, Math.min(room - (rect.bottom - rect.top) - 8, room * at)));
      try { (owner || win).scrollBy({top: delta, behavior}); } catch { (owner || win).scrollBy(0, delta); }
      if (!reduced()) await scrollEnd();
    }
    if (win !== win.top) revealInFrames(index, behavior);
  }
  const scrollEnd = () => new Promise(resolve => { let done = false; const end = () => { if (done) return; done = true; win.removeEventListener('scrollend', end, true); resolve(); }; win.addEventListener('scrollend', end, true); setTimeout(end, 650); });
  /* the part of the view that bar and card leave free (the bar sits at the bottom or, dragged, at the top) */
  function freeBand(box) {
    let top = Math.max(0, box.top), bottom = Math.min(win.innerHeight, box.bottom);
    const root = host.shadow?.(), covers = [root?.querySelector('.bar'), root?.querySelector('.tutor-card:not([hidden])')].map(e => e?.getBoundingClientRect()).filter(r => r && r.height > 0);
    for (const r of covers) { if (r.top > (top + bottom) / 2) bottom = Math.min(bottom, r.top - 8); else if (r.bottom < (top + bottom) / 2) top = Math.max(top, r.bottom + 8); }
    return bottom - top > 80 ? {top, bottom} : {top: Math.max(0, box.top), bottom: Math.min(win.innerHeight, box.bottom)};
  }
  /* an embedded frame: the outer pages scroll the frame so far that the passage is on screen (scrollIntoView reaches the
     ancestor frames, also across origins; inside this frame the passage is in view already, so nothing moves here) */
  function revealInFrames(index, behavior) {
    const step = run?.steps[index], r = step && host.rangeOf(step.blockId, step.anchor.start, step.anchor.end); let node = r?.startContainer; if (node?.nodeType !== 1) node = node?.parentElement;
    try { node?.scrollIntoView({block: 'nearest', inline: 'nearest', behavior}); } catch {}
  }
  function anchorRect(index) { const step = run.steps[index]; if (!step) return null; const r = host.rangeOf(step.blockId, step.anchor.start, step.anchor.end); return r ? r.getBoundingClientRect() : null; }
  function scrollOwner(_rect, index) {
    const step = run.steps[index], r = step && host.rangeOf(step.blockId, step.anchor.start, step.anchor.end); let node = r?.startContainer; if (node?.nodeType !== 1) node = node?.parentElement;
    for (; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) { const st = win.getComputedStyle(node); if (/auto|scroll|overlay/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 1) return node; }
    return null;
  }
  async function playStep(index, replaying = false) { try { await stepAt(index, replaying); } catch (error) { failed(error); } }
  /* an unexpected error inside a step is kept for the diagnosis and the tour goes on with the next step */
  function failed(error) { if (!run) return; run.error = String(error?.stack || error).slice(0, 400); console.error('beNotable! Reader: explanation step failed', error); run.wait = false; run.playing = false; run.stepDone = true; maybeContinue(); }
  async function stepAt(index, replaying) {
    if (!run) return; const r = run, step = r.steps[index]; if (!step) return;
    stopSpeech(); r.current = index; r.summaryShown = false; r.playing = false; r.paused = false; r.wait = true; r.stepDone = false; r.stepStartedAt = 0; marks.setActive(index); r.drawn = r.drawn || new Set();
    marks.setFocus({blockId: step.blockId, start: step.anchor.start, end: step.anchor.end});   // the passage being talked about, unmistakably
    if (replaying || r.drawn.has(index)) marks.hide(index);
    render();
    await scrollTo(index); if (run !== r || r.current !== index) return;
    r.wait = false; if (r.paused) { render(); return; }   // paused while scrolling: Play restarts this step
    await speak(step.say, step.sayLanguage === 'page' ? pageLanguage() : step.sayLanguage, {onStart: ms => { marks.draw(index, planTiming(ms, {reduced: reduced()})); r.drawn.add(index); if (!r.firstStepMs) r.firstStepMs = Date.now() - r.startedAt; r.stepStartedAt = Date.now(); r.pausedInto = 0; (r.spokenMs ||= new Map()).set(index, ms); followWords(r, index); }, onEnd: () => { if (run === r && r.current === index && !r.summaryShown) afterStep(); }});
  }
  async function playSummary() {
    const r = run; stopSpeech(); r.summaryPlayed = true; r.summaryShown = true; r.current = Number.MAX_SAFE_INTEGER; r.playing = false; r.paused = false; r.wait = false; r.stepStartedAt = 0;   // wait: a step left while it still scrolled (Next) never clears it itself marks.setActive(-1); marks.setFocus(null); render();
    const lang = r.summary.source === 'model' ? r.language : pageLanguage(), say = r.summary.points.join(' ');
    await speak(say, lang, {onStart: ms => { r.stepStartedAt = Date.now(); r.pausedInto = 0; (r.spokenMs ||= new Map()).set('summary', ms); }, onEnd: () => { if (run === r && r.summaryShown) finish(); }});
  }
  function afterStep() { const r = run; r.playing = false; r.stepDone = true; r.timer = null; r.gapTimer = setTimeout(() => { if (run !== r || r.paused) return; r.gapTimer = 0; maybeContinue(); }, STEP_GAP_MS); render(); }
  /* "Markierungen danach stehen lassen" off: the marks go when the tour ends ("Noch einmal" draws them again) */
  function hideMarks(r = run) { if (!r) return; for (const i of r.drawn || []) marks.hide(i); r.marksHidden = true; }
  const marksShown = () => !!run && !run.marksHidden && run.drawn?.size > 0;
  function finish() { if (!run) return; stopSpeech(); run.state = 'ended'; run.playing = false; run.paused = false; run.wait = false; run.endedAt = Date.now(); if (!prefs().keep) hideMarks(); marks.setActive(-1); marks.setFocus(null); render(); }
  /* While a key sentence is read in the original, its spoken word is marked on the page like in normal reading (from the
     word timings of the local voice, or the word events of a system voice). An explanation of the model is not page
     text: there the passage band alone shows what it is about. */
  function followWords(r, index) {
    win.cancelAnimationFrame?.(r.wordFrame); marks.setWord(null);
    const step = r.steps[index]; if (step?.source !== 'extractive') return;
    const block = host.source().blocks.find(b => b.id === step.blockId); if (!block || block.text.slice(step.anchor.start, step.anchor.start + step.say.length) !== step.say) return;
    const spans = [...step.say.matchAll(/\S+/gu)].map(m => ({start: m.index, end: m.index + m[0].length})), token = r.speak, rate = () => Math.max(.5, Number(host.settings().speed) || 1);
    const tick = () => {
      if (run !== r || r.speak !== token || r.current !== index || r.summaryShown) { marks.setWord(null); return; }
      const p = [...r.pipelines.values()].find(x => x.tutorToken === token), times = p?.tutorWords;
      let i = -1; if (times?.length === spans.length && r.stepStartedAt) { const t = (r.paused ? r.pausedInto || 0 : Date.now() - r.stepStartedAt) / 1000 * rate(); i = times.findIndex(w => t < w.e); if (i < 0) i = spans.length - 1; } else if (Number.isInteger(p?.tutorWord)) i = Math.min(spans.length - 1, p.tutorWord);
      const w = spans[i]; marks.setWord(w ? {blockId: step.blockId, start: step.anchor.start + w.start, end: step.anchor.start + w.end} : null);
      if (r.stepDone) { marks.setWord(null); return; } r.wordFrame = win.requestAnimationFrame(tick);
    };
    r.wordFrame = win.requestAnimationFrame(tick);
  }
  /* -- speech: the bar's tempo, volume and sound; a voice of the step's language; silent pacing when none is installed -- */
  /* never leaves a step hanging: any failure on the way to the voice continues the step as text with its timing */
  async function speak(text, lang, handlers) {
    const r = run, token = r.speak + 1;
    try { await voiceStep(text, lang, handlers); }
    catch (error) { if (run === r && r.speak === token && !r.timer) { r.speakError = String(error?.message || error).slice(0, 120); r.stage = 'error'; r.silent = true; const ms = estimateMs(text, Number(host.settings().speed) || 1); r.silentSteps = (r.silentSteps || 0) + 1; handlers.onStart(ms); r.timer = {left: ms, at: Date.now(), done: handlers.onEnd}; r.timer.id = setTimeout(() => { if (run === r && r.speak === token) { r.timer = null; handlers.onEnd(); } }, ms); } }
  }
  async function voiceStep(text, lang, {onStart, onEnd}) {
    const r = run, token = ++r.speak, s = host.settings(), rate = Number(s.speed) || 1; r.stage = 'voice';
    let voice = r.voices.get(lang); if (voice === undefined) { voice = host.voiceFor(lang) || null; r.voices.set(lang, voice); }
    r.silent = !voice; r.playing = true; render();
    const silent = () => { const ms = estimateMs(text, rate); r.silentSteps = (r.silentSteps || 0) + 1; onStart(ms); r.timer = {left: ms, at: Date.now(), done: onEnd}; r.timer.id = setTimeout(() => { if (run === r && r.speak === token) { r.timer = null; onEnd(); } }, ms); };
    if (!voice) { r.stage = 'silent'; silent(); return; }
    let pipeline = r.pipelines.get(lang);
    if (!pipeline) {
      r.stage = 'pipeline'; pipeline = await pipelineOf(r, lang, voice);
      if (run !== r || r.speak !== token) return;
      if (!pipeline) { r.voices.set(lang, null); r.silent = true; silent(); return; }
    }
    await Promise.race([r.warming, new Promise(resolve => setTimeout(resolve, 3000))]).catch(() => {});   // the warm-up's load first (one load at a time per pipeline)
    if (run !== r || r.speak !== token) return;
    Object.assign(pipeline, {tutorToken: token, tutorStarted: false, tutorMs: 0, tutorText: text, tutorOnStart: onStart, tutorOnEnd: onEnd, tutorWords: null, tutorWord: null});
    /* armed before load/play: a voice whose load or play never settles (no audio device, a hung system voice) must not stop the tour */
    const watch = () => { clearTimeout(r.startWatch); r.startWatch = setTimeout(() => { if (run !== r || r.speak !== token || pipeline.tutorStarted) return; if (r.paused) { watch(); return; } r.voices.set(lang, null); dropPipeline(r, lang); pipeline.tutorOnEnd = null; r.voiceFailed = (r.voiceFailed || 0) + 1; r.silent = true; silent(); }, START_MS[voice.voice.kind] || START_MS.system); };
    watch(); r.stage = 'load';
    try {
      await pipeline.load({chunks: [{id: 0, text, words: words(text)}], lang, voice: voice.spec, startChunk: 0, normalize: s.normalizeSpeech !== false});
      if (run !== r || r.speak !== token) return;
      pipeline.setFx?.({pitch: s.pitch ?? 0, bass: s.bass ?? 0, treble: s.treble ?? 0, gapMs: 0});
      r.stage = 'play'; await pipeline.play({chunk: 0, rate, volume: s.muted ? 0 : (s.volume ?? 100) / 100});
    } catch { if (run === r && r.speak === token && !pipeline.tutorStarted) { clearTimeout(r.startWatch); r.silent = true; silent(); } }
  }
  /* one pipeline per language and tour, built once even when the warm-up and the first step ask at the same moment */
  function pipelineOf(r, lang, voice) {
    r.building = r.building || new Map();
    if (!r.building.has(lang)) r.building.set(lang, (async () => {
      let pipeline; try { pipeline = await host.pipelineFor(voice); } catch { pipeline = null; }
      if (run !== r) { pipeline?.dispose?.(); return null; }
      if (!pipeline) { r.building.delete(lang); return null; }
      r.pipelines.set(lang, pipeline);
      pipeline.addEventListener('timings', e => { if (pipeline.tutorToken === r.speak && e.detail?.chunk === 0) { const list = e.detail.words || [], last = list.at(-1); pipeline.tutorWords = list; if (last) pipeline.tutorMs = Math.round(last.e * 1000 / Math.max(.5, Number(host.settings().speed) || 1)); } });
      pipeline.addEventListener('state', e => { if (pipeline.tutorToken !== r.speak || run !== r) return; const st = e.detail?.state; if (st === 'playing' && r.paused) pipeline.pause(); if (st === 'playing' && !pipeline.tutorStarted) { pipeline.tutorStarted = true; r.spoken = (r.spoken || 0) + 1; r.voiceKind = voice.voice.kind; pipeline.tutorOnStart(pipeline.tutorMs || estimateMs(pipeline.tutorText, Number(host.settings().speed) || 1)); } if (st === 'ended' || st === 'error' || st === 'preempted') { const done = pipeline.tutorOnEnd; pipeline.tutorOnEnd = null; if (st === 'error' && !pipeline.tutorStarted) { clearTimeout(r.startWatch); r.voices.set(lang, null); dropPipeline(r, lang); r.silent = true; const ms = estimateMs(pipeline.tutorText, Number(host.settings().speed) || 1), end = done; r.silentSteps = (r.silentSteps || 0) + 1; pipeline.tutorOnStart(ms); const token = r.speak; r.timer = {left: ms, at: Date.now(), done: end}; r.timer.id = setTimeout(() => { if (run === r && r.speak === token) { r.timer = null; end?.(); } }, ms); return; } done?.(); } });
      pipeline.addEventListener('chunkend', e => { if (pipeline.tutorToken !== r.speak || e.detail?.chunk !== 0) return; const done = pipeline.tutorOnEnd; pipeline.tutorOnEnd = null; done?.(); });
      pipeline.addEventListener('word', e => { if (pipeline.tutorToken === r.speak && Number.isInteger(e.detail?.word)) pipeline.tutorWord = e.detail.word; if (pipeline.tutorToken === r.speak && !pipeline.tutorStarted) { pipeline.tutorStarted = true; pipeline.tutorOnStart(estimateMs(pipeline.tutorText, Number(host.settings().speed) || 1)); } });
      return pipeline;
    })());
    return r.building.get(lang);
  }
  function dropPipeline(r, lang) { const p = r.pipelines.get(lang); r.pipelines.delete(lang); r.building?.delete(lang); try { p?.dispose?.(); } catch {} }
  /* the tour was started by a click: while the model writes the first step, the local voice of the tour's language
     loads (the installed voice only, through the pipeline's guarded prewarm: nothing is played, synthesized or downloaded) */
  function warmVoice(r) {
    const lang = r.language, first = r.anchors[0]; if (!first) return;
    let voice = r.voices.get(lang); if (voice === undefined) { voice = host.voiceFor(lang) || null; r.voices.set(lang, voice); }
    if (voice?.voice?.kind !== 'neural') return;
    r.warming = (async () => {
      const pipeline = await pipelineOf(r, lang, voice); if (!pipeline || run !== r || r.speak) return;
      await pipeline.load({chunks: [{id: 0, text: first.sentence, words: words(first.sentence)}], lang, voice: voice.spec, startChunk: 0, normalize: host.settings().normalizeSpeech !== false});
      if (run === r && !r.speak) pipeline.prewarm?.(0);
    })().catch(() => {});
  }
  function stopSpeech() {
    if (!run) return; run.speak++; clearTimeout(run.gapTimer); clearTimeout(run.startWatch); run.gapTimer = 0; if (run.timer) { clearTimeout(run.timer.id); run.timer = null; }
    for (const p of run.pipelines.values()) { p.tutorOnEnd = null; try { p.stop(); } catch {} }
  }
  function stopRun() {
    if (!run) return; stopSpeech(); clearDeadline(run); if (run.mode === 'model' && !run.planDone) port?.postMessage({t: 'cancel', id: run.id});
    for (const p of run.pipelines.values()) { try { p.dispose?.(); } catch {} } run.pipelines.clear(); run = null;
  }
  /* -- commands of the bar ---------------------------------------------------------------------------------------------- */
  function toggle() {
    if (!run || run.state === 'offer') return;
    if (run.state === 'ended') { run.summaryPlayed = false; run.cancelled = false; const first = order()[0]; if (first !== undefined) void replay(first); return; }   // Play at the end: the tour again from step 1
    if (run.paused) {
      run.paused = false; marks.resume(); if (run.stepStartedAt) run.stepStartedAt = Date.now() - (run.pausedInto || 0);
      const p = [...run.pipelines.values()].find(x => x.tutorToken === run.speak && x.tutorOnEnd);
      if (run.timer) { const timer = run.timer; timer.at = Date.now(); timer.id = setTimeout(() => { if (run && run.timer === timer) { run.timer = null; timer.done(); } }, timer.left); run.playing = true; }
      else if (p) { void p.resume(); run.playing = true; }
      else if (run.summaryShown) void playSummary();
      else if (run.current < 0 || run.stepDone) maybeContinue();   // between steps: on to the next one
      else void playStep(run.current, true);   // paused before the voice started: this step again
      render(); return;
    }
    run.paused = true; marks.pause(); clearTimeout(run.gapTimer); run.gapTimer = 0; run.pausedInto = run.stepStartedAt ? Date.now() - run.stepStartedAt : 0;
    if (run.timer) { clearTimeout(run.timer.id); run.timer.left = Math.max(0, run.timer.left - (Date.now() - run.timer.at)); }
    for (const p of run.pipelines.values()) if (p.tutorToken === run.speak) p.pause();
    run.playing = false; render();
  }
  /* Previous/Next of the bar: one step back or on, also while paused, while a step is spoken and after the end;
     Previous on step 1 starts it again ("von vorn"), Next on the last step plays the three points */
  function step(direction) {
    if (!run || run.state === 'offer' || run.state === 'preparing' && run.current < 0) return;
    if (run.summaryShown || run.state === 'ended' && run.current < 0) { if (direction < 0) { const last = order().at(-1); if (last !== undefined) { run.state = 'running'; void playStep(last, true); } } return; }
    const target = direction > 0 ? nextIndex(run.current) : previousIndex(run.current);
    if (target !== undefined) { run.state = 'running'; void playStep(target, true); return; }
    if (direction > 0 && run.planDone && run.summary?.points?.length) { run.state = 'running'; void playSummary(); }
    else if (direction < 0 && run.current >= 0) { run.state = 'running'; void playStep(run.current, true); }
  }
  /* the bar's timeline during the tour: steps as segments, heard/rest of the tour; a click there jumps to its step */
  function stepMs(index, rate) { if (run.spokenMs?.has(index)) return run.spokenMs.get(index); const s = run.steps[index], a = run.anchors.find(x => x.index === index); return estimateMs(s?.say || a?.sentence || '', rate); }
  let lastPrepared = 0;
  function progress() {
    const r = run, rate = Number(host.settings().speed) || 1, list = r.anchors.map(a => a.index), parts = list.map(i => stepMs(i, rate));
    parts.push(r.summary?.points?.length ? (r.spokenMs?.get('summary') ?? estimateMs(r.summary.points.join(' '), rate)) : r.planDone ? 0 : estimateMs(r.anchors[0]?.sentence || '', rate));
    const total = Math.max(1, parts.reduce((a, b) => a + b, 0)), at = r.summaryShown ? list.length : Math.max(0, list.indexOf(r.current));
    const into = r.state === 'ended' && !r.cancelled ? parts[at] : !r.stepStartedAt || r.current < 0 && !r.summaryShown ? 0 : Math.min(parts[at] || 0, r.paused ? r.pausedInto || 0 : Date.now() - r.stepStartedAt);
    const elapsed = r.state === 'ended' && !r.cancelled && r.summaryPlayed ? total : parts.slice(0, at).reduce((a, b) => a + b, 0) + into;
    let sum = 0; const starts = parts.slice(0, -1).map(ms => { const s = sum / total; sum += ms; return s; });
    /* prepared: prefix of steps whose explanation sentence exists (the worker writes them in page order); the summary finishes it */
    let prepared = 0; for (const i of list) { if (!r.steps[i]) break; prepared++; }
    let preparedMs = 0; for (let k = 0; k < prepared; k++) preparedMs += parts[k] || 0;
    if (r.summary?.points?.length) preparedMs = total;
    lastPrepared = total ? Math.max(0, Math.min(1, preparedMs / total)) : 0;
    return {fraction: Math.max(0, Math.min(1, elapsed / total)), elapsed: elapsed / 1000, remaining: Math.max(0, total - elapsed) / 1000, segments: [...starts.slice(1), (total - parts.at(-1)) / total].filter(x => x > 0 && x < 1), starts};
  }
  function seek(fraction) {
    if (!run || run.state === 'offer' || run.current < 0 && run.state === 'preparing') return;
    const p = progress(), list = run.anchors.map(a => a.index); let k = p.starts.findLastIndex(s => s <= Math.max(0, Math.min(1, fraction)) + 1e-9); if (k < 0) k = 0;
    const lastStart = p.segments.at(-1) ?? 1;
    if (fraction >= lastStart && run.planDone && run.summary?.points?.length) { run.state = 'running'; void playSummary(); return; }
    const target = list.slice(0, k + 1).reverse().find(i => run.steps[i]); if (target !== undefined) { run.state = 'running'; void playStep(target, true); }
  }
  function jump(stepNumber) { const i = order()[stepNumber]; if (i !== undefined) { run.state = 'running'; void playStep(i, true); } else if (stepNumber >= order().length && run?.planDone && run.summary?.points?.length) { run.state = 'running'; void playSummary(); } }
  async function replay(index) { if (!run || !run.steps[index]) return; if (run.state === 'ended') run.state = 'running'; run.paused = false; run.marksHidden = false; run.hidden = false; await playStep(index, true); }
  let cleared = '';
  function clear(reason = 'clear') { cleared = reason; stopRun(); marks?.clear(); download = download?.state === 'running' ? download : null; render(); host.changed(); }
  function cancel() {
    if (!run) { clear(); return; }
    if (run.state === 'running' || run.state === 'preparing') { const keep = run.drawn?.size > 0 && prefs().keep; if (run.mode === 'model' && !run.planDone) port?.postMessage({t: 'cancel', id: run.id}); run.planDone = true; stopSpeech(); marks.setFocus(null); if (keep) { run.state = 'ended'; run.cancelled = true; run.playing = run.paused = run.wait = false; marks.setActive(-1); render(); host.changed(); return; } }
    clear();
  }
  async function action(name, value, trusted = true) {
    if ((name === 'download' || name === 'remove') && trusted !== true) return;   // the bar's shadow root is open: a page script may click, but only a real click downloads the model
    if (name === 'close') { if (run && (run.state === 'running' || run.state === 'preparing')) cancel(); else if (run?.state === 'ended' && prefs().keep && marksShown()) { run.hidden = true; render(); } else clear('close'); return; }   // kept marks stay on the page
    if (name === 'download') { download = {tier: value || 'small', state: 'running', loaded: 0, total: status?.tiers.find(x => x.id === (value || 'small'))?.bytes || 0}; render(); try { (await connect()).postMessage({t: 'download', tier: value || 'small'}); } catch { download = {...download, state: 'error', code: 'host-lost'}; render(); } return; }
    if (name === 'cancelDownload') { port?.postMessage({t: 'cancelDownload'}); return; }
    if (name === 'remove') { if (run && run.mode === 'model') { stopRun(); marks.clear(); } try { await ask({t: 'remove', tier: value}, 'removed', 15000); } catch {} status = null; try { await refreshStatus(); } catch {} render(); return; }
    if (name === 'extractive') { if (!run) await begin(false); if (run) startExtractive(run, 'tutor_fallback_chosen'); return; }
    if (name === 'explainEnglish') { english = true; await begin(false); return; }   // the model card (or the tour, when the model is there)
    if (name === 'clear') { clear(); return; }
    if (name === 'again') { if (run) { run.summaryPlayed = false; run.cancelled = false; const first = order()[0]; if (first !== undefined) await replay(first); else await begin(false); } return; }   // "Noch einmal": from step 1, nothing written again
    if (name === 'restart') { await begin(false); return; }
    /* the menu changes the stored setting (saved like in the settings panel); settingsChanged() then starts the tour again */
    if (name === 'option') { const key = {scope: 'explainScope', depth: 'explainDepth', language: 'explainLanguage'}[value?.name], ok = {explainScope: SCOPES, explainDepth: ['short', 'long'], explainLanguage: LANGUAGE_CHOICES}[key]; if (!key || !ok.includes(value.value)) return; await host.saveSettings?.({[key]: value.value}); return; }
    if (name === 'export') { exportSheet(); }
  }
  /* -- card view ---------------------------------------------------------------------------------------------------------- */
  function render() {
    if (!card) return;
    view = buildView(); card.render(view);
    const owns = !!run && !run.empty && ['running', 'preparing', 'ended'].includes(run.state) && !!view.mode && view.mode !== 'offer';
    try { card.segments(owns ? progress().segments : null); } catch {}
    host.changed();
  }
  const fallbackHint = () => run?.reason === 'tutor_fallback_language' ? t('tutor_ai_languages', {language: languageName(run.language)}) : t(run?.reason === 'tutor_fallback_model_failed' ? 'tutor_model_fallback' : 'tutor_extractive_hint');
  function languageName(code) { try { return new Intl.DisplayNames([String(host.uiLanguage() || 'en').slice(0, 2)], {type: 'language'}).of(code); } catch { return code.toUpperCase(); } }
  /* the English explanation beside a key-sentence tour that ran because of the language */
  const languageOffer = () => run?.reason === 'tutor_fallback_language' ? [['tutor_explain_english', 'explainEnglish']] : [];
  const summaryTitle = () => t(run?.summary?.source === 'model' ? 'tutor_summary_title' : 'tutor_summary_extractive');
  function optionView() { const kept = status?.tiers?.find(x => x.id === (run?.tier || status.preferred) && x.installed) || status?.tiers?.find(x => x.installed), p = prefs(); return {scope: p.scope, depth: p.depth, language: p.language, page: pageLanguage(), ui: uiLanguage(), removable: kept ? {tier: kept.id, mb: fmtMB(kept.bytes)} : null}; }
  /* what went wrong with a download, in words (the code stays in brackets for a report) */
  function downloadCause() { const code = download?.code || '', key = {quota: 'quota', unreachable: 'unreachable', offline: 'offline', stalled: 'stalled', incomplete: 'incomplete', hash: 'hash', size: 'hash', 'host-lost': 'host', worker: 'host'}[code] || 'generic', tier = status?.tiers.find(x => x.id === download?.tier); return t('tutor_download_error_' + key, {mb: fmtMB(tier?.bytes || download?.total || 0)}) + (code ? ' (' + code + ')' : ''); }
  function buildView() {
    if (run?.hidden) return {mode: ''};   // closed with its marks kept: only the marks stay
    const touring = run && !run.empty && ['running', 'preparing', 'ended'].includes(run.state);   // a download beside a running tour: shown in its subtitle line
    if (download?.state === 'running' && !touring) { const percent = download.total ? Math.round(download.loaded / download.total * 100) : 0; return {mode: 'downloading', title: t('tutor_title'), text: t('tutor_downloading', {percent, mb: fmtMB(download.total)}), progress: percent, actions: [['tutor_cancel_download', 'cancelDownload']]}; }
    if (download?.state === 'error' && (!run || run.state === 'offer')) return {mode: 'error', title: t('tutor_title'), text: t('tutor_download_failed') + ' ' + downloadCause(), actions: [['tutor_retry', 'download', {value: download.tier}, true], ['tutor_without_model', 'extractive']]};
    if (!run) return {mode: ''};
    const o = optionView();
    if (run.state === 'offer') {
      /* a stronger model where the browser offers a real GPU (WebGPU): first choice, the small one as "smaller" */
      const small = status?.tiers.find(x => x.id === 'small'), better = status?.tiers.find(x => x.id === 'better' && x.available), first = better || small;
      const acts = better ? [['tutor_download_better', 'download', {value: 'better', params: {mb: fmtMB(better.bytes)}}, true], ['tutor_download_smaller', 'download', {value: 'small', params: {mb: fmtMB(small?.bytes || 0)}}]] : [['tutor_download', 'download', {value: 'small', params: {mb: fmtMB(small?.bytes || 0)}}, true]];
      acts.push(['tutor_without_model', 'extractive']);
      return {mode: 'offer', title: t('tutor_title'), text: t('tutor_offer', {mb: fmtMB(first?.bytes || 0)}), hint: t('tutor_privacy'), actions: acts, options: o};
    }
    if (run.empty) return {mode: 'ended', title: t('tutor_title'), text: t('tutor_empty'), actions: [], options: o};
    /* from here on the slim subtitle line: counter, the spoken sentence (part), one quiet line; options in the menu */
    const n = order(), all = total(), at = run.summaryShown ? all : Math.max(1, n.indexOf(run.current) + 1), ai = run.mode === 'model';
    const loading = download?.state === 'running' ? t('tutor_downloading', {percent: download.total ? Math.round(download.loaded / download.total * 100) : 0, mb: fmtMB(download.total)}) : '', failed = download?.state === 'error' ? t('tutor_download_failed') + ' ' + downloadCause() : '';
    const retry = failed ? [['tutor_retry', 'download', {value: download.tier}, true]] : [], cancelDownload = loading ? [['tutor_cancel_download', 'cancelDownload']] : [];
    const menu = {text: [failed, run.mode === 'extractive' ? fallbackHint() : '', run.silent ? t('tutor_silent', {language: run.language.toUpperCase()}) : ''].filter(Boolean).join(' '), actions: [...retry, ...cancelDownload, ...languageOffer(), ...(loading ? [] : newerOffer()), ['tutor_export', 'export'], ['tutor_clear', 'clear']]};
    /* the quiet line: paused, the step's label, the AI notice (always on AI tours); on step 1 of a tour that reads key sentences because of the language, where the English AI explanation is */
    const quiet = extra => loading || failed || [run.paused ? t('tutor_paused') : '', run.reason === 'tutor_fallback_language' && at === 1 && !run.summaryShown ? t('tutor_meta_keysentences') : extra, ai ? t('tutor_ai_disclaimer') : ''].filter(Boolean).join(' · ');
    if (run.state === 'preparing' || run.current < 0 && !run.summaryShown && run.state !== 'ended') {
      const p = run.progress, phase = p?.phase === 'load' ? t('tutor_loading_model') : p?.phase === 'step' ? t('tutor_writing', {n: p.current, total: p.total}) : t('tutor_preparing');
      return {mode: 'preparing', layout: 'subtitle', title: t('tutor_title'), counter: '', sub: phase, meta: '', progress: null, options: o, menu, actions: []};
    }
    if (run.state === 'ended') {
      const head = run.cancelled ? t('tutor_cancelled') : t('tutor_done', {n: n.length});
      return {mode: 'ended', layout: 'subtitle', title: head, counter: '', sub: [head, loading || failed, ai ? t('tutor_ai_disclaimer') : ''].filter(Boolean).join(' · '), meta: '', ai, options: o, menu: {...menu, actions: [...retry, ...cancelDownload, ...languageOffer(), ...(loading ? [] : newerOffer())]}, actions: [['tutor_again', 'again', null, true], ['tutor_export', 'export'], ...(marksShown() ? [['tutor_clear', 'clear']] : [])], closeKey: prefs().keep && marksShown() ? 'tutor_close_keep' : 'tutor_close'};
    }
    if (run.summaryShown) return {mode: 'running', layout: 'subtitle', step: 'summary', title: summaryTitle(), counter: all + '/' + all, sub: subtitleOf(run.summary.points.join(' ')), meta: quiet(summaryTitle()), ai, options: o, menu, actions: []};
    const step = run.steps[run.current], waiting = !run.playing && !run.paused && !run.wait && nextIndex(run.current) === undefined && !run.planDone;
    const label = step?.source === 'extractive' && step.label ? step.label : step?.note || '', late = step?.source === 'extractive' && run.mode === 'model' ? t(step.late ? 'tutor_step_late' : 'tutor_step_fallback') : '';
    return {mode: 'running', layout: 'subtitle', step: run.current, title: t('tutor_step', {n: at, total: all}), counter: at + '/' + all, sub: waiting ? t('tutor_next_writing') : subtitleOf(step?.say || ''), meta: quiet(label), metaTitle: late || undefined, ai, options: o, menu: {...menu, text: [late, menu.text].filter(Boolean).join(' ')}, actions: []};
  }
  /* the subtitle shows only what is being said: a long text in sentences (a long sentence at its commas), the part
     following the voice (the step's real spoken length, else an estimate) */
  function subtitleParts(text) {
    const out = [];
    for (const s of String(text).match(/[^.!?…]+[.!?…]+["“”»«)\]]*\s*|[^.!?…]+$/gu) || [String(text)]) {
      let rest = s.trim(); if (!rest) continue;
      while (rest.length > 150) { const cut = Math.max(rest.lastIndexOf(', ', 130), rest.lastIndexOf('; ', 130), rest.lastIndexOf(' – ', 130)), at = cut > 50 ? cut + 1 : rest.lastIndexOf(' ', 140); if (at <= 0) break; out.push(rest.slice(0, at).trim()); rest = rest.slice(at).trim(); }
      if (rest) out.push(rest);
    }
    return out.length ? out : [String(text)];
  }
  function subtitleOf(text) {
    const list = subtitleParts(text); if (list.length < 2 || !run.stepStartedAt) return list[0] || '';
    const ms = run.spokenMs?.get(run.summaryShown ? 'summary' : run.current) || estimateMs(text, Number(host.settings().speed) || 1), f = Math.min(1, (run.paused ? run.pausedInto || 0 : Date.now() - run.stepStartedAt) / Math.max(1, ms));
    const sum = list.reduce((a, b) => a + b.length, 0); let acc = 0; for (const p of list) { acc += p.length; if (acc / sum >= f) return p; } return list.at(-1);
  }
  /* the tour runs with the model of an older release: the current one is offered beside it (it replaces the old copy) */
  function newerOffer() { const current = run?.tier === 'legacy' && status?.tiers.find(x => x.id === 'small' && x.offered && x.available && !x.installed); return current ? [['tutor_download_newer', 'download', {value: 'small', params: {mb: fmtMB(current.bytes)}}]] : []; }
  /* -- study sheet: the explained passages with their marks, the explanations and the key points as one HTML file -------- */
  function exportSheet() {
    if (!run) return; const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
    const blocks = host.source().blocks, styles = {circle: 'border:2px solid #1f6b50;border-radius:999px;padding:0 4px', underline: 'text-decoration:underline 2px #1f6b50;text-underline-offset:3px', marker: 'background:#f4c94c88', bracket: 'border-left:3px solid #1f6b50;padding-left:6px'};
    const items = order().map((i, k) => { const s = run.steps[i], text = blocks.find(b => b.id === s.blockId)?.text || '', a = s.anchor, m = s.mark, sentence = text.slice(a.start, a.end); let html = esc(sentence); if (m && m.offset >= a.start && m.offset + m.quote.length <= a.end) { const rel = m.offset - a.start; html = esc(sentence.slice(0, rel)) + '<span style="' + styles[m.style] + '">' + esc(m.quote) + '</span>' + esc(sentence.slice(rel + m.quote.length)); } return `<li><blockquote>${html}</blockquote>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}<p>${esc(s.say)}</p></li>`; });
    const title = doc.title || location.hostname, body = `<!doctype html><html lang="${esc(run.language)}"><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#1d2a24}h1{font-size:22px}blockquote{margin:0 0 6px;padding:8px 12px;background:#f8f5ed;border-radius:8px}.note{font:600 14px "Segoe Print","Comic Neue",cursive;color:#1f6b50;margin:0 0 4px}li{margin:0 0 18px}footer{margin-top:32px;font-size:12px;color:#5b6b63}</style><h1>${esc(title)}</h1><ol>${items.join('')}</ol>${run.summary?.points?.length ? `<h2>${esc(t('tutor_summary_title'))}</h2><ul>${run.summary.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}<footer>beNotable! Reader · ${esc(location.href)}</footer></html>`;
    const url = URL.createObjectURL(new Blob([body], {type: 'text/html'})), a = doc.createElement('a'); a.href = url; a.download = (title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60) || 'erklaerung') + '.html'; a.style.display = 'none'; (host.shadow() || doc.body).append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  /* the bar's timeline moves while a step is spoken */
  const ticker = setInterval(() => { if (run?.playing && !run.paused && !disposed) render(); }, 500);
  return {
    start, toggle, cancel, clear, replay,
    next: () => step(1), previous: () => step(-1),
    /* the bar's Play/Previous/Next belong to the tutor while it runs or shows its end */
    get active() { return !!run && !run.empty && (run.state === 'running' || run.state === 'preparing'); },
    /* the bar (Play, Previous/Next, timeline, step list) belongs to the tour while it is shown: running or at its end */
    get owns() { return !!run && !run.empty && ['running', 'preparing', 'ended'].includes(run.state) && !!view.mode && view.mode !== 'offer'; },
    seek, jump, preparedRanges: () => lastPrepared > 0 ? [[0, lastPrepared]] : [],
    /* The sentence step 1 will speak when the tour will be the key-sentence tour (its language has no AI explanation) and its voice is a local one: the
       session prepares that audio while the bar is open (PageSession.prepareTour), so Zusammenfassen speaks without waiting for a synthesis. null otherwise. */
    firstStep() {
      if (run && run.state !== 'ended' || AI_LANGUAGES.includes(language())) return null;
      const lang = pageLanguage(), voice = host.voiceFor(lang); if (voice?.voice?.kind !== 'neural') return null;
      const {scope} = scopeOf(), first = anchors(host.source(), {depth: prefs().depth, language: lang, scope})[0]; if (!first) return null;
      const say = extractiveStep(first, label).say; return say ? {text: say, words: words(say), lang, voice: voice.spec, normalize: host.settings().normalizeSpeech !== false} : null;
    },
    get visible() { return view.mode !== ''; },
    view() { if (!run) return null; const p = progress(); return {state: run.state, mode: run.mode, playing: run.playing && !run.paused, paused: run.paused, loading: run.state === 'preparing' || !!run.wait, step: run.summaryShown ? total() : Math.max(0, order().indexOf(run.current) + 1), total: total(), canPrevious: order().length > 0, canNext: run.state !== 'ended' && nextIndex(run.current) !== undefined || (run.planDone && !run.summaryShown && run.summary?.points?.length > 0), progress: p}; },
    /* settings of the bar while a step is spoken */
    settingsChanged(keys) {
      const s = host.settings();
      for (const p of run?.pipelines.values() || []) { if (keys.includes('speed')) p.setRate?.(s.speed); if (keys.includes('volume') || keys.includes('muted')) p.setVolume?.(s.muted ? 0 : (s.volume ?? 100) / 100); if (['pitch', 'bass', 'treble'].some(k => keys.includes(k))) p.setFx?.({pitch: s.pitch ?? 0, bass: s.bass ?? 0, treble: s.treble ?? 0, gapMs: 0}); }
      /* scope, depth or language changed (settings panel, the card's menu, another tab): a shown tour starts again with them */
      if (['explainScope', 'explainDepth', 'explainLanguage'].some(k => keys.includes(k))) {
        if (keys.includes('explainLanguage')) english = false;   // "Auf Englisch erklären (KI)" lasts until the language itself is chosen
        const p = prefs();
        if (run && !run.empty && !run.hidden && (run.scopeSetting !== p.scope || run.depth !== p.depth || run.language !== language())) { void begin(false); return; }
      }
      if (keys.includes('explainKeepMarks') && run?.state === 'ended' && !prefs().keep) hideMarks();   // switched off at the end: the marks go now
      if (keys.some(k => k === 'uiLanguage' || k.startsWith('explain'))) render();
    },
    /* the session read its page again: a tour whose text changed (other route, edited article) ends and removes its marks */
    sourceChanged() { if (!run) return; const source = host.source(); if (signature(source) !== run.signature) clear('source-changed'); },
    /* the page range of a step's sentence (tests compare the passage band with it) */
    rangeOfStep(index) { const step = run?.steps[index]; return step ? host.rangeOf(step.blockId, step.anchor.start, step.anchor.end) : null; },
    snapshot() { const fg = marks?.focusGeometry?.(); return {cleared, focus: fg?.focus || null, word: fg?.word || null, run: run ? {state: run.state, scope: run.scopeKind, scopeSetting: run.scopeSetting, depth: run.depth, hidden: !!run.hidden, marksHidden: !!run.marksHidden, language: run.language, cancelled: !!run.cancelled, mode: run.mode, current: run.current, summaryPlayed: !!run.summaryPlayed, steps: run.steps.map(s => s ? {index: s.index, kind: s.kind, style: s.mark?.style, quote: s.mark?.quote, note: s.note, say: s.say, source: s.source, label: s.label || '', late: !!s.late, onPage: !!marks?.has(s.index)} : s), summary: run.summary, timing: run.timing, silent: !!run.silent, spoken: run.spoken || 0, silentSteps: run.silentSteps || 0, voiceKind: run.voiceKind || '', firstStepMs: run.firstStepMs || 0, voiceFailed: run.voiceFailed || 0, stage: run.stage || '', speakError: run.speakError || '', error: run.error || '', voiceName: run.voices.get(run.language)?.voice?.id || run.voices.get(pageLanguage())?.voice?.id || '', anchors: run.anchors.length, failure: run.failure || '', reason: run.reason || ''} : null, view, marks: marks?.snapshot() || null, download}; },
    dispose() { if (disposed) return; disposed = true; clearInterval(ticker); stopRun(); marks?.dispose(); card?.destroy(); try { port?.disconnect(); } catch {} port = null; },
  };
}
