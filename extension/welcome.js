/* beNotable! Reader · welcome page, opened once after a fresh install (own code, MIT).
   Goal: the first sound within a minute. Nothing here talks to a server: the voice sample is a short recording shipped
   with the extension (samples/), made with the very voice that will read first, so it plays even without any system
   voice. No preference, counter or identifier is written. */
import {t, getUiLanguage, setUiLanguage, translateDOM, catalogReady, uiLanguages} from './i18n.js';
import {product} from './product-config.js';
import {MODELS, modelBytes, recommendTier} from './models/registry.js';
import {DEFAULT_ENGLISH_VOICE} from './config.mjs';
import {formatCombo} from './platform/keycombo.mjs';
import {deviceStartVoice} from './voice-picker.mjs';

const api = globalThis.chrome?.runtime?.id ? globalThis.chrome : globalThis.browser;
const $ = selector => document.querySelector(selector);
await catalogReady;
{ // the language and colour mode already chosen in the settings (the page can be reopened from the popup)
  try {
    const saved = (await api.storage.local.get('pageSettings')).pageSettings || {};
    if (uiLanguages.some(item => item.code === saved.uiLanguage)) setUiLanguage(saved.uiLanguage);
    if (['dark', 'light'].includes(saved.playerTheme)) document.documentElement.dataset.readerTheme = saved.playerTheme;
  } catch {}
}

/* The voice that reads first in a language is the one the first Play downloads: English is preset to Bella (config DEFAULT_ENGLISH_VOICE),
   every other language follows the device rule of the bar (voice-picker deviceStartVoice). Whether the engine has threads is the engine host's answer:
   since 2.5.3 only the host document is cross-origin isolated (platform/engine-isolation.mjs), this page is not. Asking creates the empty host document,
   never a model load. Before 2.5.1 this page named Thorsten high (114 MB) while Play loaded medium (63 MB). */
