/* beNotable! Reader playback · exclusive playback right across tabs/pages: Web Lock `notable-playback`.
   The newest session steals the lock; the previous holder gets onPreempt and pauses (own code, MIT). */
export const LOCK_NAME = 'notable-playback';
export async function acquirePlayback({locks = globalThis.navigator?.locks, onPreempt = () => {}} = {}) {
  if (!locks?.request) return {release() {}, supported: false};
  let release = () => {}, settled = false;
  const held = new Promise(resolve => { release = () => { settled = true; resolve(); }; });
  await new Promise((granted, failed) => {
    locks.request(LOCK_NAME, {steal: true}, () => { granted(); return held; })
      .catch(error => { if (!settled && error?.name === 'AbortError') { settled = true; onPreempt(); } else if (!settled) failed(error); });
  });
  return {release, supported: true};
}
