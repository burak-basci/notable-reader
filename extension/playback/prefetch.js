/* beNotable! Reader playback · priority look-ahead synthesis (own code, MIT). The scheduler of the 1.6.24 companion (prefetch.py), rebuilt for the in-browser engine.
   Three tiers, always served in this order:
     near     the section being started or read and the `window` sections after it (strong: 3 sections ahead, never held back by a budget)
     visible  every section that is on screen right now (reported by the page; medium)
     rest     everything else AFTER the position, in reading order (lowest priority: only when nothing above is waiting, only inside the memory budget)
     behind   when the rest is done: the text BEFORE the position, nearest first (a jump back finds it), inside the budget
   A higher tier overtakes a lower one in the queue; a running `rest`/`visible` job is aborted at once (per-request AbortSignal, the engine drops it) when a `near` job is needed and the audio ahead
   would run dry (`urgent`). Results go to onResult(index, result, tier); no PCM is kept here. A generation guards every await: seek, voice change and stop discard in-flight work.
   Work that the position passed while it ran is finished and delivered (tier `behind`, the pipeline holds it): aborting it would throw finished audio away.
   `parallel` (number or function) = sections synthesized at the same time (1 where the engine has WASM threads; 2 on Firefox, where the engine runs two single-thread workers).
   `hold()` true = start nothing now (background work waits: hidden tab, user interaction, low battery); the owner calls pump() when it may go on. */
