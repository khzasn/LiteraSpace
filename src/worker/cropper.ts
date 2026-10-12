import * as pdfjs from 'pdfjs-dist';
import type { ImgJob } from './parser';
import { imageBlobKey, coverBlobKey } from '../lib/keys';

const PDF_OPTS = {
  useSystemFonts: true,
  disableFontFace: true,
  verbosity: 0,
};

/**
 * Memotong gambar dari PDF berdasarkan koordinat bbox imgJobs.
 * Berjalan baik di Web Worker maupun context lainnya dengan OffscreenCanvas / Canvas.
 */
export async function cropImages(
  buffer: ArrayBuffer,
  imgJobs: ImgJob[],
  bookId: string,
  onProgress?: (current: number, total: number) => void
): Promise<Record<string, Blob>> {
  const blobs: Record<string, Blob> = {};
  if (!imgJobs || imgJobs.length === 0) return blobs;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfForImg = await (pdfjs.getDocument as any)({
    data: new Uint8Array(buffer.slice(0)),
    ...PDF_OPTS,
  }).promise;

  for (let i = 0; i < imgJobs.length; i++) {
    const job = imgJobs[i];
    try {
      const page = await pdfForImg.getPage(job.page);
      const scale = 150 / 72; // 150 DPI
      const vp = page.getViewport({ scale });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const canvas: any = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(vp.width, vp.height)
        : document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (page.render as any)({ canvas, canvasContext: ctx, viewport: vp }).promise;

      // Koordinat PDF: bottom-left → Canvas: top-left
      const cropY = (job.pageH - job.bbox.y1) * scale;
      const cropX = job.bbox.x0 * scale;
      const cropW = (job.bbox.x1 - job.bbox.x0) * scale;
      const cropH = (job.bbox.y1 - job.bbox.y0) * scale;
      const pad = 4;
      const finalW = Math.max(1, Math.round(cropW + pad * 2));
      const finalH = Math.max(1, Math.round(cropH + pad * 2));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cropCanvas: any = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(finalW, finalH)
        : document.createElement('canvas');
      cropCanvas.width = finalW;
      cropCanvas.height = finalH;

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

      let blob: Blob;
      if (cropCanvas.convertToBlob) {
        blob = await cropCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      } else {
        blob = await new Promise<Blob>((resolve) =>
          cropCanvas.toBlob((b: Blob) => resolve(b), 'image/jpeg', 0.85)
        );
      }

      blobs[imageBlobKey(bookId, job.blockId)] = blob;
    } catch (imgErr) {
      console.warn('Gagal crop gambar halaman', job.page, imgErr);
    }

    onProgress?.(i + 1, imgJobs.length);
  }

  return blobs;
}

/**
 * Render sampul halaman 1 dari PDF.
 */
export async function createCover(
  buffer: ArrayBuffer,
  bookId: string
): Promise<Record<string, Blob>> {
  const blobs: Record<string, Blob> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfForCover = await (pdfjs.getDocument as any)({
      data: new Uint8Array(buffer.slice(0)),
      ...PDF_OPTS,
    }).promise;
    const page1 = await pdfForCover.getPage(1);
    const vp1 = page1.getViewport({ scale: 0.5 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canvas1: any = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(vp1.width, vp1.height)
      : document.createElement('canvas');
    canvas1.width = vp1.width;
    canvas1.height = vp1.height;

    const ctx1 = canvas1.getContext('2d');
    if (!ctx1) return blobs;

    ctx1.fillStyle = '#ffffff';
    ctx1.fillRect(0, 0, vp1.width, vp1.height);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page1.render as any)({ canvas: canvas1, canvasContext: ctx1, viewport: vp1 }).promise;

    let coverBlob: Blob;
    if (canvas1.convertToBlob) {
      coverBlob = await canvas1.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    } else {
      coverBlob = await new Promise<Blob>((resolve) =>
        canvas1.toBlob((b: Blob) => resolve(b), 'image/jpeg', 0.75)
      );
    }

    blobs[coverBlobKey(bookId)] = coverBlob;
  } catch (err) {
    console.warn('Gagal membuat sampul:', err);
  }
  return blobs;
}
