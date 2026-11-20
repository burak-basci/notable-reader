/* Page text of the file view · own code MIT.
 * Static text carries data-i18n (text) and data-i18n-attr ("attribute:key;attribute:key"); the German markup stays as the fallback.
 * Messages thrown by shared modules (archives, PDF, model download, speech) are German source strings: they are mapped here to catalog
 * keys, so those modules stay free of UI language. Unknown messages pass through unchanged. */

/** `**bold**` inside a catalog text becomes a <strong> node (no innerHTML). */
export function setRichText(element, text) {
  if (!text.includes('**')) { if (element.textContent !== text) element.textContent = text; return; }
  element.replaceChildren(...text.split('**').flatMap((part, index) => {
    if (!part) return [];
    if (index % 2 === 0) return [document.createTextNode(part)];
    const strong = document.createElement('strong');
    strong.textContent = part;
    return [strong];
  }));
}

export function applyStaticText(root, text) {
  for (const element of root.querySelectorAll('[data-i18n]')) setRichText(element, text(element.dataset.i18n));
  for (const element of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of element.dataset.i18nAttr.split(';')) {
      const [attribute, key] = pair.split(':');
      if (attribute && key) element.setAttribute(attribute, text(key));
    }
  }
}

const ARCHIVE = /^(Das Archiv (ist|enthält|wurde)|Mehrteilige, ZIP64|Die Archivstruktur|Die Größenangaben des Archivs|Dieses Kompressionsformat|Die Dateiheader|Die Archivgröße|Die Dokumentstruktur|Die entpackte Dateigröße|Die Prüfsumme|Das Dokumentarchiv|Das EPUB enthält zu viele)/;
const KNOWN = [
  [ARCHIVE, 'fileErrArchive'],
  [/^(Invalid PDF structure|Invalid PDF|PDF header not found|Bad XRef|Invalid XRef|Missing PDF|Unexpected end of (PDF|file))/i, 'fileErrBroken'],       // pdf.js parser messages (2.5.4 showed 'Invalid PDF structure.' in a German interface)
  [/(überschreitet die sichere Grenze von 128 MB|zu groß für den sicheren Archivimport|Der entpackte Inhalt überschreitet|Die EPUB-Kapitel überschreiten)/, 'fileErrTooLarge'],
  [/^Verschlüsselte EPUB-/, 'fileErrEncrypted'],
  [/^Dieses EPUB (ist geschützt|enthält verschlüsselte)/, 'fileErrDrm'],
  [/keinen lesbaren Dokumenttext/, 'fileErrNoText'],
  [/^Dies ist keine unterstützte DOCX/, 'fileErrDocx'],
  [/^Das Dokument enthält zu viele Abbildungen/, 'fileErrManyFigures'],
  [/^(?<count>\d[\d.,]*) externe oder nicht unterstützte Abbildungen/, 'fileErrFiguresSkipped'],
  [/^Bitte PDF, EPUB ohne DRM/, 'fileErrFileType'],
  [/^(Die lokale PDF-Datei überschreitet|Dieses Dokument überschreitet die lokale PDF-Seitengrenze)/, 'fileErrPdfLimit'],
  [/^(Die PDF-|Diese PDF-Seite|Ungültige PDF-|PDF-Seite konnte nicht gerastert)/, 'fileErrPdfRaster'],
  [/^(Eine lokale Abbildung ist beschädigt|Die Abbildungen überschreiten|Die Bildposition)/, 'fileErrFigureLimit'],
  [/^Ein Modelldownload läuft bereits/, 'fileErrDownloadBusy'],
  [/^Lokale KI-Stimmen benötigen HTTPS/, 'fileErrNeedsHttps'],
  [/^Lokale KI-Modelle wurden von diesem Gerät gelöscht/, 'fileErrModelsDeleted'],
  [/^Bitte das Sprachmodell zuerst/, 'fileErrDownloadFirst'],
  [/^Der Modelldownload überschreitet/, 'fileErrDownloadSize'],
  [/^Der Modelldownload ist unvollständig/, 'voice_incomplete'],
  [/^Der Modell-Fingerabdruck/, 'voice_hash'],
  [/^Der Modellanbieter ist derzeit nicht erreichbar/, 'offline_unreachable'],
  [/^Kein Netz: Das Sprachmodell/, 'offline_download'],
  [/^Die Texterkennung konnte nicht gestartet/, 'ocrErrStart'],
  [/^Die Texterkennung ist bei Seite (?<n>\d+) fehlgeschlagen/, 'ocrErrPage'],
  [/^(Die Texterkennung konnte das Bild nicht lesen|Diese Sprache wird von der Texterkennung|Das Sprachpaket der Texterkennung fehlt|Die Seite konnte nicht in ein Bild)/, 'ocrFailed'],
  [/^Dieser Browser bietet keine Sprachausgabe/, 'fileErrNoSpeech'],
  [/^Keine passende Stimme verfügbar/, 'fileErrNoVoice'],
  [/^Die gewählte Stimme konnte nicht sprechen/, 'fileErrVoiceFailed'],
  [/^Die Sprachausgabe konnte nicht gestartet werden/, 'fileErrSpeechStart']
];

/** German source message from a shared module -> text in the UI language (unchanged when unknown). */
export function localizeMessage(message, text) {
  if (typeof message !== 'string' || !message) return message;
  for (const [pattern, key] of KNOWN) {
    const match = pattern.exec(message);
    if (match) return text(key, match.groups || {}) ?? message;
  }
  return message;
}
