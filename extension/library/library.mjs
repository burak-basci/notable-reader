import {installReaderScrollbars} from '../scrollbars.mjs';
import {libraryText} from './i18n.mjs';
import {mountLibrary} from './ui.mjs';
import {loadConfig} from '../config.mjs';
import {applyDocumentColors} from '../session/overlay-theme.mjs';
const api=globalThis.browser||globalThis.chrome,settings=await loadConfig(api.storage.local);
document.querySelector('.library-back').textContent=libraryText(settings.uiLanguage||navigator.language,'menu');
const theme=()=>{const dark=settings.playerTheme==='dark'||settings.playerTheme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.dataset.readerTheme=dark?'dark':'light';applyDocumentColors(document.documentElement,settings.overlayTheme,dark);};theme();matchMedia('(prefers-color-scheme:dark)').addEventListener('change',theme);
await mountLibrary(document.querySelector('main'),{language:settings.uiLanguage});

installReaderScrollbars(document);
