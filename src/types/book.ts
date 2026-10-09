/**
 * Model data buku (stabil & berversi).
 * Plain-text sebuah blok = gabungan runs[].t
 */

export type RunFormat = 'i' | 'b' | 'ib' | '';

export interface Run {
  t: string;
  f: RunFormat;
}

export type BlockType = 'p' | 'quote' | 'h' | 'img' | 'orn';

export interface Block {
  /** Format: `${chapterIndex}-${blockIndex}` */
  id: string;
  type: BlockType;
  /** Untuk blok teks (p, quote, h) */
  runs?: Run[];
  /** Nomor halaman PDF asal */
  page: number;
  /** Untuk blok img: key di IndexedDB blobs store */
  imgKey?: string;
  /** Untuk blok img: dimensi asli (dalam px pada 150 DPI) */
  imgW?: number;
  imgH?: number;
}

export type ChapterKind = 'prologue' | 'part' | 'chapter';

export interface Chapter {
  id: string;
  kind: ChapterKind;
  label: string;
  title: string;
  subtitle: string;
  blocks: Block[];
}

export interface Book {
  id: string;
  title: string;
  author: string;
  /** Versi parser — dipakai untuk re-anchor highlight */
  parserVersion: string;
  pageCount: number;
  chapters: Chapter[];
}

export interface HighlightSegment {
  blockId: string;
  start: number;
  end: number;
}

export interface Highlight {
  id: string;
  bookId: string;
  groupSegments: HighlightSegment[];
  text: string;
  prefix: string;
  suffix: string;
  color: string;
  note?: string;
  label?: 'kutipan' | 'kata' | 'ide';
  parserVersion: string;
  createdAt: number;
  updatedAt: number;
}
