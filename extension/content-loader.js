/* Injected by chrome.scripting.executeScript (activeTab) when the user opens the reader on a page. Classic script that starts the module session. */
(async () => {
  const api = globalThis.chrome?.runtime?.id ? globalThis.chrome : globalThis.browser;
  try {
    const module = await import(api.runtime.getURL('session/page-session.mjs'));
    const hidden = globalThis.__notableStartHidden === true; delete globalThis.__notableStartHidden;   // set by the toolbar popup: start the session without showing the overlay
    await module.start({hidden});
  } catch (error) { console.warn('beNotable! Reader: Sitzung konnte nicht gestartet werden', error?.message); }
})();
