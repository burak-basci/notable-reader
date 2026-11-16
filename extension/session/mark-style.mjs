/* beNotable! Reader · color and strength of the text marks (own code, MIT). Pure functions, no DOM except `measureContext` (reads computed colors of a document).
   ONE place that turns the saved style {wordColor, wordAlpha, sectionColor, tintAlpha, cornerAlpha} into colors. The page highlight (CSS of the word fill, overlay of frame / tint / corner marks), the settings preview
   and the contrast warning all call these functions, so what the preview shows is what is drawn.
   The DEFAULT style (all null / 14 / 50) produces exactly the 1.6.24 palette that the marks had before this setting existed: #ffec95 / #ffbf00 / amber #c68b00 / wash rgb(255,215,35). */
export const ORIGINAL = Object.freeze({amber: '#c68b00', normal: '#ffec95', strong: '#ffbf00', strongEdge: '#7a4a00', ink: '#14170f', wash: '#ffd723'});
export const STYLE_DEFAULTS = Object.freeze({wordColor: null, wordAlpha: null, sectionColor: null, tintAlpha: 14, cornerAlpha: 50});
export const STYLE_RANGES = Object.freeze({wordAlpha: [20, 100], tintAlpha: [5, 40], cornerAlpha: [30, 100]});
/* Presets: Standard (= the original palette) first, then the original 1.6.24 colors and well readable alternatives. [id, hex | null] */
export const WORD_PRESETS = Object.freeze([['default', null], ['yellow', '#ffec95'], ['amber', '#ffbf00'], ['orange', '#ffc78a'], ['green', '#b7e4c7'], ['blue', '#a9d6ff'], ['pink', '#ffc2d9'], ['violet', '#d9c2ff']]);
export const SECTION_PRESETS = Object.freeze([['default', null], ['gold', '#ffd723'], ['orange', '#ffa94d'], ['green', '#74c69d'], ['blue', '#74b9ff'], ['pink', '#ff8fb8'], ['violet', '#b79cff'], ['gray', '#9aa0a6']]);
const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isHex = v => typeof v === 'string' && HEX.test(v);
export const parseHex = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
const shade = (hex, f) => toHex(parseHex(hex).map(v => v * f));
const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
export const luminance = rgb => .2126 * lin(rgb[0]) + .7152 * lin(rgb[1]) + .0722 * lin(rgb[2]);
export const contrast = (a, b) => { const x = Math.max(luminance(a), luminance(b)), y = Math.min(luminance(a), luminance(b)); return (x + .05) / (y + .05); };
export const composite = (fg, alpha, bg) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
/* "rgb(…)", "rgba(…)", "#rrggbb" -> [r,g,b,a] or null */
function parseColor(text) {
  const s = String(text || '').trim(), m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return [Number(m[1]), Number(m[2]), Number(m[3]), a]; }
  if (isHex(s)) return [...parseHex(s), 1];
  return null;
}

/* -- the saved value ---------------------------------------------------------------------------------------------------------------------- */
const int = (v, [lo, hi]) => Number.isInteger(v) && v >= lo && v <= hi;
/* Strict check (worker API, import): exact keys, exact types and ranges. */
export function validStyle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value); if (!keys.length || keys.some(k => !Object.hasOwn(STYLE_DEFAULTS, k))) return false;
  return (value.wordColor === undefined || value.wordColor === null || isHex(value.wordColor)) && (value.sectionColor === undefined || value.sectionColor === null || isHex(value.sectionColor)) &&
    (value.wordAlpha === undefined || value.wordAlpha === null || int(value.wordAlpha, STYLE_RANGES.wordAlpha)) && (value.tintAlpha === undefined || int(value.tintAlpha, STYLE_RANGES.tintAlpha)) && (value.cornerAlpha === undefined || int(value.cornerAlpha, STYLE_RANGES.cornerAlpha));
}
/* Tolerant read: anything wrong falls back to the default of that field (a damaged value must never break the marks). */
export function cleanStyle(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}, d = STYLE_DEFAULTS;
  return {wordColor: isHex(r.wordColor) ? r.wordColor.toLowerCase() : d.wordColor, wordAlpha: int(r.wordAlpha, STYLE_RANGES.wordAlpha) ? r.wordAlpha : d.wordAlpha,
    sectionColor: isHex(r.sectionColor) ? r.sectionColor.toLowerCase() : d.sectionColor, tintAlpha: int(r.tintAlpha, STYLE_RANGES.tintAlpha) ? r.tintAlpha : d.tintAlpha, cornerAlpha: int(r.cornerAlpha, STYLE_RANGES.cornerAlpha) ? r.cornerAlpha : d.cornerAlpha};
}
export const isDefaultStyle = style => { const s = cleanStyle(style); return Object.keys(STYLE_DEFAULTS).every(k => s[k] === STYLE_DEFAULTS[k]); };
export const styleKey = style => JSON.stringify(cleanStyle(style));

