/* Privacy page: the same catalog, language choice and colour mode as the other extension pages.
   Nothing is sent anywhere. */
import {t, setUiLanguage, translateDOM, catalogReady, uiLanguages} from './i18n.js';
import {product} from './product-config.js';

const api = globalThis.chrome?.runtime?.id ? globalThis.chrome : globalThis.browser;
await catalogReady;
try {
  const saved = (await api.storage.local.get('pageSettings')).pageSettings || {};
  if (uiLanguages.some(item => item.code === saved.uiLanguage)) setUiLanguage(saved.uiLanguage);
  if (['dark', 'light'].includes(saved.playerTheme)) document.documentElement.dataset.readerTheme = saved.playerTheme;
} catch {}
translateDOM();
document.querySelector('#privacy-contact').textContent = t('privacyPageContact', {mail: product.feedbackMail});
document.title = t('privacyPageTitle') + ' · ' + product.name;
