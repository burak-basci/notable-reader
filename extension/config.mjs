/* beNotable! Reader · the ONE central configuration (own code, MIT).
   Every setting the user makes lives in ONE object in ONE place: chrome.storage.local["pageSettings"] (version `configVersion`). The page bar, the popup, the file view / Focus Reader and the
   service worker all read and write that object (through the session or the worker); there is no second copy. This module is the schema: defaults, migration of older shapes without loss,
   validation (worker API and import), the theme coupling and the export / import format.
   NOT part of the configuration (kept in their own storage keys, never exported): saved reading places, local history, downloaded models, install state. */
import {validReading, cleanReading} from './playback/reading-rules.js';
import {marksFrom, MARK_VALUES} from './session/mark-settings.mjs';
import {STYLE_DEFAULTS, validStyle, cleanStyle} from './session/mark-style.mjs';
import {validAppearance, appearanceDefaults} from './appearance-schema.js';
import {validOverlayTheme, cleanOverlayTheme, emptyTheme} from './session/overlay-theme.mjs';
import {parseCombo, reservedReason, detectPlatform, defaultCombo} from './platform/keycombo.mjs';

export const CONFIG_KEY = 'pageSettings', LEGACY_SHORTCUTS_KEY = 'notableShortcuts', CONFIG_VERSION = 2, EXPORT_VERSION = 1, EXPORT_SCHEMA = 'benotable-reader-settings', MAX_IMPORT_BYTES = 65536;
/* The actions of the keyboard layer with their default physical key (Alt+Shift+<code>); must equal KEYMAP in player-surface.mjs (tests/config-central.test.mjs). */
export const KEY_DEFAULTS = Object.freeze({playPause: 'KeyK', previousSection: 'ArrowLeft', nextSection: 'ArrowRight', previousBlock: 'PageUp', nextBlock: 'PageDown', previousChapter: 'Home', nextChapter: 'End', seekBack: 'KeyJ', seekForward: 'KeyL',
  volumeUp: 'ArrowUp', volumeDown: 'ArrowDown', mute: 'KeyM', speedDown: 'Comma', speedUp: 'Period', voiceMenu: 'KeyN', voicePrev: 'Digit1', voiceNext: 'Digit2', languagePrev: 'Digit3', languageNext: 'Digit4',
  theme: 'KeyD', focus: 'KeyF', follow: 'KeyW', clickSeek: 'KeyC', settings: 'KeyE', uiLanguage: 'KeyU', export: 'KeyX', openFile: 'KeyO', help: 'KeyH', close: 'KeyQ'});
/* Reading line (where the text being read stays on screen) 33 % from the top, scroll-free range 10 % of the reading area. Stored values are never touched, only the default changes. */
export const DEFAULT_ENGLISH_VOICE = 'notable:kokoro:af_bella';
export const FOLLOW_POSITION_DEFAULT = 33, FOLLOW_MARGIN_DEFAULT = 10;
/* Reading speed 0.5x-4x in steps of 0.05 (owner, 20.11.2026: up to 5x was too much). Older versions allowed up to 5x: such a stored or imported value becomes 4x. */
export const SPEED_MIN = .5, SPEED_MAX = 4, SPEED_LEGACY_MAX = 5;
export const clampSpeed = v => Number.isFinite(v) && v > SPEED_MAX && v <= SPEED_LEGACY_MAX ? SPEED_MAX : v;
/* Reader document generation identifiers. */
export const GENERATION_ID = /^[a-f0-9-]{16,64}$/i;
export const UI_LANGUAGES = Object.freeze(['de', 'en', 'fr', 'es', 'it', 'pt']);

