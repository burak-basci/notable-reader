// Reader-owned roots only; the visited page keeps its original scrollbars.
// Both functions are self-contained so the native surface uses the same source.
export function readerScrollbarCss(scope='shadow') {
  const selectors=scope==='shadow'?['*']:['[data-reader-scrollbars-root]','[data-reader-scrollbars-root] *'];
  const all=selectors.join(','),pseudo=name=>selectors.map(s=>s+'::'+name).join(',');
  return `${all}{scrollbar-width:thin;scrollbar-color:var(--reader-muted,var(--muted,#65756a)) var(--reader-paper,var(--paper,#fff))}
@supports selector(::-webkit-scrollbar){
${all}{scrollbar-width:auto!important;scrollbar-color:auto!important}
${pseudo('-webkit-scrollbar')}{width:10px;height:10px}
${pseudo('-webkit-scrollbar-track')}{background:var(--reader-paper,var(--paper,#fff));border-radius:10px}
${pseudo('-webkit-scrollbar-thumb')}{background:var(--reader-muted,var(--muted,#65756a));border:2px solid transparent;background-clip:padding-box;border-radius:10px;min-height:28px}
${pseudo('-webkit-scrollbar-thumb:hover')}{background-color:var(--reader-accent,var(--accent,#256249))}
${pseudo('-webkit-scrollbar-corner')}{background:var(--reader-paper,var(--paper,#fff))}
}`;
}

export function installReaderScrollbars(root,{ownPage=false}={}) {
  if(!root?.querySelector)return null;
  const doc=root.nodeType===9?root:root.ownerDocument;
  if(!doc)return null;
  const isDocument=root.nodeType===9;
  if(isDocument&&!ownPage&&!/^(chrome|moz)-extension:$/u.test(doc.location?.protocol||''))return null;
  const existing=root.querySelector('style[data-reader-scrollbars-style]');
  if(existing)return existing;
  if(isDocument)doc.documentElement.setAttribute('data-reader-scrollbars-root','');
  const style=doc.createElement('style');style.setAttribute('data-reader-scrollbars-style','');
  style.textContent=readerScrollbarCss(isDocument?'document':'shadow');
  (isDocument?(doc.head||doc.documentElement):root).append(style);
  return style;
}
