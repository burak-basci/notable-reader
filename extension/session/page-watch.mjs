/* beNotable! Reader session · page watch (own code, MIT).
   Tells the session when the text it collected may be out of date: content rendered after the bar opened, a single-page-app route change,
   "load more" appends. It never reads page text. Mutations are weighed by size only (a few characters ticking, e.g. a clock, are ignored),
   then debounced (quiet window, maximum wait) and rate limited (minimum gap), so an idle page costs nothing and a busy one at most one rescan per gap.
   Navigation without DOM change (URL only) is caught by popstate/hashchange/Navigation API plus a cheap 1 s URL comparison while the tab is visible. */
const UI = '[data-notable-reader-surface],[data-notable-reader-ui],[data-notable-appearance],[data-notable-quick-actions],[data-reader-explain-panel],[data-reader-tutor-marks]';
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);

export function createPageWatch({doc = document, onChange, isEmpty = () => false, threshold = 120, quiet = 700, maxWait = 3000, minGap = 1500, urlEvery = 1000} = {}) {
  const win = doc.defaultView;
  let observer = null, structural = 0, texts = new Map(), gap = minGap, quietTimer = 0, maxTimer = 0, lastRun = -1e9, urlTimer = 0, href = win.location.href, stopped = false;
  const ours=node=>{for(let e=node.nodeType===1?node:node.parentElement;e;e=e.parentElement||e.getRootNode?.().host){if(SKIP.has(e.tagName)||e.matches?.(UI))return true;}return false;};
  const clearTimers = () => { win.clearTimeout(quietTimer); win.clearTimeout(maxTimer); quietTimer = maxTimer = 0; };
  const fire = reason => {
    if (stopped) return;
    clearTimers(); structural = 0; texts.clear(); lastRun = win.performance.now(); href = win.location.href;
    let changed = true;
    try { changed = onChange({reason}) !== false; } catch {}
    gap = changed ? minGap : Math.min(30000, gap * 2);              // a page that keeps re-rendering the same text (widgets, tickers) is scanned less and less often
  };
  const schedule = reason => {
    if (stopped) return;
    const wait = reason === 'navigation' ? quiet : Math.max(quiet, lastRun + gap - win.performance.now());   // a new URL is never held back by the backoff
    win.clearTimeout(quietTimer); quietTimer = win.setTimeout(() => fire(reason), wait);
    if (!maxTimer) maxTimer = win.setTimeout(() => fire(reason), Math.max(maxWait, wait));
  };
  const onRecords = records => {
    /* New or removed elements count in full; changed text counts once per target (the largest change), so a clock that rewrites "12:03:01" stays small. */
    for (const r of records) {
      if (r.type === 'characterData') { if (!ours(r.target)) texts.set(r.target, Math.max(texts.get(r.target) || 0, Math.min(500, r.target.data.length))); continue; }
      if (ours(r.target)) continue;
      let text = 0;
      for (const list of [r.addedNodes, r.removedNodes]) for (const n of list) { if (n.nodeType === 3) text += n.data.trim().length; else if (n.nodeType === 1 && !ours(n)) structural += /\S/u.test(n.textContent||'') ? threshold : 100; }
      if (text) texts.set(r.target, Math.max(texts.get(r.target) || 0, Math.min(500, text)));
    }
    let weight = structural; for (const v of texts.values()) weight += v;
    if (weight >= (isEmpty() ? 1 : threshold)) schedule('mutation');
    else if (win.location.href !== href) schedule('navigation');
  };
  let shadowRoots=new Set(),ticks=0;
  const OPTIONS={subtree:true,childList:true,characterData:true};
  const walkRoots=(root,found)=>{
    for(const e of root.querySelectorAll('*'))if(e.shadowRoot&&!ours(e)){
      found.add(e.shadowRoot);walkRoots(e.shadowRoot,found);
    }
  };
  const observeRoots=()=>{
    const found=new Set();walkRoots(doc,found);
    const changed=found.size!==shadowRoots.size||[...found].some(r=>!shadowRoots.has(r));
    if(changed){
      observer.disconnect();observer.observe(doc.documentElement,OPTIONS);
      for(const root of found)observer.observe(root,OPTIONS);shadowRoots=found;
    }
    return changed;
  };
  // Per mutation only the added subtrees are searched for shadow roots (a streaming chat adds a few nodes per batch;
  // the whole-document walk per batch cost milliseconds each). The periodic full walk still finds roots attached to
  // existing elements, which cause no light-DOM mutation, and drops removed ones.
  const addedRoots=records=>{
    for(const r of records)for(const n of r.addedNodes){
      if(n.nodeType!==1||ours(n))continue;
      const found=new Set();walkRoots(n,found);
      if(n.shadowRoot){found.add(n.shadowRoot);walkRoots(n.shadowRoot,found);}
      for(const root of found)if(!shadowRoots.has(root)){shadowRoots.add(root);observer.observe(root,OPTIONS);}
    }
  };
  observer=new win.MutationObserver(records=>{addedRoots(records);onRecords(records);});
  observer.observe(doc.documentElement,OPTIONS);observeRoots();
  const events = ['popstate', 'hashchange'], listener = () => schedule('navigation');
  for (const type of events) win.addEventListener(type, listener);
  win.navigation?.addEventListener?.('navigatesuccess', listener);
  urlTimer = win.setInterval(() => {
    if(doc.visibilityState!=='visible')return;
    if(++ticks%3===0&&observeRoots())schedule('shadow');          // full walk every third tick: late shadow roots
    if(win.location.href!==href)schedule('navigation');
  }, urlEvery);
  return {
    /* run now (a user action such as Play wants the freshest text) */
    flush(reason = 'flush') { fire(reason); },
    stop() { stopped = true; observer?.disconnect(); clearTimers(); win.clearInterval(urlTimer); for (const type of events) win.removeEventListener(type, listener); win.navigation?.removeEventListener?.('navigatesuccess', listener); },
  };
}