/* -- keyboard value {enabled, keys: {actionId: "Alt+Shift+KeyK"}} -------------------------------------------------------------------------- */
/* keys holds ONLY the deviations from the default. Returns null = fine, otherwise {code, id?, combo?, detail?}. */
export function keyboardProblem(value, platform = detectPlatform()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {code: 'type'};
  const keys = Object.keys(value); if (keys.some(k => !['enabled', 'keys'].includes(k))) return {code: 'unknownKey', detail: keys.find(k => !['enabled', 'keys'].includes(k))};
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return {code: 'type', detail: 'enabled'};
  if (value.keys === undefined) return null;
  if (!value.keys || typeof value.keys !== 'object' || Array.isArray(value.keys)) return {code: 'type', detail: 'keys'};
  const effective = new Map(Object.entries(KEY_DEFAULTS).map(([id, code]) => [id, defaultCombo(code)]));
  for (const [id, combo] of Object.entries(value.keys)) {
    if (!Object.hasOwn(KEY_DEFAULTS, id)) return {code: 'unknownKey', detail: id};
    if (typeof combo !== 'string' || !parseCombo(combo)) return {code: 'combo', id, combo: String(combo).slice(0, 40)};
    const why = reservedReason(combo, platform); if (why) return {code: 'reserved', id, combo, detail: why};
    effective.set(id, combo);
  }
  const seen = new Map();
  for (const [id, combo] of effective) { if (seen.has(combo)) return {code: 'duplicate', id, combo, detail: seen.get(combo)}; seen.set(combo, id); }
  return null;
}
const validKeyboard = (value, platform) => keyboardProblem(value, platform) === null;
export function cleanKeyboard(raw, platform = detectPlatform()) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}, keys = {};
  if (r.keys && typeof r.keys === 'object' && !Array.isArray(r.keys)) for (const [id, combo] of Object.entries(r.keys)) if (Object.hasOwn(KEY_DEFAULTS, id) && typeof combo === 'string' && parseCombo(combo) && !reservedReason(combo, platform) && combo !== defaultCombo(KEY_DEFAULTS[id])) keys[id] = combo;
  const next = {enabled: r.enabled !== false, keys};
  return keyboardProblem(next, platform) ? {enabled: next.enabled, keys: {}} : next;       // a damaged set of key assignments (duplicates) is dropped as a whole, the defaults apply
}
export const keyboardOff = settings => settings?.keyboard?.enabled === false;

/* -- the fields -------------------------------------------------------------------------------------------------------------------------------- */
const bool = v => typeof v === 'boolean', int = (lo, hi) => v => Number.isInteger(v) && v >= lo && v <= hi, oneOf = list => v => list.includes(v);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
/* check(value, ctx): ctx = {uiLanguages, formatLocales, platform}. exported: part of the exported file. */
export const FIELDS = Object.freeze({
  speed: {exported: true, check: v => Number.isFinite(v) && v >= .5 && v <= SPEED_MAX && Math.abs(v * 20 - Math.round(v * 20)) < 1e-6},
  volume: {exported: true, check: int(0, 150)}, muted: {exported: true, check: bool}, follow: {exported: true, check: bool}, clickSeek: {exported: true, check: bool}, autoShow: {exported: true, check: bool}, focusMotion: {exported: true, check: bool},
  overlayMode: {exported: true, check: oneOf(['light', 'expert'])},
  reading: {exported: true, check: validReading},
  online: {exported: true, check: bool}, normalizeSpeech: {exported: true, check: bool},
  /* "Rechenweg" of the local voices: auto = the graphics card (WebGPU) for the voices measured faster there when the device has one, else the processor;
     gpu = the graphics card wherever it works (also after a failed attempt); cpu = always the processor (WASM). The engine falls back to WASM by itself. */
  computePath: {exported: true, check: oneOf(['auto', 'gpu', 'cpu'])},
  /* voice shaping: pitch in semitones (steps of 0.5), bass / treble in dB, pause between sections in ms (steps of 100) */
  pitch: {exported: true, check: v => Number.isFinite(v) && v >= -6 && v <= 6 && Math.abs(v * 2 - Math.round(v * 2)) < 1e-6}, bass: {exported: true, check: int(-10, 10)}, treble: {exported: true, check: int(-10, 10)},
  sectionPause: {exported: true, check: v => Number.isInteger(v) && v >= 0 && v <= 3000 && v % 100 === 0},
  language: {exported: true, check: v => v === 'auto' || typeof v === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(v)},
  voices: {exported: true, check: v => isObj(v) && Object.keys(v).length <= 64 && Object.entries(v).every(([k, id]) => /^[a-z]{2,3}(?:-[A-Za-z]{2})?$/.test(k) && typeof id === 'string' && /^[a-z0-9_:.-]{1,64}$/.test(id))},
  uiLanguage: {exported: true, check: (v, c) => (c?.uiLanguages || UI_LANGUAGES).includes(v)},
  formatLocale: {exported: true, check: (v, c) => v === 'auto' || (c?.formatLocales ? c.formatLocales.includes(v) : typeof v === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(v))},
  timeFormat: {exported: true, check: oneOf(['auto', '12h', '24h'])},
  appearance: {exported: true, check: v => validAppearance(v)},
  bar: {exported: true, check: v => v === null || isObj(v) && Object.keys(v).sort().join() === 'x,y' && [v.x, v.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)},
  followPosition: {exported: true, check: v => Number.isFinite(v) && v >= 10 && v <= 90}, followMode: {exported: true, check: oneOf(['paragraph', 'section', 'line'])}, followMargin: {exported: true, check: int(5, 30)},
  markWord: {exported: true, check: oneOf(MARK_VALUES)}, markTint: {exported: true, check: bool}, markCorners: {exported: true, check: bool}, markStyle: {exported: true, check: v => validStyle(v)}, overlayTheme: {exported: true, check: v => validOverlayTheme(v)},
  keyboard: {exported: true, check: (v, c) => validKeyboard(v, c?.platform)},
  /* Summarize (guided explanation, extension/explain/tutor.mjs options): scope auto = the selection, else the whole page; language page (default: a German page is summarized in German, whatever the interface) = the language of the text, ui = the interface language, or one of the six */
  explainScope: {exported: true, check: oneOf(['auto', 'page', 'here'])}, explainDepth: {exported: true, check: oneOf(['short', 'long'])}, explainLanguage: {exported: true, check: oneOf(['ui', 'page', 'de', 'en', 'fr', 'es', 'it', 'pt'])}, explainKeepMarks: {exported: true, check: bool},
  /* the color mode of the bar and the extension's pages, independent of the page's Night mode (round 4): a setting of its own, in the backup too */
  playerTheme: {exported: true, check: oneOf(['system', 'light', 'dark'])},
  /* derived or internal: stored, never exported */
  configVersion: {exported: false, check: int(1, 1000)}, markVersion: {exported: false, check: int(1, 1000)}, followPositionLegacy: {exported: false, check: int(10, 90)}, markLegacy: {exported: false, check: isObj},
});
export const EXPORT_KEYS = Object.freeze(Object.keys(FIELDS).filter(k => FIELDS[k].exported));
/* Settings that travel as ONE batch to a running player session (popup -> file view): the file-view transport and the file view itself both accept exactly these keys (one list, so a reset/import can never be half-accepted). */
export const SESSION_PATCH_KEYS = Object.freeze(['overlayMode', 'reading', 'markWord', 'markTint', 'markCorners', 'markStyle', 'overlayTheme', 'keyboard', 'normalizeSpeech', 'computePath', 'followPosition', 'followMode', 'followMargin', 'voices', 'bar', 'online', 'autoShow', 'focusMotion', 'pitch', 'bass', 'treble', 'sectionPause', 'explainScope', 'explainDepth', 'explainLanguage', 'explainKeepMarks']);

