/* beNotable! Reader session · the ONE wiring of text marks, follow scrolling and click-to-seek (own code, MIT).
   Used by the page session (content script) AND by the file view / Focus Reader (reader.html): same modules (page-highlight, follow-zone), same
   settings keys (markWord, markTint, markCorners, follow, followPosition, followMode, followMargin, clickSeek). A difference between the two views is a bug.
   `settings()` returns the live settings object; `blockEls(bi)` the element of a block (paragraph/section jumps of the follow zone). */
import {createPageHighlight} from './page-highlight.mjs';
import {createFollowZone, watchScrollGestures} from './follow-zone.mjs';
import {marksFrom} from './mark-settings.mjs';
const markArgs = s => { const m = marksFrom(s); return {word: m.markWord, tint: m.markTint, corners: m.markCorners, style: s?.markStyle}; };

export function createReadingMarks({doc = document, chunks, blocks, textNodes, blockEls = () => null, settings, getBar = () => null, ownHost = () => null, onSeek, onFollowOff}) {
  let list = chunks;
  const highlight = createPageHighlight({doc, chunks, blocks, textNodes, onSeek, onUserScroll: () => {}, marks: markArgs(settings())});
  /* Follow policy of 1.6.24: reading height/band/mode from the saved settings, the user's own scroll gestures decide (an upward scroll switches following off for good). */
  const zone = createFollowZone({doc, getBar, isOwnNode: n => !!ownHost()?.contains(n), settings, blockElement: blockEls});
  highlight.follow.configure(zone, {onFollowOff});
  const stopGestures = watchScrollGestures({win: doc.defaultView, isExcluded: e => !!ownHost() && e.composedPath().includes(ownHost()), onGesture: () => highlight.follow.gesture()});
  highlight.setFollow(settings().follow); highlight.setClickSeek(settings().clickSeek);
  return {
    highlight, zone,
    /* Marks a word and tells the follow zone which block it belongs to (paragraph/section jump rules). */
    markAt(chunk, word) { zone.setBlock(list[chunk]?.block ?? -1); return highlight.mark(chunk, word); },
    /* The text was re-read: same listeners, new arrays. */
    update(next, keepAt = null) { list = next.chunks; zone.reset?.(); highlight.update(next, keepAt); },
    /* A setting changed (same keys as the bar sends). */
    apply(key, value, s = settings()) {
      if (key === 'follow') highlight.setFollow(value);
      else if (key === 'clickSeek') highlight.setClickSeek(value);
      else if (key === 'markWord' || key === 'markTint' || key === 'markCorners' || key === 'markSection' || key === 'markStyle') highlight.setMarks(markArgs(s));
    },
    dispose() { stopGestures?.(); highlight.follow?.dispose?.(); highlight.dispose?.(); },
  };
}
