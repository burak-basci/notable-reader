// Autoplay-Regeln: Chrome, Firefox und Safari starten Audio nur nach einer Nutzergeste oder in Dokumenten mit Ausnahme
// (Chrome-Offscreen mit Grund AUDIO_PLAYBACK). Dieses Tor kapselt "versuchen, bei NotAllowedError auf die naechste Geste warten",
// damit Wiedergabe nie still scheitert. Reine Logik; Fenster/Audio kommen als Argumente (Tests mit Fakes).
const GESTURES = ['pointerdown', 'keydown', 'touchend', 'click'];

export function isAutoplayBlock(error) { return error?.name === 'NotAllowedError'; }

/**
 * @param {{target?:EventTarget, onBlocked?:()=>void, onUnblocked?:()=>void, context?:{state:string, resume():Promise<void>}}} [options]
 */
export function createAudioGate({target = globalThis, onBlocked = () => {}, onUnblocked = () => {}, context = null} = {}) {
  const waiting = [];
  let armed = false, blocked = false;
  const release = async () => {
    for (const name of GESTURES) target.removeEventListener?.(name, release, true);
    armed = false;
    try { if (context && context.state === 'suspended') await context.resume(); } catch {}
    const list = waiting.splice(0);
    let ok = true;
    for (const attempt of list) { try { await attempt.run(); attempt.resolve(); } catch (error) { ok = false; if (isAutoplayBlock(error)) { arm(); waiting.push(attempt); } else attempt.reject(error); } }
    if (ok && blocked && waiting.length === 0) { blocked = false; onUnblocked(); }
  };
  function arm() {
    if (armed) return;
    armed = true;
    for (const name of GESTURES) target.addEventListener?.(name, release, {capture: true});
  }
  return {
    get blocked() { return blocked; },
    /** Fuehrt einen Startversuch aus (z. B. () => audio.play()); bei Autoplay-Sperre wartet er auf die naechste Geste. */
    async run(run) {
      try { if (context && context.state === 'suspended') await context.resume(); await run(); return 'started'; }
      catch (error) {
        if (!isAutoplayBlock(error)) throw error;
        if (!blocked) { blocked = true; onBlocked(); }
        arm();
        await new Promise((resolve, reject) => waiting.push({run, resolve, reject}));
        return 'started-after-gesture';
      }
    },
    dispose() { for (const name of GESTURES) target.removeEventListener?.(name, release, true); armed = false; for (const a of waiting.splice(0)) a.reject(new Error('disposed')); }
  };
}
