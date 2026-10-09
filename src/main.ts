/**
 * Halaman Debug Tahap 1:
 * - Upload PDF di kiri
 * - Tampilkan teks hasil parser di kanan
 * - Statistik: jumlah kata, paragraf, sambungan, subjudul, gambar
 * - Tombol "Lihat halaman asli" (render canvas pdf.js)
 *
 * Ini bukan reader final — hanya untuk validasi golden test.
 */

import * as pdfjs from 'pdfjs-dist';
// @ts-ignore
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parsePdf, countWords } from './worker/parser';
import type { Book, Block } from './types/book';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const app = document.getElementById('app')!;
app.innerHTML = `
<div id="debug-app">
  <div id="debug-sidebar">
    <h1>🔍 Debug Parser</h1>
    <p style="color:#666;font-size:13px">Upload PDF untuk melihat hasil parsing</p>
    <label id="upload-label">
      <span>📄 Pilih PDF</span>
      <input type="file" id="pdf-input" accept=".pdf" />
    </label>
    <div id="stats" hidden>
      <h3>Statistik</h3>
      <div id="stats-content"></div>
    </div>
    <div id="progress-wrap" hidden>
      <div id="progress-bar-bg">
        <div id="progress-bar"></div>
      </div>
      <div id="progress-text">Memproses…</div>
    </div>
  </div>
  <div id="debug-main">
    <div id="debug-placeholder">
      <p>⬅ Upload PDF untuk memulai</p>
    </div>
    <div id="debug-output" hidden></div>
  </div>
</div>

<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #f0ede8; }

  #debug-app {
    display: flex;
    height: 100dvh;
  }

  #debug-sidebar {
    width: 260px;
    flex-shrink: 0;
    background: #fff;
    border-right: 1px solid #ddd;
    padding: 20px 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  #debug-sidebar h1 { font-size: 18px; }

  #upload-label {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #2563eb;
    color: #fff;
    border-radius: 8px;
    padding: 10px 14px;
    cursor: pointer;
    font-weight: 600;
    font-size: 14px;
  }
  #upload-label input { display: none; }

  #stats h3 { font-size: 14px; margin-bottom: 8px; color: #444; }
  #stats-content { font-size: 13px; line-height: 1.8; }
  .stat-row { display: flex; justify-content: space-between; }
  .stat-key { color: #666; }
  .stat-val { font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat-warn { color: #d97706; }
  .stat-ok { color: #16a34a; }

  #progress-wrap { display: flex; flex-direction: column; gap: 6px; }
  #progress-bar-bg {
    height: 6px;
    background: #e5e7eb;
    border-radius: 99px;
    overflow: hidden;
  }
  #progress-bar {
    height: 100%;
    width: 0%;
    background: #2563eb;
    transition: width 0.1s;
  }
  #progress-text { font-size: 12px; color: #666; }

  #debug-main {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  #debug-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #999;
    font-size: 18px;
  }

  #debug-output {
    max-width: 800px;
    margin: 0 auto;
  }

  .chapter-section {
    margin-bottom: 48px;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    overflow: hidden;
  }

  .chapter-header {
    background: #1e40af;
    color: #fff;
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 600;
  }

  .chapter-body {
    background: #fff;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .block-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .block-badge {
    flex-shrink: 0;
    width: 44px;
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    padding: 3px 6px;
    border-radius: 4px;
    font-family: monospace;
    margin-top: 2px;
  }
  .badge-p    { background: #e0f2fe; color: #0369a1; }
  .badge-quote { background: #fef3c7; color: #92400e; }
  .badge-h    { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
  .badge-img  { background: #fdf4ff; color: #7e22ce; }
  .badge-orn  { background: #f9fafb; color: #9ca3af; border: 1px solid #e5e7eb; }

  .block-text {
    flex: 1;
    font-size: 14px;
    line-height: 1.6;
    word-break: break-word;
  }
  .block-text em { font-style: italic; color: #6b7280; }
  .block-text strong { font-weight: 700; }

  .block-page {
    flex-shrink: 0;
    font-size: 11px;
    color: #9ca3af;
    margin-top: 4px;
    cursor: pointer;
    text-decoration: underline dotted;
    white-space: nowrap;
  }
  .block-page:hover { color: #2563eb; }

  .block-h .block-text {
    font-weight: 700;
    color: #1e40af;
    text-transform: uppercase;
    font-size: 12px;
    letter-spacing: 0.08em;
  }

  .block-quote .block-text {
    font-style: italic;
    color: #78716c;
    border-left: 3px solid #d97706;
    padding-left: 10px;
  }

  .block-img .block-text {
    color: #9ca3af;
    font-style: italic;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: #000a;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal-box {
    background: #fff;
    border-radius: 12px;
    padding: 16px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: auto;
    position: relative;
  }
  .modal-close {
    position: absolute;
    top: 8px;
    right: 8px;
    background: #f3f4f6;
    border: none;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    cursor: pointer;
    font-size: 16px;
  }
  .modal-canvas {
    display: block;
    max-width: 100%;
    height: auto;
  }
</style>
`;

let pdfBuffer: ArrayBuffer | null = null;
let currentPdf: pdfjs.PDFDocumentProxy | null = null;

