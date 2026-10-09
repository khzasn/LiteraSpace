/**
 * Web Worker: menerima ArrayBuffer PDF, menjalankan parser,
 * melaporkan progres per halaman, mengirim hasil ke main thread.
 */

import * as pdfjs from 'pdfjs-dist';
import { parsePdf } from './parser';
import type { ParserMessage } from './parser';

// Pdfjs worker harus di-set di dalam worker itu sendiri
// Dengan Vite, file worker di-import dengan ?url
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer; title: string; author: string }>) => {
  const { buffer, title, author } = e.data;

  try {
    const { book, imgJobs } = await parsePdf(
      buffer,
      title,
      author,
      (page, total) => {
        self.postMessage({ type: 'progress', page, total } satisfies ParserMessage);
      }
    );

    self.postMessage({ type: 'done', book, imgJobs } satisfies ParserMessage);
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies ParserMessage);
  }
};
