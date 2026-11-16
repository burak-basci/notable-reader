// Generated ui-locales.json is copied byte-for-byte from ../ui-locales.json.
let catalog;
export let uiLanguages = [], formatLocales = [];
// English is the fallback everywhere: a browser language we do not ship (e.g. Dutch) must not land on German.
let language = 'en';
/* The 400 KB catalog is fetched and parsed on first use, not when the module loads: a service worker that wakes for a
   tab or frame event never needs it. ONE request per context (player-adapter.mjs reuses it); a failed fetch is not
   cached, so the next use tries again. */
let loading = null;
function load() {
  if (!loading) {
    loading = fetch(new URL('./ui-locales.json', import.meta.url)).then(response => {
      if (!response.ok) throw new Error('Locale catalog unavailable');
      return response.json();
    }).then(value => {
      if (catalog !== value) {
        catalog = value; uiLanguages = catalog.languages; formatLocales = catalog.formatLocales;
        const browser = globalThis.navigator?.language?.split('-')[0];
        language = uiLanguages.some(item => item.code === browser) ? browser : 'en';
      }
      return value;
    });
    loading.catch(() => { loading = null; });
  }
  return loading;
}
/* Promise-like handles that start the load when awaited (await, .then, .catch, .finally, Promise.all). */
const lazy = run => Object.freeze({
  then: (resolve, reject) => run().then(resolve, reject),
  catch: reject => run().catch(reject),
  finally: done => run().finally(done),
});
export const loadCatalog = () => load().then(() => {});
export const catalogData = lazy(load);
export const catalogReady = lazy(loadCatalog);
export const getUiLanguage = () => language;
export function setUiLanguage(value) {
  if (uiLanguages.some(item => item.code === value)) language = value;
  return language;
}
export function t(key, params = {}, selected = language) {
  const text = catalog?.messages[selected]?.[key] ?? catalog?.messages.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}
/* Error codes whose text lives under another key (one cause, one text). */
const ERROR_TEXT_KEYS = {premium_locked: 'extErrorPremiumRequired', no_readable_text: 'extEmptyPage'};
export function errorText(code) {
  const key = ERROR_TEXT_KEYS[code] || 'extError' + String(code).split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  // Unknown codes get a next step instead of repeating the box title; the code itself stays in the details.
  return catalog?.messages[language]?.[key] ? t(key) : t('extErrorGeneric');
}
export function translateDOM(root = document) {
  root.documentElement.lang = language;
  root.querySelectorAll('[data-i18n]').forEach(node => {node.textContent = t(node.dataset.i18n);});
  for (const [attribute, data] of [['aria-label','i18nAria'], ['title','i18nTitle'], ['placeholder','i18nPlaceholder']]) {
    root.querySelectorAll(`[data-${data.replace(/[A-Z]/g, ch => '-'+ch.toLowerCase())}]`).forEach(node => node.setAttribute(attribute,t(node.dataset[data])));
  }
}
