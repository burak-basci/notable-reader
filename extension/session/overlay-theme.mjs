/* beNotable! Reader · colors of the overlay (bar, panels, popup player, Focus Reader) for the light and the dark theme, set separately (own code, MIT).
   Setting `overlayTheme` = {light: {bg, text, accent}, dark: {bg, text, accent}}; each color is "#rrggbb" or null (= the product default of that theme). ONE module for config.mjs (validation, export / import),
   the page session, the popup and the settings block: derive() turns the three colors into the full variable set of the surface (paper, ink, muted, line, soft, accent, on-accent). */
export const OVERLAY_DEFAULTS = Object.freeze({
  light: Object.freeze({bg: '#ffffff', text: '#000000', accent: '#256249'}),
  dark: Object.freeze({bg: '#1c1f1d', text: '#e8eee8', accent: '#a5d3b3'}),
});
export const OVERLAY_FIELDS = Object.freeze(['bg', 'text', 'accent']);
/* Presets: every one reaches WCAG AA (text on background 4.5:1, accent on background 3:1); checked in tests/overlay-theme.test.mjs. */
export const OVERLAY_PRESETS = Object.freeze({
  light: Object.freeze([['default', null], ['paper', {bg: '#fbf6ea', text: '#2b2418', accent: '#8a4b12'}], ['sage', {bg: '#eef3ee', text: '#1f2a22', accent: '#2f6b4f'}], ['blue', {bg: '#f3f6fb', text: '#1c2433', accent: '#1f55a8'}], ['contrast', {bg: '#ffffff', text: '#000000', accent: '#0b3d91'}]]),
  dark: Object.freeze([['default', null], ['night', {bg: '#14161a', text: '#e6e8ee', accent: '#8ab4ff'}], ['graphite', {bg: '#26272b', text: '#ececec', accent: '#f2b36b'}], ['forest', {bg: '#1a241d', text: '#e4efe6', accent: '#7fd1a0'}], ['contrast', {bg: '#000000', text: '#ffffff', accent: '#ffd54a'}]]),
});
/* Presets of the READING MODE color schemes (page background, page text, links), same names as the overlay presets; "default" = the product default of appearance.mjs. */
export const APPEARANCE_FIELDS = Object.freeze({dark: Object.freeze(['background', 'text', 'link']), light: Object.freeze(['lightBackground', 'lightText', 'lightLink'])});
export const APPEARANCE_PRESETS = Object.freeze({
  dark: Object.freeze([['default', {background: '#181a1b', text: '#e8e6e3', link: '#8ab4f8'}], ['night', {background: '#0f1115', text: '#d9dde4', link: '#8ab4f8'}], ['graphite', {background: '#26272b', text: '#ececec', link: '#f2b36b'}], ['forest', {background: '#1a241d', text: '#e4efe6', link: '#7fd1a0'}], ['contrast', {background: '#000000', text: '#ffffff', link: '#ffd54a'}]]),
  light: Object.freeze([['default', {lightBackground: '#ffffff', lightText: '#202124', lightLink: '#0969da'}], ['paper', {lightBackground: '#fbf6ea', lightText: '#2b2418', lightLink: '#8a4b12'}], ['sage', {lightBackground: '#eef3ee', lightText: '#1f2a22', lightLink: '#2f6b4f'}], ['blue', {lightBackground: '#f3f6fb', lightText: '#1c2433', lightLink: '#1f55a8'}], ['contrast', {lightBackground: '#ffffff', lightText: '#000000', lightLink: '#0b3d91'}]]),
});
const HEX = /^#[0-9a-f]{6}$/;
export const emptyTheme = () => ({light: {bg: null, text: null, accent: null}, dark: {bg: null, text: null, accent: null}});
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const validSide = v => isObj(v) && Object.keys(v).length === 3 && OVERLAY_FIELDS.every(k => v[k] === null || typeof v[k] === 'string' && HEX.test(v[k]));
export const validOverlayTheme = v => isObj(v) && Object.keys(v).sort().join() === 'dark,light' && validSide(v.light) && validSide(v.dark);
export function cleanOverlayTheme(raw) {
  const out = emptyTheme(); if (!isObj(raw)) return out;
  for (const side of ['light', 'dark']) if (isObj(raw[side])) for (const k of OVERLAY_FIELDS) { const c = typeof raw[side][k] === 'string' ? raw[side][k].toLowerCase() : null; out[side][k] = c && HEX.test(c) ? c : null; }
  return out;
}
/* -- color arithmetic ------------------------------------------------------------------------------------------------------------------------------ */
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hex = a => '#' + a.map(n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('');
const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const lum = h => { const [r, g, b] = rgb(h); return .2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v * t + y[i] * (1 - t))); };
/* resolved colors of one side (null -> default) */
export const resolve = (theme, side) => { const c = cleanOverlayTheme(theme)[side], d = OVERLAY_DEFAULTS[side]; return {bg: c.bg || d.bg, text: c.text || d.text, accent: c.accent || d.accent}; };
/* Variable set for the surface. null = the side has no custom color at all (the surface keeps its own default palette byte for byte). */
export function derive(theme, side) {
  const c = cleanOverlayTheme(theme)[side]; if (OVERLAY_FIELDS.every(k => c[k] === null)) return null;
  const {bg, text, accent} = resolve(theme, side);
  let muted = text; for (const t of [.62, .7, .78, .86]) { const m = mix(text, bg, t); if (contrast(m, bg) >= 4.5) { muted = m; break; } }
  return {paper: bg, ink: text, muted, line: mix(text, bg, .16), soft: mix(text, bg, .06), accent, 'on-accent': contrast('#ffffff', accent) >= contrast('#111111', accent) ? '#ffffff' : '#111111'};
}
export const deriveBoth = theme => ({light: derive(theme, 'light'), dark: derive(theme, 'dark')});
/* The SAME colors for the extension's own pages (toolbar popup, options page, their dropdown menus): CSS custom properties of popup.css for the scheme that is in effect, or null (= the stylesheet keeps its own palette). One mapping, no copy in popup.js. */
const DOCUMENT_VARS = Object.freeze({paper: '--paper', ink: '--ink', muted: '--muted', line: '--line', soft: '--soft', accent: '--accent', 'on-accent': '--on'});
export function documentVars(theme, side) {
  const v = derive(theme, side); if (!v) return null;
  const out = {'--bg': mix(v.ink, v.paper, .05)};
  for (const [k, name] of Object.entries(DOCUMENT_VARS)) out[name] = v[k];
  return out;
}
const applied = new WeakMap();
/* Paints (or clears) the overlay colors on a document root for the scheme in effect; remembers which properties it set. Used by the popup, the options page and the file view / Focus Reader. */
export function applyDocumentColors(root, theme, dark) {
  for (const name of applied.get(root) || []) root.style.removeProperty(name);
  const vars = documentVars(theme, dark ? 'dark' : 'light'); applied.set(root, vars ? Object.keys(vars) : []);
  for (const [name, value] of Object.entries(vars || {})) root.style.setProperty(name, value);
}
/* contrast problems of one side: [] = fine. text on background below 4.5:1, accent on background below 3:1 */
export function problems(theme, side) {
  const {bg, text, accent} = resolve(theme, side), out = [];
  if (contrast(text, bg) < 4.5) out.push({field: 'text', ratio: contrast(text, bg)});
  if (contrast(accent, bg) < 3) out.push({field: 'accent', ratio: contrast(accent, bg)});
  return out;
}
export const presetValue = (side, id) => OVERLAY_PRESETS[side].find(p => p[0] === id)?.[1] || null;
export const matchPreset = (theme, side) => { const c = cleanOverlayTheme(theme)[side]; const hit = OVERLAY_PRESETS[side].find(([, v]) => v ? OVERLAY_FIELDS.every(k => c[k] === v[k]) : OVERLAY_FIELDS.every(k => c[k] === null)); return hit ? hit[0] : 'custom'; };
