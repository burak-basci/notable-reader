// Tastenkuerzel: Anzeige je Betriebssystem und Kollisionswarnung. Die Belegung selbst steht im Manifest (commands),
// weil nur dort Chrome und Firefox sie ueber ihre Kuerzel-Einstellungen aendern lassen. Hier nur Darstellung/Pruefung.
import {detectOS} from './env.mjs';

/** Muss mit extension/manifest.json commands uebereinstimmen (Test). */
export const COMMANDS = Object.freeze({_execute_action: Object.freeze({default: 'Alt+Shift+V'}), 'toggle-play': Object.freeze({default: 'Alt+Shift+K'}), 'previous-section': Object.freeze({default: 'Alt+Shift+Left'}), 'next-section': Object.freeze({default: 'Alt+Shift+Right'})});

const MAC = {ctrl: '\u2303', macctrl: '\u2303', alt: '\u2325', shift: '\u21e7', command: '\u2318'};
const NAMES = {ctrl: 'Ctrl', macctrl: 'Control', alt: 'Alt', shift: 'Shift', command: 'Command'};

export function parseCombo(combo) {
  const parts = String(combo).split('+').map(s => s.trim()).filter(Boolean);
  const key = parts.pop() || '';
  return {mods: parts.map(s => s.toLowerCase()), key};
}

/** Anzeigetext: macOS mit Symbolen (alt+shift+V -> ⌥⇧V), sonst mit Plus-Zeichen. */
export function shortcutLabel(combo, os = detectOS()) {
  const {mods, key} = parseCombo(combo);
  if (os === 'mac') return `${mods.map(m => MAC[m] || m).join('')}${key.toUpperCase()}`;
  return [...mods.map(m => NAMES[m] || m), key.length === 1 ? key.toUpperCase() : key].join('+');
}

const COLLISIONS = {
  windows: [['alt', 'space'], ['alt', 'shift', 'tab'], ['ctrl', 'shift', 'esc'], ['alt', 'f4']],
  mac: [['alt', 'space'], ['command', 'space'], ['macctrl', 'space'], ['command', 'q'], ['command', 'h']],
  linux: [['alt', 'space'], ['alt', 'f4'], ['ctrl', 'alt', 't']]
};

/** true, wenn das System die Kombination ueblicherweise selbst belegt (Alt+Leertaste: Fenstermenue/Spotlight). */
export function collidesWithSystem(combo, os = detectOS()) {
  const {mods, key} = parseCombo(combo);
  const have = new Set([...mods, key.toLowerCase()]);
  return (COLLISIONS[os] || []).some(list => list.length === have.size && list.every(item => have.has(item)));
}
