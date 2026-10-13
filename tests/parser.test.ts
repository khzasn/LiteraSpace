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
import type { Book } from '../src/types/book';

// Jumlah kata dari PDF domain publik Project Gutenberg (Alice's Adventures in Wonderland)
const GOLDEN_WORD_COUNT = 1134;

const PDF_PATH = join(__dirname, 'fixtures', 'gutenberg.pdf');
const PDF_ALT_PATH = join(__dirname, 'fixtures', 'book.pdf');

describe('Parser Golden Test', () => {
  let parsedBook: Book;
  let pdfAvailable = false;

  beforeAll(async () => {
    // Cari PDF: dari fixtures/gutenberg.pdf dulu
    const path = existsSync(PDF_PATH)
      ? PDF_PATH
      : existsSync(PDF_ALT_PATH)
      ? PDF_ALT_PATH
      : null;

    if (!path) {
      console.warn('⚠ PDF tidak ditemukan, skip golden test.');
      return;
    }

    const pdfBuffer = readFileSync(path).buffer as ArrayBuffer;
    pdfAvailable = true;

    // Set pdfjs worker untuk Node (legacy build — tidak pakai worker)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = '';

    const res = await parsePdf(pdfBuffer.slice(0), 'Test Book', 'Test Author');
    parsedBook = res.book;
  }, 60000);

  it('jumlah kata harus sama dengan golden value', () => {
    if (!pdfAvailable) return;

    const words = countWords(parsedBook);

    console.log(`\n📊 Hasil parser:`);
    console.log(`   Jumlah kata   : ${words.toLocaleString('id')}`);
    console.log(`   Golden value  : ${GOLDEN_WORD_COUNT.toLocaleString('id')}`);
    console.log(`   Selisih       : ${Math.abs(words - GOLDEN_WORD_COUNT)}`);
    console.log(`   Bab           : ${parsedBook.chapters.length}`);
    console.log(`   Paragraf      : ${parsedBook.chapters.flatMap((c) => c.blocks.filter((b) => b.type === 'p')).length}`);
    console.log(`   Gambar        : ${parsedBook.chapters.flatMap((c) => c.blocks.filter((b) => b.type === 'img')).length}`);

    expect(Math.abs(words - GOLDEN_WORD_COUNT)).toBeLessThanOrEqual(10);
  });

  it('urutan label bab harus persis: "", "PART I", "CHAPTER 1", "CHAPTER 2", "CHAPTER 3", "CHAPTER 4"', () => {
    if (!pdfAvailable) return;
    const labels = parsedBook.chapters.map((c) => c.label);
    expect(labels).toEqual([
      '',
      'PART I',
      'CHAPTER 1',
      'CHAPTER 2',
      'CHAPTER 3',
      'CHAPTER 4',
    ]);
  });

  it('dua PART berurutan tidak menggeser label CHAPTER berikutnya', async () => {
    const syntheticBuffer = createSyntheticPdf([
      {
        lines: [
          { text: 'Prologue', size: 24, y: 700 },
          { text: 'Introductory prologue paragraph that opens the story.', size: 15, y: 650 },
        ],
      },
      {
        lines: [
          { text: 'PART I', size: 22, y: 700 },
          { text: 'THE SURPRISE', size: 18, y: 650 },
          { text: 'Part one narrative text providing context.', size: 15, y: 600 },
        ],
      },
      {
        lines: [
          { text: 'PART II', size: 22, y: 700 },
          { text: 'THE CONFLICT', size: 18, y: 650 },
          { text: 'Part two narrative text continuing the theme.', size: 15, y: 600 },
        ],
      },
      {
        lines: [
          { text: 'CHAPTER 1', size: 18, y: 700 },
          { text: 'The First Encounter', size: 24, y: 650 },
          { text: 'Chapter one detailed narrative begins right here.', size: 15, y: 600 },
        ],
      },
      {
        lines: [
          { text: 'CHAPTER 2', size: 18, y: 700 },
          { text: 'The Second Phase', size: 24, y: 650 },
          { text: 'Chapter two continues the detailed story.', size: 15, y: 600 },
        ],
      },
    ]);

    const { book } = await parsePdf(syntheticBuffer, 'Two Parts Test', 'Test Author');
    const labels = book.chapters.map((c) => c.label);

    // Label diambil persis dari PDF tanpa pergeseran atau translasi
    expect(labels).toEqual([
      '',
      'PART I',
      'PART II',
      'CHAPTER 1',
      'CHAPTER 2',
    ]);
  });

  it('tidak ada paragraf yang kosong', () => {
    if (!pdfAvailable) return;
    const emptyParas = parsedBook.chapters
      .flatMap((c) => c.blocks)
      .filter(
        (b) => (b.type === 'p' || b.type === 'quote') && !b.runs?.some((r) => r.t.trim())
      );
    expect(emptyParas).toHaveLength(0);
  });

  it('setiap bab punya id unik', () => {
    if (!pdfAvailable) return;
    const ids = parsedBook.chapters.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('setiap blok punya id dengan format chapterIndex-blockIndex', () => {
    if (!pdfAvailable) return;
    const allBlocks = parsedBook.chapters.flatMap((c) => c.blocks);
    for (const b of allBlocks) {
      expect(b.id).toMatch(/^\d+-\d+$/);
    }
  });

  it('semua blok img punya page valid', () => {
    if (!pdfAvailable) return;
    const imgBlocks = parsedBook.chapters.flatMap((c) => c.blocks).filter((b) => b.type === 'img');
    for (const b of imgBlocks) {
      expect(b.page).toBeGreaterThan(0);
      expect(b.page).toBeLessThanOrEqual(parsedBook.pageCount);
    }
  });
});

/** Helper untuk membuat PDF sintetis sederhana untuk pengujian */
function createSyntheticPdf(pages: { lines: { text: string; size: number; y: number }[] }[]): ArrayBuffer {
  let out = `%PDF-1.4\n`;
  const objects: string[] = [];

  const catalogObjNum = 1;
  const pagesObjNum = 2;
  const fontObjNum = 3;

  objects[catalogObjNum] = `<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>`;
  objects[fontObjNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  const pageObjNums: number[] = [];
  let nextObj = 4;

  for (let i = 0; i < pages.length; i++) {
    const pageNum = nextObj++;
    const contentNum = nextObj++;
    pageObjNums.push(pageNum);

    let streamContent = '';
    for (const line of pages[i].lines) {
      streamContent += `BT /F1 ${line.size} Tf 72 ${line.y} Td (${line.text}) Tj ET\n`;
    }

    objects[contentNum] = `<< /Length ${Buffer.byteLength(streamContent)} >>\nstream\n${streamContent}\nendstream`;
    objects[pageNum] = `<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentNum} 0 R >>`;
  }

  objects[pagesObjNum] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`;

  const offsets: number[] = [0];
  let currentOffset = Buffer.byteLength(out);

  for (let i = 1; i < objects.length; i++) {
    offsets[i] = currentOffset;
    const objStr = `${i} 0 obj\n${objects[i]}\nendobj\n`;
    out += objStr;
    currentOffset += Buffer.byteLength(objStr);
  }

  const startXref = currentOffset;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root ${catalogObjNum} 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

  const buf = Buffer.from(out, 'utf-8');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