/* Keys a settings patch from the extension's own pages may carry: every exported setting, the coupled player theme,
   one voice choice and the legacy section mark. Internal bookkeeping (versions, legacy copies) is never accepted. */
export const PATCH_KEYS = Object.freeze([...EXPORT_KEYS, 'playerTheme', 'voice', 'markSection']);
const voiceLanguage = v => typeof v === 'string' && /^[a-z]{2}(?:-[A-Za-z]{2})?$/.test(v);
const validVoiceChoice = (voice, language) => typeof voice === 'string'
  ? /^[A-Za-z0-9_.:-]{1,120}$/.test(voice) && voiceLanguage(language)
  : isObj(voice) && Object.keys(voice).sort().join() === 'id,language' && voiceLanguage(voice.language)
    && typeof voice.id === 'string' && /^[a-z0-9_:.-]{1,64}$/.test(voice.id);
/* The single validator of settings patches (worker API); ctx = {uiLanguages, formatLocales, platform}. */
export function validSettingsPatch(value, ctx = {}) {
  if (!isObj(value)) return false;
  const keys = Object.keys(value);
  if (!keys.length || keys.some(key => !PATCH_KEYS.includes(key))) return false;
  const valid = key => key === 'voice' ? validVoiceChoice(value.voice, value.language)
    : key === 'markSection' ? ['off', 'subtle', 'strong'].includes(value.markSection)
    : FIELDS[key].check(value[key], ctx);
  return keys.every(key => value[key] === undefined || valid(key));
}

export function defaults() {
  return {overlayMode: 'expert', speed: 1, volume: 100, muted: false, follow: true, clickSeek: true, autoShow: false, focusMotion: false, language: 'auto', voices: {'en-US': DEFAULT_ENGLISH_VOICE}, uiLanguage: '', playerTheme: 'system', formatLocale: 'auto', timeFormat: 'auto', appearance: null, bar: null,
    followPosition: FOLLOW_POSITION_DEFAULT, followMode: 'paragraph', followMargin: FOLLOW_MARGIN_DEFAULT, markWord: 'normal', markTint: true, markCorners: true, markVersion: 2, normalizeSpeech: true, computePath: 'auto',
    pitch: 0, bass: 0, treble: 0, sectionPause: 0, reading: cleanReading(), explainScope: 'auto', explainDepth: 'short', explainLanguage: 'page', explainKeepMarks: false,
    markStyle: {...STYLE_DEFAULTS}, overlayTheme: emptyTheme(), keyboard: {enabled: true, keys: {}}, online: false, configVersion: CONFIG_VERSION};
}