const engineCaps = await (async () => {
  try {
    const ask = (async () => { await api.runtime.sendMessage({t: 'ensureHost'}); return (await api.runtime.sendMessage({target: 'host', t: 'models'}))?.caps || null; })();
    return await Promise.race([ask, new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
  } catch { return null; }
})();
function firstVoice(language) {
  const models = Object.values(MODELS);
  const preset = language === 'en' ? models.find(m => m.voiceURI === DEFAULT_ENGLISH_VOICE) : null;
  const memory = engineCaps?.memoryGB ?? navigator.deviceMemory, threads = engineCaps ? engineCaps.threads === true : globalThis.crossOriginIsolated === true;
  const tier = recommendTier({memory, cores: engineCaps?.cores ?? navigator.hardwareConcurrency, threads});
  const model = preset || deviceStartVoice(models, language, {tier, memoryGB: memory});
  return model?.sample ? model : null;
}
const sampleVoice = language => firstVoice(language) || firstVoice('en');
/* "English 326 MB, German 114 MB": the two languages most people start with; other interfaces list their own first. */
function sizeList(language) {
  const languages = ['de', 'en'].includes(language) ? ['en', 'de'] : [language, 'en'];
  const names = new Intl.DisplayNames([language], {type: 'language'});
  const mb = new Intl.NumberFormat(language, {style: 'unit', unit: 'megabyte', maximumFractionDigits: 0});
  return languages.map(code => [code, firstVoice(code)]).filter(([, model]) => model)
    .map(([code, model]) => names.of(code) + ' ' + mb.format(Math.round(modelBytes(model) / 1e6))).join(', ');
}
/* Same display as the keyboard settings: "Alt+Shift+Left Arrow" from the browser becomes Alt+Shift+← (⌥⇧← on a Mac). */
const ARROWS = {Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown'};
const code = part => ARROWS[part] || (/^[A-Z0-9]$/.test(part) ? (/\d/.test(part) ? 'Digit' : 'Key') + part : part);
/* The browser names the keys in its own language ("Alt+Umschalttaste+Linkspfeil", "Alt+Maj+Flèche gauche"): mapped to the key codes first,
   otherwise those long names squeezed the descriptions next to them onto three lines. */
const LOCAL_KEYS = {umschalttaste: 'Shift', umschalt: 'Shift', strg: 'Ctrl', maj: 'Shift', 'mayús': 'Shift', mayus: 'Shift', maiusc: 'Shift',
  linkspfeil: 'Left', rechtspfeil: 'Right', 'nach-oben-taste': 'Up', 'nach-unten-taste': 'Down', 'flèche gauche': 'Left', 'flèche droite': 'Right',
  'flecha izquierda': 'Left', 'flecha derecha': 'Right', 'freccia sinistra': 'Left', 'freccia destra': 'Right', 'seta para a esquerda': 'Left', 'seta para a direita': 'Right'};
const pretty = shortcut => formatCombo(shortcut.replace(/ Arrow$/, '').split('+').map(part => LOCAL_KEYS[part.trim().toLowerCase()] || part).map(code).join('+')) || shortcut;
/* The browser-wide commands of manifest.json, with the keys the person actually has (they can be changed). */
const COMMANDS = [['_execute_action', 'extWelcomeKeyOpen'], ['toggle-play', 'kbPlayPause'],
  ['previous-section', 'kbPreviousSection'], ['next-section', 'kbNextSection']];
async function commandKeys() {
  let all = [];
  try { all = await api.commands?.getAll?.() || []; } catch {}
  return COMMANDS.map(([name, label]) => ({label, shortcut: all.find(item => item.name === name)?.shortcut || ''}));
}

async function render() {
  translateDOM();
  document.title = t('extWelcomeTitle') + ' · ' + product.name;
  for (const node of document.querySelectorAll('[data-product]')) node.textContent = product.name;
  $('#version').textContent = 'v' + api.runtime.getManifest().version;
  const keys = await commandKeys(), open = keys[0].shortcut, unset = t('extWelcomeKeyUnset');
  $('#welcome-own-text').textContent = t('extWelcomeStep2Text', {shortcut: open ? pretty(open) : unset});
  $('#welcome-voice-text').textContent = t('extWelcomeVoiceText', {sizes: sizeList(getUiLanguage())});
  $('#welcome-keys').replaceChildren(...keys.flatMap(({label, shortcut}) => {
    const term = document.createElement('dt'), key = document.createElement('kbd'), text = document.createElement('dd');
    key.textContent = shortcut ? pretty(shortcut) : unset; term.append(key); text.textContent = t(label);
    return [term, text];
  }));
  const keysMore = t('extWelcomeKeysMore', {settings: t('settings'), keyboard: t('kbSettingsTitle')});
  $('#welcome-keys-more').textContent = keysMore;
}

/* The pin hint only when the icon is really not on the toolbar (Chrome 91+ and recent Firefox; otherwise no hint). */
async function showPinHint() {
  try {
    const settings = await api.action?.getUserSettings?.();
    $('#welcome-pin').hidden = settings?.isOnToolbar !== false;
  } catch { $('#welcome-pin').hidden = true; }
}

const play = $('#welcome-play'), state = $('#welcome-sample-state');
const audio = new Audio();
audio.preload = 'none';
function setPlaying(value) {
  play.textContent = t(value ? 'extWelcomeSampleStop' : 'extWelcomeSamplePlay');
  play.setAttribute('aria-pressed', String(value));
}
function showState(key) { state.hidden = !key; state.textContent = key ? t(key) : ''; }
audio.addEventListener('ended', () => setPlaying(false));
audio.addEventListener('pause', () => setPlaying(false));
audio.addEventListener('playing', () => setPlaying(true));
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return; // removing the source on page hide is not a failure
  setPlaying(false); showState('extWelcomeSampleFailed');
});
play.addEventListener('click', async () => {
  if (!audio.paused) { audio.pause(); audio.currentTime = 0; return; }
  const url = api.runtime.getURL(sampleVoice(getUiLanguage()).sample);
  if (audio.src !== url) audio.src = url;
  showState('');
  try { await audio.play(); } catch { setPlaying(false); showState('extWelcomeSampleFailed'); }
});
window.addEventListener('pagehide', () => { audio.pause(); audio.removeAttribute('src'); });

await render();
setPlaying(false);
await showPinHint();
