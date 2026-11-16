/* beNotable! Reader playback · click-to-seek: gesture filter and char offset -> {chunk, word} (own code, MIT).
   Same thresholds as the companion bar: left button, no modifiers, movement <= 5 px. */
import {wordAtChar} from './timeline.js';
export const CLICK_SLOP_PX = 5;
export function isPlainClick(down, up, slop = CLICK_SLOP_PX) {
  if (!down || !up || up.button !== 0 || down.pointerId !== up.pointerId) return false;
  if (up.shiftKey || up.ctrlKey || up.metaKey || up.altKey) return false;
  return Math.hypot(up.clientX - down.clientX, up.clientY - down.clientY) <= slop;
}
/* offsetsByChunk[i] = wordOffsets(chunk text, words) or null. Returns null when the chunk has no word list. */
export function resolveSeek(offsetsByChunk, {chunkIndex, charStart}) {
  const offsets = offsetsByChunk[chunkIndex];
  if (!Number.isInteger(chunkIndex) || !offsets) return null;
  return {chunk: chunkIndex, word: wordAtChar(offsets, Math.max(0, charStart | 0))};
}
