/* Scan detection · own code MIT.
 * A page counts as "sparse" when its text layer has fewer than MIN_CHARS non-blank characters. 25 is above what a scanner or a viewer leaves behind
 * (page number, running head, "Scanned by ..." stamp: 1-24 characters) and far below any page of real prose (several hundred). A document is offered
 * OCR when MORE THAN HALF of its pages are sparse; a text PDF with a few blank or picture-only pages stays untouched. */
export const MIN_CHARS = 25;
export const SPARSE_SHARE = 0.5;

/** Non-blank characters of the text items of one page. */
export const visibleChars = items => { let count = 0; for (const item of items || []) if (typeof item?.str === 'string') count += item.str.replace(/\s+/gu, '').length; return count; };

/** counts: visible characters per page (index 0 = page 1). Returns {scan, sparsePages (1-based), share}. */
export function scanVerdict(counts, {minChars = MIN_CHARS, share = SPARSE_SHARE} = {}) {
  const sparsePages = [];
  counts.forEach((count, index) => { if (count < minChars) sparsePages.push(index + 1); });
  const ratio = counts.length ? sparsePages.length / counts.length : 0;
  return {scan: counts.length > 0 && ratio > share, sparsePages, share: ratio};
}
