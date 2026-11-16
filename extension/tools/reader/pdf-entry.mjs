/* Main-thread entry for pdf.js: the stand-ins for newer built-ins load first, then the unchanged vendor file. */
import './pdf-polyfills.mjs';
export * from './vendor/pdfjs/pdf.mjs';