/* -- theme: ONE state --------------------------------------------------------------------------------------------------------------------------- */
/* Round 4 (owner request): the color mode of the reader bar (playerTheme: system / light / dark) colors the bar, the overlay and the extension's
   own pages (popup, settings, library, help, file view); darkening the web page is the separate Night mode (appearance.mode, More menu). The two
   are independent again: this only keeps playerTheme valid and never touches the page mode (the name stays for its callers). */
export function coupleTheme(s, touched = []) {
  if (!['system', 'light', 'dark'].includes(s.playerTheme)) s.playerTheme = 'system';
  return s;
}

/* -- migration: any older shape -> the current one, nothing is thrown away ---------------------------------------------------------------------- */
/* stored: the pageSettings object as found (may be empty / unversioned); legacy: {notableShortcuts}. Returns a NEW object. */
export function migrate(stored, legacy = {}, platform = detectPlatform()) {
  const s = isObj(stored) ? {...stored} : {};
  // Only an absent configuration is a fresh install; never replace existing voice preferences, including an intentionally empty map.
  if (!isObj(stored)) s.voices = {'en-US': DEFAULT_ENGLISH_VOICE};
  else if (!Object.hasOwn(s, 'voices')) s.voices = {};
  const m = marksFrom(s);                                                        // 1.x shapes: markWord off|subtle|strong + markSection
  if (s.markVersion !== 2) { const old = {}; if (s.markWord !== undefined) old.word = s.markWord; if (s.markSection !== undefined) old.section = s.markSection; Object.assign(s, m, {markVersion: 2}); delete s.markSection; if (Object.keys(old).length && !s.markLegacy) s.markLegacy = old; }
  else Object.assign(s, m);
  /* version 1 stored the whole default object, so 50 % there is the old default and not a choice: it becomes the new default 33 % (the old value stays in followPositionLegacy). Any other value is the user's and stays. */
  if ((Number(s.configVersion) || 0) < 2 && s.followPosition === 50) { s.followPositionLegacy = 50; s.followPosition = FOLLOW_POSITION_DEFAULT; }
  if (Object.hasOwn(s, 'speed')) s.speed = clampSpeed(s.speed); // 2.5.0 and older: up to 5x
  s.online = false; // Local-only product: legacy network system voices are never enabled.
  s.reading = cleanReading(s.reading);
  s.markStyle = cleanStyle(s.markStyle); s.overlayTheme = cleanOverlayTheme(s.overlayTheme);
  const kb = isObj(s.keyboard) ? s.keyboard : {}, off = legacy[LEGACY_SHORTCUTS_KEY] === false;
  s.keyboard = cleanKeyboard({enabled: off ? false : kb.enabled, keys: kb.keys}, platform);
  /* the bar's color mode and the page's Night mode are separate settings (round 4): both are kept as stored */
  coupleTheme(s, []);
  s.configVersion = CONFIG_VERSION;
  return s;
}
/* The stored object is migrated on every read; if migration changed it, it is written back once and the old shortcuts key is removed. */
export async function loadConfig(storage) {
  const got = await storage.get([CONFIG_KEY, LEGACY_SHORTCUTS_KEY]).catch(() => ({})), stored = got?.[CONFIG_KEY];
  const migrated = migrate(stored, got || {});
  if (stored && (JSON.stringify(stored) !== JSON.stringify({...stored, ...migrated}) || Object.hasOwn(got, LEGACY_SHORTCUTS_KEY))) {
    try { await storage.set({[CONFIG_KEY]: migrated}); await storage.remove?.(LEGACY_SHORTCUTS_KEY); } catch {}
  } else if (Object.hasOwn(got || {}, LEGACY_SHORTCUTS_KEY) && !stored) { try { await storage.set({[CONFIG_KEY]: migrated}); await storage.remove?.(LEGACY_SHORTCUTS_KEY); } catch {} }
  return migrated;
}

