/* beNotable! Reader · key combinations (own code, MIT). Pure functions, no DOM: the settings editor, the central configuration (validation of imports) and the tests share them.
   A combination is a string "Mod+Alt+Shift+<KeyboardEvent.code>", modifiers in this fixed order, only the ones that are held:
     Mod   = Cmd on macOS, Ctrl everywhere else (one name, so a saved configuration is portable between a Mac and a PC)
     Alt   = Alt / Option,  Shift = Shift
   The key is the PHYSICAL key (event.code), not the character: it is the same on QWERTZ, QWERTY and AZERTY and does not change with Option/AltGr characters.
   The default of every action is "Alt+Shift+<code>" (1.6.24 / TASTATUR-KONZEPT). */
export const MODS = ['Mod', 'Alt', 'Shift'];
/* Keys that are not text and may stand alone (no modifier needed): the F13-F24 keys of extended keyboards and the media keys. Browsers and systems may still keep the media keys for themselves. */
const SOLO = /^(F1[3-9]|F2[0-4]|MediaPlayPause|MediaTrackNext|MediaTrackPrevious|MediaStop)$/;
/* Keys that can be bound (with a modifier): letters, digits, arrows, paging keys, punctuation of the main block, function keys. Never Space/Enter/Tab/Escape/Backspace/Delete (they belong to the page and to focus handling). */
const BINDABLE = /^(Key[A-Z]|Digit\d|Arrow(Left|Right|Up|Down)|Page(Up|Down)|Home|End|Comma|Period|Slash|Semicolon|Quote|Minus|Equal|BracketLeft|BracketRight|Backslash|Backquote|F([1-9]|1[0-2]))$/;
export const isModifierCode = code => /^(Shift|Control|Alt|Meta|OS|AltGraph)(Left|Right)?$/.test(String(code));

export function parseCombo(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const parts = value.split('+'), code = parts.pop(), mods = parts;
  if (!code || mods.some(m => !MODS.includes(m)) || new Set(mods).size !== mods.length) return null;
  const sorted = MODS.filter(m => mods.includes(m));
  if (sorted.join('+') !== mods.join('+')) return null;     // only the canonical order is stored, so equal combinations compare equal as strings
  return {mods: sorted, code};
}
export const buildCombo = (mods, code) => [...MODS.filter(m => mods.includes(m)), code].join('+');
export const defaultCombo = code => 'Alt+Shift+' + code;

export function detectPlatform(nav = globalThis.navigator) {
  const text = String(nav?.userAgentData?.platform || nav?.platform || '');
  return /mac|iphone|ipad/i.test(text) ? 'mac' : /win/i.test(text) ? 'win' : 'linux';
}

/* Combinations the browser or the operating system keep for themselves (they never reach the page, or doing so would break the browser). Checked on the canonical string.
   `Mod` combinations without Alt are, in practice, all taken (Ctrl/Cmd+letter, +digit, +arrow, +punctuation), so they are refused as a group instead of listing hundreds. */
const ALT_RESERVED = {
  all: ['Alt+F4', 'Alt+Tab', 'Alt+Shift+Tab', 'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+Home', 'Alt+KeyD', 'Alt+KeyF', 'Alt+KeyE', 'Alt+Digit1', 'Alt+Digit2', 'Alt+Digit3', 'Alt+Digit4', 'Alt+Digit5', 'Alt+Digit6', 'Alt+Digit7', 'Alt+Digit8', 'Alt+Digit9'],
  mac: ['Mod+Alt+Escape', 'Mod+Alt+KeyD', 'Mod+Alt+KeyH', 'Mod+Alt+KeyM'],
};
export function reservedReason(combo, platform = detectPlatform()) {
  const p = parseCombo(combo); if (!p) return 'invalid';
  const mod = p.mods.includes('Mod'), alt = p.mods.includes('Alt'), shift = p.mods.includes('Shift');
  if (!p.mods.length) return SOLO.test(p.code) ? null : 'noModifier';
  if (!mod && !alt) return 'shiftOnly';                                         // Shift+key types a capital: never a shortcut
  if (!BINDABLE.test(p.code)) return 'key';
  if (mod && alt && platform !== 'mac') return 'altgr';                          // Ctrl+Alt is AltGr on Windows keyboards (types @ € \ on a German layout), Linux layouts use it for the same
  if (mod && !alt) return 'browser';                                           // Ctrl/Cmd(+Shift)+key: browser and system
  if (!mod && alt && ALT_RESERVED.all.includes(combo)) return 'browser';
  if (platform === 'win' && alt && !mod && !shift && /^Key[A-Z]$/.test(p.code)) return 'menu';  // Alt+letter opens browser menus on Windows
  if (platform === 'mac' && ALT_RESERVED.mac.includes(combo)) return 'system';
  if (shift && alt && !mod && p.code === 'Tab') return 'browser';
  return null;
}
/* null = usable. Otherwise a short reason code that the settings editor turns into a sentence in the user's language. */
export const validateCombo = (combo, platform) => reservedReason(combo, platform);

/* Shown text: macOS with symbols, elsewhere with "+"; `keyName(code)` supplies the character of the physical key for the user's layout (navigator.keyboard.getLayoutMap) when known. */
const NAMES = {ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', PageUp: 'PgUp', PageDown: 'PgDn', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`'};
export function displayCode(code) { return NAMES[code] || /^Key([A-Z])$/.exec(code)?.[1] || /^Digit(\d)$/.exec(code)?.[1] || code; }
export function formatCombo(combo, {platform = detectPlatform(), keyName = displayCode} = {}) {
  const p = parseCombo(combo); if (!p) return '';
  const key = keyName(p.code);
  if (platform === 'mac') return p.mods.map(m => ({Mod: '⌘', Alt: '⌥', Shift: '⇧'}[m])).join('') + key;
  return [...p.mods.map(m => ({Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift'}[m])), key].join('+');
}
/* WAI-ARIA aria-keyshortcuts names (Meta on a Mac, Control elsewhere). */
export function ariaCombo(combo, {platform = detectPlatform()} = {}) {
  const p = parseCombo(combo); if (!p) return '';
  return [...p.mods.map(m => ({Mod: platform === 'mac' ? 'Meta' : 'Control', Alt: 'Alt', Shift: 'Shift'}[m])), displayCode(p.code)].join('+');
}
/* First other action that already has `combo`. `table` = [[id, combo], ...] with every action's CURRENT combination. */
export const conflictWith = (combo, id, table) => (table.find(([other, c]) => other !== id && c === combo) || [])[0] || null;
