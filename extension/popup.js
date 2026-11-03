'use strict';
document.querySelector('#read-page').addEventListener('click', async () => {
  const status = document.querySelector('#popup-status');
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw Error('restricted');
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['vendor/Readability.js', 'core.js', 'content-reader.js']});
    window.close();
  } catch {
    status.textContent = 'Auf dieser Browser- oder PDF-Seite ist die Leiste gesperrt. Öffne eine lokale PDF-Datei oder füge den Text im Reader ein.';
  }
});
