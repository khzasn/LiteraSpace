/**
 * Kunci penyimpanan Blob (gambar, sampul, PDF) di IndexedDB.
 * Digunakan secara konsisten di worker, reader, library, ekspor, dan impor.
 */

export function imageBlobKey(bookId: string, blockId: string): string {
  return `img_${bookId}_${blockId}`;
}

export function coverBlobKey(bookId: string): string {
  return `cover_${bookId}`;
}

export function pdfBlobKey(bookId: string): string {
  return `pdf_${bookId}`;
}