/* -- word mark ----------------------------------------------------------------------------------------------------------------------------- */
const num = a => String(Math.round(a * 1000) / 1000).replace(/^0\./, '.');
/* Colors of one level. level: subtle | normal | strong. ctx = {bg: [r,g,b] | null, text: [r,g,b] | null} measured page colors (only needed for custom styles).
   Returns {fill (css), fillHex, alpha, text (css color of the marked word or null = page text), frame, frameWidth, under}. */
export function wordPalette(level, styleIn, ctx = {}) {
  const st = cleanStyle(styleIn), custom = st.wordColor !== null, original = level === 'subtle' ? ORIGINAL.wash : level === 'strong' ? ORIGINAL.strong : ORIGINAL.normal;
  const base = st.wordColor || original, alpha = (st.wordAlpha ?? (level === 'subtle' ? 20 : 100)) / 100;
  const frame = custom ? shade(base, level === 'strong' ? .38 : .62) : level === 'strong' ? ORIGINAL.strongEdge : ORIGINAL.amber;
  const fill = alpha >= 1 ? base : `rgba(${parseHex(base).join(',')},${num(alpha)})`;
  const out = {fill, fillHex: base, alpha, frame, frameWidth: level === 'strong' ? 2 : 1, under: frame, text: null};
  if (level === 'subtle') return out;                                           // the page keeps its text color (stays readable by design: a faint wash)
  const plain = !custom && st.wordAlpha === null;                              // the 1.6.24 look: dark ink on the original yellow/amber
  if (plain) { out.text = ORIGINAL.ink; return out; }
  const bg = ctx.bg || [255, 255, 255], under = composite(parseHex(base), alpha, bg);
  out.text = contrast(parseHex(ORIGINAL.ink), under) >= contrast([255, 255, 255], under) ? ORIGINAL.ink : '#ffffff';
  return out;
}
/* ::highlight() rule of the word fill. */
export function wordHighlightCss(level, style, ctx) {
  if (level === 'off') return '';
  const p = wordPalette(level, style, ctx), fill = p.alpha >= 1 ? p.fillHex : `rgba(${parseHex(p.fillHex).join(',')},${num(p.alpha)})`;
  const d = isDefaultStyle(style);
  if (level === 'subtle') return `::highlight(notable-word){background-color:${d ? 'rgba(255,215,35,.2)' : fill};text-decoration:none}`;
  return `::highlight(notable-word){background-color:${fill};color:${p.text};text-decoration:none}`;
}
/* Worst-case reading contrast of the marked word. page = {bg, text} (measured) or null (settings of the popup: no page at hand -> checked against a light and a dark reference page, the worse one counts). */
export function wordContrast(level, style, page = null) {
  if (level === 'off') return {ratio: null, ok: true, approx: false};
  const refs = page?.bg ? [{bg: page.bg, text: page.text || [34, 34, 34]}] : [{bg: [255, 255, 255], text: [34, 38, 37]}, {bg: [24, 26, 27], text: [232, 230, 227]}];
  const ratios = refs.map(r => {
    const p = wordPalette(level, style, {bg: r.bg}), under = composite(parseHex(p.fillHex), p.alpha, r.bg), text = p.text ? parseHex(p.text) : r.text;
    return contrast(text, under);
  });
  const ratio = Math.min(...ratios);
  return {ratio, ok: ratio >= 4.5, approx: !page?.bg};
}

