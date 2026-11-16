import {libraryText} from '../library/i18n.mjs';
/* The session owns this small action; all page/file surfaces share it. No page
 * text is altered, and only an explicit click sends a bookmark write. */
export function installBookmarkAction(surface,{getLanguage,getState,onState,onToggle}={}){
 const root=surface?.shadow,host=surface?.refs?.bookmarkHost||root?.querySelector('.reader-bookmark-slot');if(!host)return {sync(){},destroy(){}};
 const doc=host.ownerDocument,button=doc.createElement('button'),style=doc.createElement('style');
 button.type='button';button.className='bookmark-current';button.dataset.bookmarkCurrent='';button.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>';
 style.textContent='.bookmark-current{flex:none!important;display:inline-flex;align-items:center;justify-content:center;width:24px;min-width:24px;height:24px;min-height:24px;padding:3px!important;border:1px solid transparent!important;border-radius:5px;background:transparent!important;color:var(--reader-muted);cursor:pointer}.bookmark-current:hover:not(:disabled),.bookmark-current:focus-visible{border-color:var(--reader-accent)!important;color:var(--reader-accent);outline:none}.bookmark-current:disabled{opacity:.4;cursor:default}.bookmark-current svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.7}.bookmark-current[data-saved] svg{fill:var(--reader-accent);stroke:var(--reader-accent)}';root.append(style);host.prepend(button);
 let busy=false,saved=false,disposed=false,loadedKey='',serial=0,refreshPending=false;
 const key=()=>{const s=getState?.();return s?String(s.generation)+'|'+s.char:'';};
 const paint=()=>{if(disposed)return;const state=getState?.(),label=libraryText(getLanguage?.(),saved?'removeBookmark':'addBookmark');button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(saved));button.setAttribute('aria-busy',String(busy));button.disabled=busy||!state?.ready;button.toggleAttribute('data-saved',saved);};
 const sync=()=>{if(disposed)return;if(busy){paint();return;}const current=key(),state=getState?.();if(!state?.ready){serial++;loadedKey='';saved=false;paint();return;}if(current!==loadedKey){loadedKey=current;saved=false;const request=++serial;void Promise.resolve().then(()=>onState?.()).then(result=>{if(disposed||busy||request!==serial||key()!==current)return;if(result?.ok){saved=result.saved===true;paint();}}).catch(()=>{});}paint();};
 const refresh=()=>{if(disposed)return;if(busy){refreshPending=true;return;}loadedKey='';sync();};
 const click=async()=>{if(button.disabled||busy)return;const sourceKey=key();busy=true;serial++;paint();try{const result=await onToggle?.();if(result?.ok&&!result.private&&key()===sourceKey){loadedKey=sourceKey;saved=result.saved===true;}}finally{busy=false;paint();if(refreshPending||key()!==sourceKey){refreshPending=false;refresh();}else sync();}};button.addEventListener('click',click);sync();
 return {sync,refresh,destroy(){disposed=true;serial++;button.removeEventListener('click',click);button.remove();style.remove();}};
}