const input = document.getElementById('pdf-input') as HTMLInputElement;
const progressWrap = document.getElementById('progress-wrap')!;
const progressBar = document.getElementById('progress-bar')!;
const progressText = document.getElementById('progress-text')!;
const statsEl = document.getElementById('stats')!;
const statsContent = document.getElementById('stats-content')!;
const placeholder = document.getElementById('debug-placeholder')!;
const output = document.getElementById('debug-output')!;

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;

  pdfBuffer = await file.arrayBuffer();
  currentPdf = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;

  // Reset UI
  output.hidden = true;
  placeholder.hidden = false;
  statsEl.hidden = true;
  progressWrap.hidden = false;
  progressBar.style.width = '0%';
  progressText.textContent = 'Memproses…';

  // Jalankan parser (langsung di main thread untuk debug — bukan worker)
  const title = file.name.replace('.pdf', '');
  let book: Book;

  try {
    const result = await parsePdf(
      pdfBuffer,
      title,
      '',
      (page, total) => {
        const pct = Math.round((page / total) * 100);
        progressBar.style.width = pct + '%';
        progressText.textContent = `Halaman ${page} / ${total}`;
      }
    );
    book = result.book;
  } catch (err) {
    progressText.textContent = '❌ Gagal: ' + String(err);
    return;
  }

  progressWrap.hidden = true;

  // Hitung statistik
  const allBlocks = book.chapters.flatMap((c) => c.blocks);
  const paraCount = allBlocks.filter((b) => b.type === 'p').length;
  const quoteCount = allBlocks.filter((b) => b.type === 'quote').length;
  const headCount = allBlocks.filter((b) => b.type === 'h').length;
  const imgCount = allBlocks.filter((b) => b.type === 'img').length;
  const ornCount = allBlocks.filter((b) => b.type === 'orn').length;
  const wordCount = countWords(book);

  statsContent.innerHTML = `
    <div class="stat-row"><span class="stat-key">Bab</span><span class="stat-val">${book.chapters.length}</span></div>
    <div class="stat-row"><span class="stat-key">Paragraf</span><span class="stat-val">${paraCount}</span></div>
    <div class="stat-row"><span class="stat-key">Kutipan</span><span class="stat-val">${quoteCount}</span></div>
    <div class="stat-row"><span class="stat-key">Subjudul</span><span class="stat-val">${headCount}</span></div>
    <div class="stat-row"><span class="stat-key">Gambar</span><span class="stat-val">${imgCount}</span></div>
    <div class="stat-row"><span class="stat-key">Ornamen</span><span class="stat-val">${ornCount}</span></div>
    <hr style="margin:8px 0;border-color:#eee">
    <div class="stat-row">
      <span class="stat-key">Jumlah kata</span>
      <span class="stat-val">${wordCount.toLocaleString('id')}</span>
    </div>
    <div class="stat-row"><span class="stat-key">Halaman</span><span class="stat-val">${book.pageCount}</span></div>
    <div class="stat-row"><span class="stat-key">Versi parser</span><span class="stat-val">${book.parserVersion}</span></div>
  `;
  statsEl.hidden = false;

  // Render output
  renderOutput(book);

  placeholder.hidden = true;
  output.hidden = false;
});

function renderOutput(book: Book) {
  const html = book.chapters
    .map((ch) => {
      const headerLabel = ch.label ? `<span style="opacity:.7">${ch.label} · </span>` : '';
      const blocks = ch.blocks.map((b) => renderBlock(b)).join('');
      return `
        <div class="chapter-section">
          <div class="chapter-header">${headerLabel}${ch.title || '(tanpa judul)'}</div>
          <div class="chapter-body">${blocks}</div>
        </div>
      `;
    })
    .join('');
  output.innerHTML = html;
}

function renderBlock(b: Block): string {
  const pageBtn = `<span class="block-page" data-page="${b.page}" title="Lihat halaman asli ${b.page}">hal. ${b.page}</span>`;

  if (b.type === 'p' || b.type === 'quote') {
    const textHtml = (b.runs ?? [])
      .map((r) => {
        let t = esc(r.t);
        if (r.f.includes('i')) t = `<em>${t}</em>`;
        if (r.f.includes('b')) t = `<strong>${t}</strong>`;
        return t;
      })
      .join('');
    const cls = b.type === 'quote' ? 'block-quote' : '';
    const badge = b.type === 'quote' ? 'badge-quote' : 'badge-p';
    return `<div class="block-row ${cls}">
      <span class="block-badge ${badge}">${b.type.toUpperCase()}</span>
      <div class="block-text">${textHtml}</div>
      ${pageBtn}
    </div>`;
  }

  if (b.type === 'h') {
    const text = esc((b.runs ?? []).map((r) => r.t).join(''));
    return `<div class="block-row block-h">
      <span class="block-badge badge-h">H</span>
      <div class="block-text">${text}</div>
      ${pageBtn}
    </div>`;
  }

  if (b.type === 'img') {
    return `<div class="block-row block-img">
      <span class="block-badge badge-img">IMG</span>
      <div class="block-text">🖼 Gambar dari halaman ${b.page}</div>
      ${pageBtn}
    </div>`;
  }

  if (b.type === 'orn') {
    return `<div class="block-row">
      <span class="block-badge badge-orn">ORN</span>
      <div class="block-text" style="color:#9ca3af">◆ ◆ ◆</div>
      ${pageBtn}
    </div>`;
  }

  return '';
}

// Modal "Lihat halaman asli"
output.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest('[data-page]') as HTMLElement | null;
  if (!btn || !currentPdf) return;

  const pageNum = parseInt(btn.dataset.page!, 10);
  if (isNaN(pageNum)) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <button class="modal-close" title="Tutup">✕</button>
      <p style="margin-bottom:8px;font-size:13px;color:#666">Halaman asli ${pageNum} dari PDF</p>
      <canvas class="modal-canvas" id="modal-canvas"></canvas>
    </div>
  `;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector('#modal-canvas') as HTMLCanvasElement;
  const page = await currentPdf.getPage(pageNum);
  const vp = page.getViewport({ scale: 1.5 });
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay || (ev.target as HTMLElement).className === 'modal-close') {
      overlay.remove();
    }
  });
});

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
