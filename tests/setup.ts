/**
 * Setup file untuk Vitest (setupFiles) — dijalankan di context test worker,
 * sebelum tiap test file. Patch pdfjs GlobalWorkerOptions agar Node.js
 * bisa parse PDF tanpa Web Worker.
 */
import * as pdfjs from 'pdfjs-dist';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Resolve path ke pdf.worker.mjs
const workerPath = join(
  process.cwd(),
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
);
import { pathToFileURL } from 'url';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pdfjs as any).GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
