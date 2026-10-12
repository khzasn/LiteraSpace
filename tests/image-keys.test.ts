import { describe, it, expect } from 'vitest';
import { imageBlobKey } from '../src/lib/keys';

describe('Bagian 1: Image Blob Key Consistency', () => {
  const bookId = 'book-123';
  const blockId = '2-5';

  it('imageBlobKey menghasilkan format konsisten img_${bookId}_${blockId}', () => {
    const key = imageBlobKey(bookId, blockId);
    expect(key).toBe('img_book-123_2-5');
  });

  it('kunci yang disimpan worker harus persis sama dengan yang dicari Reader', () => {
    // Simulasi kunci yang dipakai worker
    const workerSavedKey = imageBlobKey(bookId, blockId);
    // Simulasi kunci yang dicari Reader
    const readerLookupKey = imageBlobKey(bookId, blockId);

    expect(workerSavedKey).toBe(readerLookupKey);
    expect(workerSavedKey).toBe('img_book-123_2-5');
  });
});
