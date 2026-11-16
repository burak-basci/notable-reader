/* beNotable! Reader · error code -> locale key · own code MIT.
 * Engine, model download, audio export and file import errors carry a stable `code`; the message next to it is a
 * developer fallback. Pages translate by code through ui-locales.json (six languages), never by the message text.
 * ONE table for every surface (reader bar, popup, file view, explain panel): one cause, one text. */
export const ERROR_KEYS = Object.freeze({
  offline: 'offline_download',
  unreachable: 'offline_unreachable',
  quota: 'voice_quota',
  stalled: 'voice_stalled',
  hash: 'voice_hash',
  incomplete: 'voice_incomplete',
  'worker-crashed': 'voice_worker_crashed',
  interrupted: 'voice_download_interrupted',
  size: 'fileErrDownloadSize',
  busy: 'fileErrDownloadBusy',
  'not-installed': 'fileErrDownloadFirst',
  'export-busy': 'extErrorExportBusy',
  'file-too-large': 'fileErrTooLarge',
  'pdf-too-large': 'fileErrPdfTooLarge',
  'webgpu-unavailable': 'gpu_missing',
  'jspi-unavailable': 'jspi_missing',
  'webgpu-failed': 'gpu_failed',
});
/** Locale key for an error code, '' when the code has no own text. */
export const errorKey = code => typeof code === 'string' && Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code] : '';
/* Status keys a reading session may report as its error, besides the engine codes above. */
export const SESSION_ERROR_KEYS = Object.freeze(['reader_error', 'prepare_failed', 'no_readable_text',
  'voice_none_chosen', 'pdf_viewer']);
/** Every error status key a session may send (status allowlists of the service worker and the popup). */
export const ERROR_STATUS_KEYS = Object.freeze([...new Set([...Object.values(ERROR_KEYS), ...SESSION_ERROR_KEYS])]);
