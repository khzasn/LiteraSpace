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
      buffer.slice(0),
      title,
      author,
      (page, total) => {
        self.postMessage({ type: 'progress', page, total } satisfies ParserMessage);
      }
    );

    // Proses pemotongan gambar di worker (OffscreenCanvas)
    const blobs: Record<string, Blob> = {};
    if (imgJobs.length > 0) {
      self.postMessage({ type: 'progress', page: 0, total: imgJobs.length, message: 'Memproses gambar...' } as any);
      
      // Load PDF sekali lagi untuk render (membutuhkan copy buffer baru)
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(buffer.slice(0)),
        standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
      }).promise;

      for (let i = 0; i < imgJobs.length; i++) {
        const job = imgJobs[i];
        const page = await pdf.getPage(job.page);
        
        const scale = 150 / 72; // Render di 150 DPI
        const vp = page.getViewport({ scale });
        
        const canvas = new OffscreenCanvas(vp.width, vp.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport: vp } as any).promise;

        // PDF coordinate: bottom-left. Canvas: top-left.
        const cropY = (job.pageH - job.bbox.y1) * scale;
        const cropX = job.bbox.x0 * scale;
        const cropW = (job.bbox.x1 - job.bbox.x0) * scale;
        const cropH = (job.bbox.y1 - job.bbox.y0) * scale;

        // Padding kecil (opsional)
        const pad = 4;
        const finalW = Math.max(1, cropW + pad * 2);
        const finalH = Math.max(1, cropH + pad * 2);
        
        const cropCanvas = new OffscreenCanvas(finalW, finalH);
        const cropCtx = cropCanvas.getContext('2d');
        if (!cropCtx) continue;
        
        // Background putih agar tidak transparan di dark mode (karena pdf biasanya transparan)
        cropCtx.fillStyle = '#ffffff';
        cropCtx.fillRect(0, 0, finalW, finalH);
        
        cropCtx.drawImage(
          canvas,
          Math.max(0, cropX - pad), Math.max(0, cropY - pad),
          cropW + pad * 2, cropH + pad * 2,
          0, 0, finalW, finalH
        );

        const blob = await cropCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        blobs[`${book.id}_${job.blockId}`] = blob;
        
        self.postMessage({ type: 'progress', page: i + 1, total: imgJobs.length, message: 'Memproses gambar...' } as any);
      }
    }

    self.postMessage({ type: 'done', book, imgJobs, blobs } as any);
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies ParserMessage);
  }
};
