/**
 * Parser PDF → Book (berjalan di browser, port dari reference/prototype/parse.mjs)
 *
 * ATURAN EMAS: isi teks tidak boleh berubah, hanya tampilan yang diubah.
 *
 * Perbedaan dari prototipe Node:
 * - Tidak ada execSync/pdftoppm; gambar di-crop via OffscreenCanvas → Blob
 * - Semua akses file lewat ArrayBuffer (pdf sudah diload di main thread)
 * - Komunikasi lewat postMessage (progress per halaman)
 */

import * as pdfjs from 'pdfjs-dist';
import type { Book, Chapter, Block, Run, RunFormat } from '../types/book';
import {
  LINE_Y_TOLERANCE,
  INDENT_THRESHOLD,
  PARA_GAP_FACTOR,
  CHAPTER_TITLE_SIZE,
  SUBHEAD_SIZE,
  SUBTITLE_SIZE,
  IMG_MIN_W,
  IMG_MIN_H,
  ORN_MAX_W,
  ORN_MAX_H,
  ORN_MIN_W,
  IMG_PAGE_FRACTION,
  CENTER_X_THRESHOLD,
  CENTER_SYMMETRY,
  LEAD_MIN,
  LEAD_MAX,
  EPIGRAF_LEAD_FACTOR,
  BODY_SIZE_MIN,
  BODY_SIZE_MAX,
  PARSER_VERSION,
} from './parser-constants';
import {
  median,
  mode,
  isItalic,
  isBold,
  endsSentence,
  ORN_RE,
  isAllPunct,
  mulCTM,
} from './parser-utils';
import type {
  RawItem,
  PageLine,
  ImageBbox,
  ParsedPage,
  InternalBlock,
  InternalChapter,
  LineRun,
} from './parser-types';

// ---- Pesan ke main thread ----
export type ParserMessage =
  | { type: 'progress'; page: number; total: number; message?: string }
  | {
      type: 'done';
      book: Book;
      imgJobs: ImgJob[];
      blobs?: Record<string, Blob>;
      imgStats?: { total: number; success: number; failed: number };
    }
  | { type: 'error'; message: string };

/** Pekerjaan crop gambar yang harus diselesaikan setelah parsing */
export interface ImgJob {
  blockId: string;
  page: number;
  bbox: ImageBbox;
  pageW: number;
  pageH: number;
}

// ---- Fungsi utama ----