/* -- section mark ------------------------------------------------------------------------------------------------------------------------- */
export function sectionPalette(styleIn) {
  const st = cleanStyle(styleIn), base = st.sectionColor;
  if (base === null) return {tint: `rgba(255,215,35,${num(st.tintAlpha / 100)})`, tintHex: ORIGINAL.wash, corner: ORIGINAL.amber, cornerOpacity: st.cornerAlpha / 100, tintAlpha: st.tintAlpha / 100};
  return {tint: `rgba(${parseHex(base).join(',')},${num(st.tintAlpha / 100)})`, tintHex: base, corner: shade(base, .55), cornerOpacity: st.cornerAlpha / 100, tintAlpha: st.tintAlpha / 100};
}

/* -- the overlay CSS (frame, tint, corner marks); replaces the static string of page-highlight ------------------------------------------------ */
export function overlayCss(style, ctx) {
  const wf = lvl => wordPalette(lvl, style, ctx), n = wf('normal'), s = wf('strong'), u = wf('subtle'), sec = sectionPalette(style), d = isDefaultStyle(style);
  const fillBox = lvl => (lvl.alpha >= 1 ? lvl.fillHex : `rgba(${parseHex(lvl.fillHex).join(',')},${num(lvl.alpha)})`);
  return ':host{all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;contain:strict}.box{position:fixed;box-sizing:border-box;pointer-events:none}' +
    `.frame{border:1px solid ${n.frame};border-radius:3px}.frame.strong{border:2px solid ${s.frame};border-radius:4px}.under{border-bottom:2px solid ${u.under};border-radius:0 0 2px 2px}` +
    `.fill{background:${d ? 'rgba(255,215,35,.4)' : fillBox(n)};border:1px solid ${n.frame};border-radius:3px}.fill.strong{background:${fillBox(s)};border:2px solid ${s.frame}}` +
    `.pad{background:${fillBox(n)}}.pad.subtle{background:${d ? 'rgba(255,215,35,.2)' : fillBox(u)}}.pad.strong{background:${fillBox(s)}}` +
    `.block{background:${sec.tint};border-radius:3px}.corner{width:12px;height:12px;border:0 solid ${sec.corner};opacity:${num(sec.cornerOpacity)}}` +
    '.start{border-top-width:2px;border-left-width:2px;border-top-left-radius:3px}.end{border-bottom-width:2px;border-right-width:2px;border-bottom-right-radius:3px}.start.rtl{border-left-width:0;border-right-width:2px;border-top-left-radius:0;border-top-right-radius:3px}.end.rtl{border-right-width:0;border-left-width:2px;border-bottom-right-radius:0;border-bottom-left-radius:3px}';
}

/* Colors of the page under the marks: effective background (first non-transparent ancestor of body, white if none) and text color of body. */
export function measureContext(doc = document) {
  const win = doc.defaultView; if (!win) return {bg: null, text: null};
  const solid = c => { const p = parseColor(c); return p && p[3] > 0 ? p : null; };
  let bg = null;
  for (const el of [doc.body, doc.documentElement]) { if (!el) continue; const p = solid(win.getComputedStyle(el).backgroundColor); if (p) { bg = p; break; } }
  const base = bg ? composite(bg.slice(0, 3), bg[3], [255, 255, 255]) : [255, 255, 255];
  const text = parseColor(win.getComputedStyle(doc.body || doc.documentElement).color);
  return {bg: base, text: text ? text.slice(0, 3) : null};
}