export const TIERS = ['near', 'visible', 'rest', 'behind'];
export function createPrefetcher({synthesize, onResult, onError = () => {}, onEvent = () => {}, count, window: windowOption = 3, parallel = 1, background = true, allow = () => true, urgent = () => true, reserved = () => 0, hold = () => false}) {
  const nearWindow = () => typeof windowOption === 'function' ? windowOption() : windowOption;      // a number, or asked each time (the pipeline widens it for a heavy voice)
  let generation = 0, from = 0, wanted = true, armed = false, visible = new Set();      // armed: nothing is prepared before the first request(position)
  const done = new Set(), failed = new Map(), inflight = new Map(), refused = new Map();      // inflight: index -> {gen, tier, ctl}; failed: index -> {error, tier}
  const limit = () => Math.max(1, Math.floor(typeof parallel === 'function' ? parallel() : parallel) || 1);
  const refuse = index => { const count = (refused.get(index) || 0) + 1; refused.set(index, count); return count; };
  const active = () => [...inflight.values()].filter(j => j.gen === generation).length + Math.max(0, Number(reserved()) || 0);
  /* 'behind' sections (before the position) are never prefetched; the section just read stays where the pipeline keeps it. */
  const tierOf = i => i < from ? 'behind' : i <= from + nearWindow() ? 'near' : visible.has(i) ? 'visible' : 'rest';
  /* The next section to synthesize: lowest tier first, inside a tier nearest to the position first. A failed section is skipped except when it becomes `near` after failing as background work. */
  function pickNext() {
    const free = i => !done.has(i) && !inflight.has(i) && !(failed.has(i) && (failed.get(i).tier === 'near' || tierOf(i) !== 'near'));
    for (let i = from, end = Math.min(count - 1, from + nearWindow()); i <= end; i++) if (free(i)) return {index: i, tier: 'near'};
    if (!background) return null;
    const w = nearWindow(), seen = [...visible].filter(i => i > from + w && i < count).sort((a, b) => a - b);
    for (const i of seen) if (free(i) && allow('visible', i)) return {index: i, tier: 'visible'};
    for (let i = from + w + 1; i < count; i++) if (free(i) && !visible.has(i)) { if (!allow('rest', i)) return null; return {index: i, tier: 'rest'}; }
    for (let i = from - 1; i >= 0; i--) if (free(i) && !visible.has(i)) { if (!allow('behind', i)) return null; return {index: i, tier: 'behind'}; }
    return null;
  }
  function start({index, tier}) {
    const gen = generation, ctl = new AbortController(), job = {gen, tier, ctl}; inflight.set(index, job); onEvent({index, tier, phase: 'start'});
    const settle = () => { if (inflight.get(index) === job) inflight.delete(index); };
    synthesize(index, {tier, signal: ctl.signal}).then(result => {
      settle();
      if (gen === generation) { done.add(index); refused.delete(index); onEvent({index, tier, phase: 'done'}); onResult(index, result, tierOf(index)); }       // a result of an invalidated generation is dropped
      pump();
    }, error => {
      settle();
      if (ctl.signal.aborted) { onEvent({index, tier, phase: 'abort'}); }          // dropped by us (preempted / jump / stop): not a failure, picked again later if still wanted
      else if (error?.name === 'AbortError' && gen === generation && refuse(index) > 3) {      // the ENGINE refused the same section again and again (its generation was cancelled elsewhere): a failure, never an endless retry loop
        const failure = Object.assign(Error('Die lokale Berechnung wurde mehrfach abgebrochen.'), {code: 'aborted-repeatedly'}); failed.set(index, {error: failure, tier: tierOf(index)}); onError(index, failure, tierOf(index));
      }
      else if (error?.name === 'AbortError') { onEvent({index, tier, phase: 'abort'}); }
      else if (gen === generation) { failed.set(index, {error, tier: tierOf(index)}); onError(index, error, tierOf(index)); }
      pump();
    });
  }
  /* A needed `near` job but every slot is busy: drop the worst running background job (the farthest `rest`, else `visible`) when the audio ahead would run dry. */
  function preempt(next) {
    if (next.tier !== 'near' || !urgent()) return;
    let victim = null, rank = -1;
    for (const [index, job] of inflight) { if (job.gen !== generation || job.ctl.signal.aborted) continue; const t = tierOf(index), r = t === 'rest' || t === 'behind' ? 2 : t === 'visible' ? 1 : -1 /* a job inside the near window by now is needed anyway: never a victim */; if (r > rank || r === rank && victim && index > victim.index) { rank = r; victim = {index, job}; } }
    if (victim && rank > 0) victim.job.ctl.abort();
  }
  function pump() {
    if (!wanted || !armed || hold()) return;
    for (;;) {
      const next = pickNext(); if (!next) return;
      if (active() >= limit()) { preempt(next); return; }
      start(next);
    }
  }
  const abortAll = () => { for (const job of inflight.values()) job.ctl.abort(); inflight.clear(); };
  return {
    /* Position moved: the near window starts at `index`; a failed section may be retried explicitly. Running work behind the position is finished (its
       audio is valid and held; aborting a busy worker costs a model load); a jump that needs the worker at once uses restart(). */
    request(index) {
      from = Math.max(0, index); failed.delete(from); wanted = true; armed = true;
      pump();
    },
    /* Page report: the sections on screen right now (medium priority). */
    setVisible(indices) { visible = new Set((indices || []).filter(i => Number.isInteger(i) && i >= 0 && i < count)); pump(); },
    tierOf,
    ready: index => done.has(index),
    running: index => inflight.get(index)?.gen === generation,
    mark(index) { done.add(index); }, unmark(index) { done.delete(index); },
    forget(before, keep = () => false) { for (const i of [...done]) if (i < before && !keep(i)) done.delete(i); },
    /* Everything is discarded (voice/document change, load). */
    invalidate() { generation++; armed = false; abortAll(); done.clear(); failed.clear(); refused.clear(); },
    /* A jump to a section that is not prepared: in-flight work is dropped, what was already synthesized and is still held (`keep`) stays valid. */
    restart(keep = []) { generation++; abortAll(); failed.clear(); const held = new Set(keep); for (const i of [...done]) if (!held.has(i)) done.delete(i); },
    pause() { wanted = false; }, resume() { wanted = true; pump(); },
    pump,
    status() { return {from, window: nearWindow(), visible: [...visible].sort((a, b) => a - b), done: [...done].sort((a, b) => a - b), inflight: [...inflight].map(([index, j]) => ({index, tier: j.tier})), failed: [...failed.keys()]}; },
    get generation() { return generation; },
    get readyCount() { return done.size; },
  };
}
