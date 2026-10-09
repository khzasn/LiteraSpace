/**
 * Internal types — hanya dipakai selama proses parsing,
 * tidak diekspor ke data Book akhir.
 */

import type { RunFormat } from '../types/book';

export interface RawItem {
  s: string;
  x: number;
  y: number;
  h: number;
  w: number;
  it: boolean;
  bd: boolean;
}

export interface LineRun {
  t: string;
  f: RunFormat;
}

export interface PageLine {
  y: number;
  x0: number;
  x1: number;
  h: number;
  runs: LineRun[];
  text: string;
  allItalic: boolean;
  anyBold: boolean;
  /** Ditandai sebagai epigraf */
  _epi?: boolean;
  /** Ditandai sebagai kutipan tengah */
  _centered?: boolean;
}

export interface ImageBbox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface ParsedPage {
  /** Nomor halaman 1-indexed */
  p: number;
  w: number;
  h: number;
  lines: PageLine[];
  /** Gambar besar (figure) */
  imgs: ImageBbox[];
  /** Ornamen gambar kecil */
  orns: ImageBbox[];
}

/** Blok internal selama parsing (sebelum diberi ID final) */
export interface InternalBlock {
  t: 'p' | 'quote' | 'h' | 'img' | 'orn';
  runs?: LineRun[];
  text?: string;
  page: number;
  /** Blok ini disambung dari halaman sebelumnya */
  _joinPrev?: boolean;
  /** Berapa kali blok ini menggabungkan paragraf lintas halaman */
  joined?: number;
  /** Data gambar mentah (sebelum crop) */
  bbox?: ImageBbox;
  pageW?: number;
  pageH?: number;
  imgIdx?: number;
}

export interface InternalChapter {
  kind: 'prologue' | 'part' | 'chapter';
  label: string;
  title: string;
  subtitle: string;
  blocks: InternalBlock[];
  _hdr: boolean;
  _orn?: boolean;
}
