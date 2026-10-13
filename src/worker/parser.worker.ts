/**
 * Web Worker: menerima ArrayBuffer PDF, menjalankan parser,
 * memotong gambar, membuat sampul, dan mengirim hasil ke main thread.
 */

import * as pdfjs from 'pdfjs-dist';
import { parsePdf } from './parser';
import type { ParserMessage } from './parser';
import { cropImages, createCover } from './cropper';

// @ts-ignore
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer; title: string; author: string }>) => {
  const { buffer, title, author } = e.data;

  try {
    // ── 1. Parse teks + struktur buku ──────────────────────────────
    const { book, imgJobs } = await parsePdf(
      buffer.slice(0),
      title,
      author,
      (page, total) => {
        self.postMessage({ type: 'progress', page, total } satisfies ParserMessage);
      }
    );

    // ── 2. Potong gambar via OffscreenCanvas ───────────────────────
    let blobs: Record<string, Blob> = {};

    if (imgJobs.length > 0) {
      self.postMessage({
        type: 'progress', page: 0, total: imgJobs.length, message: 'Memproses gambar...'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const cropped = await cropImages(buffer, imgJobs, book.id, (cur, total) => {
        self.postMessage({
          type: 'progress', page: cur, total, message: 'Memproses gambar...'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      });
      blobs = { ...blobs, ...cropped };
    }

    // ── 3. Render sampul (halaman 1) ───────────────────────────────
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      self.postMessage({ type: 'progress', page: 1, total: 1, message: 'Membuat sampul...' } as any);
      const coverBlobs = await createCover(buffer, book.id);
      blobs = { ...blobs, ...coverBlobs };
    } catch (coverErr) {
      console.warn('Gagal membuat sampul:', coverErr);
      // Tidak fatal — lanjutkan tanpa sampul
    }

    // ── 4. Deteksi PDF hasil scan ──────────────────────────────────
    let wordCount = 0;
    book.chapters.forEach(c =>
      c.blocks.forEach(b => {
        if ((b.type === 'p' || b.type === 'quote') && b.runs) {
          wordCount += b.runs.map(r => r.t).join('').split(/\s+/).filter(Boolean).length;
        }
      })
    );

    if (wordCount < 50) {
      self.postMessage({
        type: 'error',
        message: `PDF ini sepertinya hasil scan atau berisi gambar saja (hanya ${wordCount} kata terdeteksi). "LiteraSpace" hanya mendukung PDF berbasis teks.`,
      } satisfies ParserMessage);
      return;
    }

    // ── 5. Kirim hasil ─────────────────────────────────────────────
    const totalImgs = imgJobs.length;
    const successImgs = Object.keys(blobs).filter(k => k.startsWith('img_')).length;
    const failedImgs = totalImgs - successImgs;

    self.postMessage({
      type: 'done',
      book,
      imgJobs,
      blobs,
      imgStats: { total: totalImgs, success: successImgs, failed: failedImgs }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('Parser worker error:', err);
    self.postMessage({ type: 'error', message: msg } satisfies ParserMessage);
  }
};
