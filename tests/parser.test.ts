/**
 * Golden test parser — Tahap 1
 *
 * Validasi: jumlah kata teks hasil HARUS sama dengan jumlah kata dari PDF asli.
 * Jalankan: npx vitest run tests/parser.test.ts
 *
 * Requirement: taruh PDF referensi di tests/fixtures/
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
// Pakai legacy build agar kompatibel di Node.js
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist';
import { parsePdf, countWords } from '../src/worker/parser';


// Jumlah kata yang diketahui dari prototipe untuk PDF E-Book Thinking again BAB 1 (ver.indo).pdf
const GOLDEN_WORD_COUNT = 21643;

const PDF_PATH = join(__dirname, 'fixtures', 'book.pdf');
const PDF_ALT_PATH = join(
  __dirname,
  '..',
  'E-Book Thinking again BAB 1 (ver.indo).pdf'
);

describe('Parser Golden Test', () => {
  let pdfBuffer: ArrayBuffer;
  let pdfAvailable = false;

  beforeAll(() => {
    // Cari PDF: dari fixtures/ dulu, fallback ke root workspace
    const path = existsSync(PDF_PATH)
      ? PDF_PATH
      : existsSync(PDF_ALT_PATH)
      ? PDF_ALT_PATH
      : null;

    if (!path) {
      console.warn('⚠ PDF tidak ditemukan, skip golden test.');
      return;
    }

    pdfBuffer = readFileSync(path).buffer as ArrayBuffer;
    pdfAvailable = true;

    // Set pdfjs worker untuk Node (legacy build — tidak pakai worker)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = '';
  });

  it('jumlah kata harus sama dengan golden value', async () => {
    if (!pdfAvailable) {
      console.warn('Skip: PDF tidak tersedia');
      return;
    }

    const { book } = await parsePdf(pdfBuffer.slice(0), 'Test', 'Test');
    const words = countWords(book);

    console.log(`\n📊 Hasil parser:`);
    console.log(`   Jumlah kata   : ${words.toLocaleString('id')}`);
    console.log(`   Golden value  : ${GOLDEN_WORD_COUNT.toLocaleString('id')}`);
    console.log(`   Selisih       : ${Math.abs(words - GOLDEN_WORD_COUNT)}`);
    console.log(`   Bab           : ${book.chapters.length}`);
    console.log(`   Paragraf      : ${book.chapters.flatMap((c) => c.blocks.filter((b) => b.type === 'p')).length}`);
    console.log(`   Gambar        : ${book.chapters.flatMap((c) => c.blocks.filter((b) => b.type === 'img')).length}`);

    // Toleransi ±10 kata (label CHAPTER→BAB)
    expect(Math.abs(words - GOLDEN_WORD_COUNT)).toBeLessThanOrEqual(10);
  });

  it('tidak ada paragraf yang kosong', async () => {
    if (!pdfAvailable) return;
    const { book } = await parsePdf(pdfBuffer.slice(0), 'Test', 'Test');
    const emptyParas = book.chapters
      .flatMap((c) => c.blocks)
      .filter(
        (b) => (b.type === 'p' || b.type === 'quote') && !b.runs?.some((r) => r.t.trim())
      );
    expect(emptyParas).toHaveLength(0);
  });

  it('setiap bab punya id unik', async () => {
    if (!pdfAvailable) return;
    const { book } = await parsePdf(pdfBuffer.slice(0), 'Test', 'Test');
    const ids = book.chapters.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('setiap blok punya id dengan format chapterIndex-blockIndex', async () => {
    if (!pdfAvailable) return;
    const { book } = await parsePdf(pdfBuffer.slice(0), 'Test', 'Test');
    const allBlocks = book.chapters.flatMap((c) => c.blocks);
    for (const b of allBlocks) {
      expect(b.id).toMatch(/^\d+-\d+$/);
    }
  });

  it('semua blok img punya page valid', async () => {
    if (!pdfAvailable) return;
    const { book } = await parsePdf(pdfBuffer.slice(0), 'Test', 'Test');
    const imgBlocks = book.chapters.flatMap((c) => c.blocks).filter((b) => b.type === 'img');
    for (const b of imgBlocks) {
      expect(b.page).toBeGreaterThan(0);
      expect(b.page).toBeLessThanOrEqual(book.pageCount);
    }
  });
});
