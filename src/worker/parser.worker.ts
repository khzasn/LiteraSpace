/**
 * Web Worker: menerima ArrayBuffer PDF, menjalankan parser,
 * melaporkan progres per halaman, mengirim hasil ke main thread.
 */

import * as pdfjs from 'pdfjs-dist';
import { parsePdf } from './parser';
import type { ParserMessage } from './parser';
import { imageBlobKey, coverBlobKey } from '../lib/keys';

// @ts-ignore
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Opsi pdfjs yang aman untuk Web Worker (tanpa akses DOM)
// Menggunakan 'as any' karena beberapa opsi tidak ada di type definitions tapi valid di runtime
const PDF_OPTS = {
  useSystemFonts: true,
  disableFontFace: true,   // ← Kunci utama: cegah pdfjs inject @font-face ke DOM
  verbosity: 0,
};

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
    const blobs: Record<string, Blob> = {};

    if (imgJobs.length > 0) {
      self.postMessage({
        type: 'progress', page: 0, total: imgJobs.length, message: 'Memproses gambar...'
      } as any);

      const pdfForImg = await pdfjs.getDocument({
        data: new Uint8Array(buffer.slice(0)),
        ...PDF_OPTS,
      } as any).promise;

      for (let i = 0; i < imgJobs.length; i++) {
        const job = imgJobs[i];
        try {
          const page = await pdfForImg.getPage(job.page);
          const scale = 150 / 72; // 150 DPI
          const vp = page.getViewport({ scale });

          const canvas = new OffscreenCanvas(vp.width, vp.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await (page.render as any)({ canvas, canvasContext: ctx, viewport: vp }).promise;

          // Koordinat PDF: bottom-left → Canvas: top-left
          const cropY = (job.pageH - job.bbox.y1) * scale;
          const cropX = job.bbox.x0 * scale;
          const cropW = (job.bbox.x1 - job.bbox.x0) * scale;
          const cropH = (job.bbox.y1 - job.bbox.y0) * scale;
          const pad = 4;
          const finalW = Math.max(1, cropW + pad * 2);
          const finalH = Math.max(1, cropH + pad * 2);

          const cropCanvas = new OffscreenCanvas(finalW, finalH);
          const cropCtx = cropCanvas.getContext('2d');
          if (!cropCtx) continue;

          cropCtx.fillStyle = '#ffffff';
          cropCtx.fillRect(0, 0, finalW, finalH);
          cropCtx.drawImage(
            canvas,
            Math.max(0, cropX - pad), Math.max(0, cropY - pad),
            cropW + pad * 2, cropH + pad * 2,
            0, 0, finalW, finalH
          );

          const blob = await cropCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
          blobs[imageBlobKey(book.id, job.blockId)] = blob;
        } catch (imgErr) {
          console.warn('Gagal crop gambar halaman', job.page, imgErr);
        }

        self.postMessage({
          type: 'progress', page: i + 1, total: imgJobs.length, message: 'Memproses gambar...'
        } as any);
      }
    }

    // ── 3. Render sampul (halaman 1) ───────────────────────────────
    try {
      self.postMessage({ type: 'progress', page: 1, total: 1, message: 'Membuat sampul...' } as any);
      const pdfForCover = await pdfjs.getDocument({
        data: new Uint8Array(buffer.slice(0)),
        ...PDF_OPTS,
      } as any).promise;
      const page1 = await pdfForCover.getPage(1);
      const vp1 = page1.getViewport({ scale: 0.5 });
      const canvas1 = new OffscreenCanvas(vp1.width, vp1.height);
      const ctx1 = canvas1.getContext('2d');
      if (ctx1) {
        ctx1.fillStyle = '#ffffff';
        ctx1.fillRect(0, 0, vp1.width, vp1.height);
        await (page1.render as any)({ canvas: canvas1, canvasContext: ctx1, viewport: vp1 }).promise;
        const coverBlob = await canvas1.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
        blobs[coverBlobKey(book.id)] = coverBlob;
      }
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
        message: `PDF ini sepertinya hasil scan atau berisi gambar saja (hanya ${wordCount} kata terdeteksi). "Pembaca Nyaman" hanya mendukung PDF berbasis teks.`,
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
    } as any);

  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('Parser worker error:', err);
    self.postMessage({ type: 'error', message: msg } satisfies ParserMessage);
  }
};
