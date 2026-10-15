/**
 * Setup file untuk Vitest (setupFiles) — dijalankan di context test worker,
 * sebelum tiap test file. Patch pdfjs GlobalWorkerOptions dan sediakan DOM minimal.
 */
import * as pdfjs from 'pdfjs-dist';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { JSDOM } from 'jsdom';

// Polyfill Promise.withResolvers untuk lingkungan Node < 22
if (typeof Promise.withResolvers === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Promise as any).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Setup DOM global untuk pengujian komponen & DOM
if (typeof window === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost:5173/',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).document = dom.window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).HTMLElement = dom.window.HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).localStorage = dom.window.localStorage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).URL = dom.window.URL;
}

// Resolve path ke pdf.worker.mjs
const workerPath = join(
  process.cwd(),
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pdfjs as any).GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
