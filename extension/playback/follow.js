/* beNotable! Reader playback · Text-following decision logic (no DOM). Exactly one owner moves the scroll position: this controller.
   Two modes:
   - zone mode (the reader session, `configure(env)`): the follow policy of 1.6.24. A user gesture (wheel, key, drag) never pulls back while it runs
     (400 ms quiet). Afterwards the word decides by its zone around the reading height: inside the band nothing moves; ABOVE the band (the user scrolled
     DOWN, e.g. to look at a figure) following stays on and waits, picking the reading line up again when it re-enters; BELOW the band (the user scrolled
     UP) following switches OFF and stays off (onFollowOff lets the surface and the saved setting follow). Jump rules per followMode:
     paragraph (every new body paragraph), section (new heading section) and line. The env measures the real page (session/follow-zone.mjs).
   - simple mode (no env: an adapter that only supplies visibility()/scrollTo()): manual scrolling pauses following for holdMs (own code, MIT). */
export function createFollowController({now = () => Date.now(), holdMs = 4000, gestureMs = 400, visibility, scrollTo, enabled = true, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = id => clearTimeout(id)}) {
  let follow = enabled, holdUntil = 0, ownScrollUntil = 0, last = null;
  /* zone mode state */
  let env = null, hold = false, pending = false, gestureUntil = 0, timer = null, followedSection, followedBlock = -1, followedLine = null, onFollowOff = null;
  const reveal = (ref, force) => {
    if (!ref) return false;
    const where = visibility(ref);
    if (!force && where === 'visible') return false;
    ownScrollUntil = now() + 700;                    // scroll events caused by this move are not the user's
    scrollTo(ref, where);
    return true;
  };
  const forget = () => { followedSection = undefined; followedBlock = -1; followedLine = null; };
  /* Port of bridge.mjs revealWord (1.6.24). Returns true when the page was scrolled. */
  function zone(ref, force) {
    const m = env.measure(ref); if (!m) return false;
    const {dy, band} = m; let pickup = false;
    if (force) hold = false;
    else if (!follow) { hold = false; pending = false; return false; }
    else if (pending || hold) {
      const gesture = now() < gestureUntil; if (!gesture) pending = false;
      if (dy < -band) { hold = true; return false; }                                       // word above the band: the user is looking further down
      if (dy > band) { pending = false; hold = false; follow = false; onFollowOff?.(); return false; }   // word below the band: the user scrolled up -> following off
      if (gesture) return false;
      if (hold) { hold = false; pickup = true; }
    }
    const outside = Math.abs(dy) > band, mode = m.mode;
    const sectionBoundary = mode !== 'line' && m.section !== null && followedSection !== m.section; followedSection = m.section;
    const blockChanged = followedBlock !== m.block; followedBlock = m.block;
    const paragraphBoundary = mode === 'paragraph' && blockChanged && m.paragraph, boundary = sectionBoundary || paragraphBoundary;
    const lineChanged = !followedLine || followedLine.block !== m.block || Math.abs(m.line.top - followedLine.top) > m.line.height * .5; followedLine = {block: m.block, top: m.line.top};
    const jump = force || pickup || outside || boundary || (mode === 'line' && lineChanged);
    return env.scroll(m, jump) === true;
  }
  return {
    /* Zone mode: env = {measure(ref) -> {dy,dx,band,container,block,section,paragraph,line,mode}|null, scroll(m, jump) -> bool}; onFollowOff() is called when the user's upward scroll ends following. */
    configure(next, callbacks = {}) { env = next; onFollowOff = callbacks.onFollowOff || null; hold = pending = false; forget(); },
    /* New word marked. Returns true when the page was scrolled. */
    onWord(ref) {
      last = ref;
      if (env) return zone(ref, false);
      if (!follow || now() < holdUntil) return false; return reveal(ref, false);
    },
    /* A user scroll gesture (wheel/keys/drag/touch). Zone mode: opens the gesture window and re-evaluates the reading line once it is quiet. */
    onUserScroll() {
      if (env) return;                                                                        // zone mode takes gestures only from gesture(), never from stray scroll events
      if (now() < ownScrollUntil) return; holdUntil = now() + holdMs;
    },
    gesture() {
      if (!env || !follow) return;
      pending = true; gestureUntil = now() + gestureMs; clearTimer(timer);
      timer = setTimer(() => { timer = null; if (follow && (pending || hold) && last) zone(last, false); }, gestureMs + 30);
    },
    setFollow(value) {
      follow = value === true; hold = pending = false; if (env) { forget(); clearTimer(timer); timer = null; if (follow && last) return zone(last, true); return false; }
      if (follow) { holdUntil = 0; return reveal(last, true); } return false;
    },
    /* "Back to the reading position" (also when switching click-to-seek on). */
    jumpToCurrent() { holdUntil = 0; hold = pending = false; if (env) return last ? zone(last, true) : false; return reveal(last, true); },
    dispose() { clearTimer(timer); timer = null; },
    get following() { return env ? follow && !hold : follow && now() >= holdUntil; },
    get enabled() { return follow; },
  };
}
