/* Worker entry for pdf.js (GlobalWorkerOptions.workerSrc): stand-ins first, then the unchanged vendor worker.
 * Static imports run in order, so the worker never calls a missing built-in. */
import './pdf-polyfills.mjs';
import './vendor/pdfjs/pdf.worker.mjs';
