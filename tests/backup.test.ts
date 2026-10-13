import { describe, it, expect } from 'vitest';
import { createZipBackup, parseBackupFile } from '../src/lib/backup';
import type { Book } from '../src/types/book';

describe('Bagian 4: Backup ZIP dan Kompatibilitas JSON Lama', () => {
  const dummyBook: Book = {
    id: 'book-1',
    title: 'Test Book',
    author: 'Author',
    parserVersion: '1.1.0',
    pageCount: 10,
    chapters: [],
  };

  it('createZipBackup membungkus backup.json dan folder blobs/<key>', async () => {
    const dummyBlob = new Blob(['sample-image-data'], { type: 'image/jpeg' });
    const blobs = {
      'img_book-1_0-1': dummyBlob,
      'cover_book-1': dummyBlob,
    };

    const zipBlob = await createZipBackup({
      books: [dummyBook],
      highlights: [],
      settings: '{}',
      positions: [],
      blobs,
      includePdf: false,
    });

    expect(zipBlob.type).toBe('application/zip');
    expect(zipBlob.size).toBeGreaterThan(0);

    const parsed = await parseBackupFile(zipBlob);
    expect(parsed.isLegacyJson).toBe(false);
    expect(parsed.backup.books).toHaveLength(1);
    expect(parsed.blobs).toHaveProperty('img_book-1_0-1');
    expect(parsed.blobs).toHaveProperty('cover_book-1');
  });

  it('createZipBackup menyertakan atau mengecualikan pdf_<bookId> sesuai opsi includePdf', async () => {
    const dummyImg = new Blob(['img'], { type: 'image/jpeg' });
    const dummyPdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const blobs = {
      'img_book-1_0-1': dummyImg,
      'pdf_book-1': dummyPdf,
    };

    const zipWithPdf = await createZipBackup({
      books: [dummyBook],
      highlights: [],
      settings: null,
      positions: [],
      blobs,
      includePdf: true,
    });
    const parsedWith = await parseBackupFile(zipWithPdf);
    expect(parsedWith.blobs).toHaveProperty('pdf_book-1');
    expect(parsedWith.blobs).toHaveProperty('img_book-1_0-1');

    const zipWithoutPdf = await createZipBackup({
      books: [dummyBook],
      highlights: [],
      settings: null,
      positions: [],
      blobs,
      includePdf: false,
    });
    const parsedWithout = await parseBackupFile(zipWithoutPdf);
    expect(parsedWithout.blobs).not.toHaveProperty('pdf_book-1');
    expect(parsedWithout.blobs).toHaveProperty('img_book-1_0-1');
  });

  it('parseBackupFile mengenali file .json lama dan menandainya sebagai legacy', async () => {
    const legacyJson = JSON.stringify({
      version: 1,
      books: [dummyBook],
      highlights: [],
    });
    const jsonBlob = new Blob([legacyJson], { type: 'application/json' });

    const parsed = await parseBackupFile(jsonBlob);
    expect(parsed.isLegacyJson).toBe(true);
    expect(parsed.backup.books).toHaveLength(1);
    expect(parsed.warning).toContain('Backup lama tidak berisi gambar');
  });
});