/* -- export / import ----------------------------------------------------------------------------------------------------------------------------- */
const FORBIDDEN = /premium|licen[sc]e|lease|device|activation|token|secret|password|mail|resume|position|history|model|engagement|install/i;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
export function exportDocument(settings, {appVersion = '', now = new Date()} = {}) {
  const out = {};
  for (const key of EXPORT_KEYS) if (settings[key] !== undefined && !(settings[key] === null && key !== 'bar') && !(key === 'uiLanguage' && !settings[key])) out[key] = JSON.parse(JSON.stringify(settings[key]));
  if (out.keyboard) out.keyboard = cleanKeyboard(out.keyboard);
  return {schema: EXPORT_SCHEMA, version: EXPORT_VERSION, app: {name: 'beNotable! Reader', version: String(appVersion)}, exportedAt: now.toISOString(), settings: out};
}
export const exportFileName = (now = new Date()) => `benotable-reader-einstellungen-${now.toISOString().slice(0, 10)}.json`;

function unsafeDeep(value, depth = 0) {
  if (depth > 6) return true;
  if (Array.isArray(value)) return value.length > 256 || value.some(v => unsafeDeep(v, depth + 1));
  if (isObj(value)) { const keys = Object.keys(value); return keys.length > 256 || keys.some(k => UNSAFE.has(k) || unsafeDeep(value[k], depth + 1)); }
  return typeof value === 'string' && value.length > 2048;
}
/* Strict parse of an exported file. Nothing is applied here. Result {ok:true, values, count, changed, app} or {ok:false, code, detail}.
   codes: tooLarge notJson notObject schema version newer unsafe unknownKey forbidden empty badValue(detail = key) keyboard(detail = problem) */
export function parseImport(text, {current = {}, ctx = {}} = {}) {
  if (typeof text !== 'string') return {ok: false, code: 'notJson'};
  if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return {ok: false, code: 'tooLarge'};
  let doc; try { doc = JSON.parse(text.replace(/^﻿/, '')); } catch { return {ok: false, code: 'notJson'}; }
  if (!isObj(doc)) return {ok: false, code: 'notObject'};
  if (unsafeDeep(doc)) return {ok: false, code: 'unsafe'};
  if (doc.schema !== EXPORT_SCHEMA) return {ok: false, code: 'schema'};
  if (!Number.isInteger(doc.version) || doc.version < 1) return {ok: false, code: 'version'};
  if (doc.version > EXPORT_VERSION) return {ok: false, code: 'newer', detail: String(doc.version)};
  const top = Object.keys(doc).find(k => !['schema', 'version', 'app', 'exportedAt', 'settings'].includes(k)); if (top) return {ok: false, code: FORBIDDEN.test(top) ? 'forbidden' : 'unknownKey', detail: top.slice(0, 40)};
  if (!isObj(doc.settings)) return {ok: false, code: 'notObject'};
  const keys = Object.keys(doc.settings); if (!keys.length) return {ok: false, code: 'empty'};
  const platform = ctx.platform || detectPlatform(), values = {};
  for (const key of keys) {
    if (!Object.hasOwn(FIELDS, key) || !FIELDS[key].exported) return {ok: false, code: FORBIDDEN.test(key) ? 'forbidden' : 'unknownKey', detail: key.slice(0, 40)};
    const v = key === 'speed' ? clampSpeed(doc.settings[key]) : doc.settings[key];
    if (key === 'keyboard') { const problem = keyboardProblem(v, platform); if (problem) return {ok: false, code: 'keyboard', detail: problem}; }
    else if (!FIELDS[key].check(v, {...ctx, platform})) return {ok: false, code: 'badValue', detail: key};
    values[key] = key === 'markStyle' ? cleanStyle(v) : key === 'overlayTheme' ? cleanOverlayTheme(v) : key === 'keyboard' ? cleanKeyboard(v, platform) : v;
  }
  const changed = keys.filter(k => JSON.stringify(values[k]) !== JSON.stringify(current[k] ?? defaults()[k])).length;
  return {ok: true, values, count: keys.length, changed, app: isObj(doc.app) ? {name: String(doc.app.name || '').slice(0, 60), version: String(doc.app.version || '').slice(0, 20)} : null};
}

/* "Reset all settings": every exportable setting back to its default. The user interface language stays (resetting it would also reset what the user is reading right now), saved reading places, voice models and
   local history are not settings and are not touched. The same patch is applied by the bar, the file view and the popup. */
export function resetPatch() {
  const d = defaults(), out = {};
  for (const key of EXPORT_KEYS) if (key !== 'uiLanguage' && key !== 'online') out[key] = JSON.parse(JSON.stringify(d[key] ?? null));
  out.appearance = {...appearanceDefaults};
  return out;
}