export async function parsePdf(
  buffer: ArrayBuffer,
  title: string,
  author: string,
  onProgress?: (page: number, total: number) => void
): Promise<{ book: Book; imgJobs: ImgJob[] }> {
  
  if (import.meta.env?.TEST) {
    // Di environment Vitest (Node.js vm), pdf.js butuh workerSrc di-set secara eksplisit
    // karena gagal mendeteksi isNodeJS dengan benar.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pdfjs as any).GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';
  }

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  } as any).promise;
  const total = pdf.numPages;

  // ---------- 1. Ekstraksi per halaman ----------
  const pages: ParsedPage[] = [];

  for (let p = 1; p <= total; p++) {
    onProgress?.(p, total);
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const tc = await page.getTextContent();

    // Cache nama font
    const fontNameCache: Record<string, string> = {};
    const nameOf = (fn: string): string => {
      if (fontNameCache[fn] !== undefined) return fontNameCache[fn];
      let n = '';
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        n = (page.commonObjs as any).get(fn)?.name ?? '';
      } catch {
        n = '';
      }
      return (fontNameCache[fn] = n);
    };

    // --- Teks → baris (kelompokkan berdasar baseline y) ---
    const rawItems: RawItem[] = (tc.items as Array<{
      str: string; transform: number[]; width: number; fontName: string;
    }>)
      .filter((i) => i.str !== undefined && i.str !== '')
      .map((i) => ({
        s: i.str,
        x: i.transform[4],
        y: i.transform[5],
        h: Math.abs(i.transform[3]),
        w: i.width,
        it: isItalic(nameOf(i.fontName)),
        bd: isBold(nameOf(i.fontName)),
      }));

    rawItems.sort((a, b) => b.y - a.y || a.x - b.x);

    // Kelompokkan item ke baris berdasar baseline y
    const lineGroups: { y: number; items: RawItem[] }[] = [];
    for (const it of rawItems) {
      const L = lineGroups.find((l) => Math.abs(l.y - it.y) < LINE_Y_TOLERANCE);
      if (L) L.items.push(it);
      else lineGroups.push({ y: it.y, items: [it] });
    }

    const lines: PageLine[] = [];
    for (const lg of lineGroups) {
      lg.items.sort((a, b) => a.x - b.x);
      const real = lg.items.filter((i) => i.s.trim());
      if (!real.length) continue;

      const x0 = real[0].x;
      const x1 = Math.max(...lg.items.map((i) => i.x + i.w));

      // Ukuran dominan berdasar jumlah karakter
      const hs: Record<number, number> = {};
      real.forEach((i) => (hs[i.h] = (hs[i.h] ?? 0) + i.s.length));
      const h = +Object.entries(hs).sort((a, b) => +b[1] - +a[1])[0][0];

      // Runs bergaya
      const runs: LineRun[] = [];
      for (const i of lg.items) {
        const f = ((i.it ? 'i' : '') + (i.bd ? 'b' : '')) as RunFormat;
        const last = runs[runs.length - 1];
        if (last && last.f === f) last.t += i.s;
        else runs.push({ t: i.s, f });
      }

      const text = runs.map((r) => r.t).join('').replace(/\s+/g, ' ').trim();
      const nonSp = real.filter((i) => i.s.trim());
      const allItalic = nonSp.every((i) => i.it);
      const anyBold = nonSp.some((i) => i.bd);

      lines.push({ y: lg.y, x0, x1, h, runs, text, allItalic, anyBold });
    }

    // --- Gambar: lacak CTM untuk bbox ---
    let ctm: number[] = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const imgs: ImageBbox[] = [];
    const OPS = pdfjs.OPS;

    ops.fnArray.forEach((fn, k) => {
      const a = ops.argsArray[k] as number[][];
      if (fn === OPS.save) {
        stack.push(ctm);
      } else if (fn === OPS.restore) {
        ctm = stack.pop() ?? ctm;
      } else if (fn === OPS.transform) {
        ctm = mulCTM(a as unknown as number[], ctm);
      } else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        if (a[0]) ctm = mulCTM(a[0] as unknown as number[], ctm);
      } else if (fn === OPS.paintFormXObjectEnd) {
        ctm = stack.pop() ?? ctm;
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintImageMaskXObject
      ) {
        const xs = [0, 1, 0, 1].map((_, j) => {
          const uu = [0, 1, 1, 0][j];
          const vv = [0, 0, 1, 1][j];
          return [
            ctm[0] * uu + ctm[2] * vv + ctm[4],
            ctm[1] * uu + ctm[3] * vv + ctm[5],
          ];
        });
        const X = xs.map((q) => q[0]);
        const Y = xs.map((q) => q[1]);
        imgs.push({
          x0: Math.min(...X),
          x1: Math.max(...X),
          y0: Math.min(...Y),
          y1: Math.max(...Y),
        });
      }
    });

    const bigImgs = imgs.filter(
      (b) => b.x1 - b.x0 >= IMG_MIN_W && b.y1 - b.y0 >= IMG_MIN_H
    );
    const ornImgs = imgs.filter(
      (b) =>
        b.x1 - b.x0 <= ORN_MAX_W &&
        b.y1 - b.y0 <= ORN_MAX_H &&
        b.x1 - b.x0 >= ORN_MIN_W
    );

    pages.push({
      p,
      w: vp.width,
      h: vp.height,
      lines: lines.filter((l) => !isAllPunct(l.text)),
      imgs: bigImgs,
      orns: ornImgs,
    });
  }

  // ---------- 2. Tentukan awal isi (lewati cover, hak cipta, daftar isi) ----------
  let startPage = pages.findIndex((P) =>
    P.lines.some((l) => /^(Prologue|Prolog)$/i.test(l.text) && l.h >= CHAPTER_TITLE_SIZE)
  );
  if (startPage < 0) startPage = 0;

  // ---------- 3. Bangun blok ----------
  const chapters: InternalChapter[] = [];
  let cur: InternalChapter | null = null;
  let pendingPara: InternalBlock | null = null;

  const newChapter = (kind: InternalChapter['kind'], label: string) => {
    cur = { kind, label, title: '', subtitle: '', blocks: [], _hdr: true };
    chapters.push(cur);
  };
  newChapter('prologue', '');

  /** Gabung baris-baris menjadi satu blok paragraf */
  const pushPara = (
    lines: PageLine[],
    pageNo: number,
    _indentedStart: boolean
  ): InternalBlock => {
    const runs: LineRun[] = [];
    lines.forEach((L, idx) => {
      let first = true;
      for (const r of L.runs) {
        let t = r.t.replace(/\s+/g, ' ');
        if (first) t = t.replace(/^\s+/, '');
        first = false;
        runs.push({ t, f: r.f });
      }
      const last = runs[runs.length - 1];
      const nextL = lines[idx + 1];
      if (nextL && last) {
        const trimmed = last.t.replace(/\s+$/, '');
        const hyphen = /\w-$/.test(trimmed) && /^[a-zà-ÿ]/.test(nextL.text);
        last.t = trimmed + (hyphen ? '' : ' ');
      }
    });

    // Satukan run dengan format sama
    const merged: LineRun[] = [];
    runs.forEach((r) => {
      const l = merged[merged.length - 1];
      if (l && l.f === r.f) l.t += r.t;
      else merged.push({ ...r });
    });

    const text = merged.map((r) => r.t).join('').trim();
    const allItalic = merged.every((r) => r.f.includes('i') || !r.t.trim());

    return {
      t: allItalic && text.length < 400 ? 'quote' : 'p',
      runs: merged,
      text,
      page: pageNo,
    };
  };

  const flushBlock = (blk: InternalBlock) => {
    cur!.blocks.push(blk);
    pendingPara = blk.t === 'p' ? blk : null;
  };

  for (let pi = startPage; pi < pages.length; pi++) {
    const P = pages[pi];

    // Buang baris di dalam bbox gambar (teks bagian dari gambar)
    const inImg = (L: PageLine) =>
      P.imgs.some(
        (b) =>
          L.y >= b.y0 - 2 &&
          L.y <= b.y1 + 2 &&
          L.x0 >= b.x0 - 5 &&
          (b.x1 - b.x0) * (b.y1 - b.y0) < P.w * P.h * IMG_PAGE_FRACTION
      );

    const filteredLines = P.lines.filter((L) => !inImg(L));

    // Hitung layout per halaman
    const bodyLines = filteredLines.filter(
      (L) => L.h >= BODY_SIZE_MIN && L.h <= BODY_SIZE_MAX && !ORN_RE.test(L.text)
    );
    const left =
      mode(bodyLines.map((L) => Math.round(L.x0 / 2) * 2)) ?? 72;
    const maxRight = Math.max(...bodyLines.map((L) => L.x1), 0);

    const gaps: number[] = [];
    for (let i = 1; i < bodyLines.length; i++) {
      const g = bodyLines[i - 1].y - bodyLines[i].y;
      if (g > LEAD_MIN && g < LEAD_MAX) gaps.push(g);
    }
    const lead = median(gaps) || 17;

    // Susun alur: baris + gambar + ornamen, urut y dari atas ke bawah
    type FlowItem =
      | { k: 'line'; y: number; L: PageLine }
      | { k: 'img'; y: number; b: ImageBbox; n: number }
      | { k: 'orn'; y: number };

    const flow: FlowItem[] = [
      ...filteredLines.map((L) => ({ k: 'line' as const, y: L.y, L })),
      ...P.imgs
        .filter(
          (b) =>
            (b.x1 - b.x0) * (b.y1 - b.y0) < P.w * P.h * IMG_PAGE_FRACTION ||
            P.lines.length < 3
        )
        .map((b, n) => ({ k: 'img' as const, y: b.y1, b, n })),
      ...P.orns.map((b) => ({ k: 'orn' as const, y: b.y1 })),
    ].sort((a, b) => b.y - a.y);

    // Deteksi epigraf: gugus 1-3 baris tepat setelah judul bab
    if (filteredLines.some((l) => /^CHAPTER\s*(\d+|[IVXLCDM]+)$/i.test(l.text.trim()))) {
      let lastHead = -1;
      filteredLines.forEach((L, i) => {
        if (L.h >= SUBTITLE_SIZE) lastHead = i;
      });
      const cl: PageLine[] = [];
      for (let i = lastHead + 1; i < filteredLines.length; i++) {
        if (
          i === lastHead + 1 ||
          filteredLines[i - 1].y - filteredLines[i].y <= lead * EPIGRAF_LEAD_FACTOR
        )
          cl.push(filteredLines[i]);
        else break;
      }
      if (cl.length && cl.length <= 3 && lastHead + 1 + cl.length < filteredLines.length) {
        cl.forEach((L) => (L._epi = true));
      }
    }

    let buf: PageLine[] = [];
    let bufIndent = false;
    let bufPage = P.p;
    let prevL: PageLine | null = null;
    let firstOnPage = true;
    let headingBuf: PageLine[] | null = null;

    const flushPara = () => {
      if (!buf.length) return;
      const blk = pushPara(buf, bufPage, bufIndent);
      const centered = !!buf[0]._centered;
      if (centered) blk.t = 'quote';
      const joinPrev = !centered && !!(buf as PageLine[] & { _startJoin?: boolean })._startJoin;
      blk._joinPrev = joinPrev;

      if (joinPrev && pendingPara && pendingPara.t === 'p' && blk.t === 'p') {
        const prev = pendingPara;
        const lastRun = prev.runs![prev.runs!.length - 1];
        const hy =
          /\w-$/.test(lastRun.t.trim()) && /^[a-zà-ÿ]/.test(blk.text ?? '');
        lastRun.t = lastRun.t.replace(/\s+$/, '') + (hy ? '' : ' ');
        blk.runs!.forEach((r) => prev.runs!.push(r));
        prev.text = (prev.text ?? '') + ' ' + (blk.text ?? '');
        prev.joined = (prev.joined ?? 0) + 1;
      } else {
        flushBlock(blk);
      }
      buf = [];
    };

    const flushHeading = () => {
      if (!headingBuf) return;
      cur!.blocks.push({
        t: 'h',
        text: headingBuf.map((l) => l.text).join(' '),
        page: headingBuf[0] ? P.p : P.p,
      });
      pendingPara = null;
      headingBuf = null;
    };

    for (const f of flow) {
      if (f.k === 'orn') {
        flushHeading();
        flushPara();
        if (!(cur!._hdr && cur!.blocks.length === 0)) {
          cur!.blocks.push({ t: 'orn', page: P.p });
          pendingPara = null;
        }
        prevL = null;
        continue;
      }

      if (f.k === 'img') {
        flushHeading();
        flushPara();
        cur!.blocks.push({
          t: 'img',
          page: P.p,
          bbox: f.b,
          pageW: P.w,
          pageH: P.h,
          imgIdx: f.n,
        });
        pendingPara = null;
        prevL = null;
        continue;
      }

      const L = f.L;
      const t = L.text;
      const centered =
        L.x0 > left + CENTER_X_THRESHOLD &&
        Math.abs(L.x0 - left - (maxRight - L.x1)) < CENTER_SYMMETRY &&
        L.x1 < maxRight - 25;

      // Ornamen teks
      if (ORN_RE.test(t)) {
        flushHeading();
        flushPara();
        if (cur!._hdr && !cur!.blocks.length) cur!._orn = true;
        else cur!.blocks.push({ t: 'orn', page: P.p });
        pendingPara = null;
        prevL = null;
        firstOnPage = false;
        continue;
      }

      // PART
      if (/^PART\s*[IVX\d]+$/i.test(t.replace(/\s/g, '')) && L.h >= 20) {
        flushHeading();
        flushPara();
        newChapter('part', t.trim().replace(/\s+/g, ' '));
        cur!._hdr = true;
        pendingPara = null;
        firstOnPage = false;
        continue;
      }

      // CHAPTER N
      if (/^CHAPTER\s*(\d+|[IVXLCDM]+)$/i.test(t.trim())) {
        flushHeading();
        flushPara();
        newChapter('chapter', t.trim().replace(/\s+/g, ' '));
        pendingPara = null;
        firstOnPage = false;
        continue;
      }

      // Judul besar (bab / bagian / prolog)
      if (L.h >= CHAPTER_TITLE_SIZE && cur!._hdr && cur!.blocks.length === 0) {
        flushPara();
        cur!.title = (cur!.title + ' ' + t).trim();
        continue;
      }
      if (L.h >= CHAPTER_TITLE_SIZE && /^(Prologue|Prolog)$/i.test(t)) {
        cur!.title = t;
        continue;
      }

      // Subjudul tepat setelah judul bab
      if (
        cur!._hdr &&
        cur!.blocks.length === 0 &&
        L.h >= SUBTITLE_SIZE &&
        cur!.title &&
        !L.anyBold
      ) {
        cur!.subtitle = (cur!.subtitle + ' ' + t).trim();
        continue;
      }
      if (
        cur!._hdr &&
        cur!.blocks.length === 0 &&
        cur!.kind === 'part' &&
        L.h >= SUBTITLE_SIZE
      ) {
        cur!.subtitle = (cur!.subtitle + ' ' + t).trim();
        continue;
      }
      cur!._hdr = false;

      // Subjudul dalam bab
      const caps =
        /[A-ZÀ-Þ]{3}/.test(t) && t === t.toUpperCase() && t.length < 90;
      const isHeading =
        (L.h >= SUBHEAD_SIZE && L.anyBold) ||
        (L.h >= SUBHEAD_SIZE && caps) ||
        (caps && centered && L.h >= 10);

      if (isHeading) {
        flushPara();
        if (!headingBuf) headingBuf = [];
        headingBuf.push(L);
        prevL = null;
        firstOnPage = false;
        continue;
      } else if (headingBuf) {
        // Baris kurung subjudul: "(puncak ketika ...)" ikut judul
        if (/^\(.*\)$/.test(t) && L.h >= 15) {
          headingBuf.push(L);
          continue;
        }
        flushHeading();
      }

      // Kutipan tengah (baris terpusat berurutan)
      if ((centered || L._epi) && L.h < SUBHEAD_SIZE) {
        if (buf.length && !buf[0]._centered) flushPara();
        L._centered = true;
        if (!buf.length) bufPage = P.p;
        buf.push(L);
        prevL = L;
        firstOnPage = false;
        continue;
      }
      if (buf.length && buf[0]._centered) flushPara();

      // Paragraf biasa
      const indented = L.x0 > left + INDENT_THRESHOLD;
      let newPara = false;
      if (!prevL) {
        newPara = true;
      } else {
        const gap = prevL.y - L.y;
        const prevShort =
          prevL.x1 < maxRight - 0.22 * (maxRight - left) && endsSentence(prevL.text);
        if (indented || gap > lead * PARA_GAP_FACTOR || prevShort) newPara = true;
      }

      if (newPara) {
        flushPara();
        bufIndent = indented;
        bufPage = P.p;
        const cont =
          firstOnPage &&
          !indented &&
          pendingPara != null &&
          (pendingPara as InternalBlock).t === 'p' &&
          (!endsSentence((pendingPara as InternalBlock).text ?? '') || /^[a-zà-ÿ]/.test(t));
        (buf as PageLine[] & { _startJoin?: boolean })._startJoin = !!cont;
      }

      buf.push(L);
      prevL = L;
      firstOnPage = false;
    }

    flushHeading();
    flushPara();
  }

  // ---------- 4. Finalisasi & assign ID ----------
  const imgJobs: ImgJob[] = [];
  const finalChapters: Chapter[] = [];

  chapters
    .filter((c) => c.title || c.blocks.length)
    .forEach((c, ci) => {
      const chapterId = 'c' + ci;
      const finalBlocks: Block[] = [];

      c.blocks.forEach((b, bi) => {
        const blockId = `${ci}-${bi}`;

        if (b.t === 'img') {
          const imgKey = `img-${blockId}`;
          imgJobs.push({
            blockId,
            page: b.page,
            bbox: b.bbox!,
            pageW: b.pageW!,
            pageH: b.pageH!,
          });
          finalBlocks.push({
            id: blockId,
            type: 'img',
            page: b.page,
            imgKey,
          });
          return;
        }

        if (b.t === 'p' || b.t === 'quote') {
          // Bersihkan whitespace berlebih di runs
          const cleanRuns: Run[] = (b.runs ?? []).map((r) => ({
            t: r.t.replace(/\s+/g, ' '),
            f: r.f,
          }));
          if (cleanRuns.length) {
            cleanRuns[0].t = cleanRuns[0].t.replace(/^\s+/, '');
            cleanRuns[cleanRuns.length - 1].t = cleanRuns[
              cleanRuns.length - 1
            ].t.replace(/\s+$/, '');
          }
          finalBlocks.push({
            id: blockId,
            type: b.t,
            runs: cleanRuns,
            page: b.page,
          });
          return;
        }

        if (b.t === 'h') {
          finalBlocks.push({
            id: blockId,
            type: 'h',
            runs: [{ t: b.text ?? '', f: '' }],
            page: b.page,
          });
          return;
        }

        if (b.t === 'orn') {
          finalBlocks.push({ id: blockId, type: 'orn', page: b.page });
          return;
        }
      });

      finalChapters.push({
        id: chapterId,
        kind: c.kind,
        label: c.label,
        title: c.title,
        subtitle: c.subtitle,
        blocks: finalBlocks,
      });
    });

  const book: Book = {
    id: crypto.randomUUID(),
    title,
    author,
    parserVersion: PARSER_VERSION,
    pageCount: total,
    chapters: finalChapters,
  };

  return { book, imgJobs };
}

/** Hitung plain-text sebuah blok (untuk offset highlight) */
export function blockPlainText(block: Block): string {
  if (!block.runs) return '';
  return block.runs.map((r) => r.t).join('');
}

/** Hitung jumlah kata buku (untuk golden test) */
export function countWords(book: Book): number {
  let count = 0;
  for (const chapter of book.chapters) {
    for (const block of chapter.blocks) {
      if (block.type === 'p' || block.type === 'quote') {
        const text = blockPlainText(block);
        count += text.trim().split(/\s+/).filter(Boolean).length;
      }
    }
  }
  return count;
}
