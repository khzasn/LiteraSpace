import { useEffect, useRef, useState } from 'preact/hooks';
import type { Book, Block, Highlight, HighlightSegment, Chapter } from '../types/book';
import { getBlob, getHighlightsByBook, saveHighlight, deleteHighlight } from '../lib/db';
import { imageBlobKey } from '../lib/keys';
import { settings } from '../lib/settings';
import { getSelectionSegments, renderHighlights } from '../lib/highlighter';
import * as pdfjs from 'pdfjs-dist';
// @ts-ignore
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// ─── Warna highlight ───
const HL_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;
type HlColor = typeof HL_COLORS[number];
const COLOR_HEX: Record<HlColor, string> = {
  yellow: '#fde047', green: '#86efac', blue: '#93c5fd', pink: '#f9a8d4', purple: '#d8b4fe'
};

// ─── Reader utama ───

export function Reader({ book, onBack }: { book: Book; onBack: () => void }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showHlDrawer, setShowHlDrawer] = useState(false);
  const [showTocDrawer, setShowTocDrawer] = useState(false);
  const [currentChapterLabel, setCurrentChapterLabel] = useState<string>('');
  const [originalPage, setOriginalPage] = useState<number | null>(null);

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [activeSelection, setActiveSelection] = useState<{ segments: HighlightSegment[]; text: string } | null>(null);
  const [activeHlId, setActiveHlId] = useState<string | null>(null);

  // Muat highlights dari DB
  useEffect(() => {
    getHighlightsByBook(book.id).then(setHighlights);
  }, [book.id]);

  // Re-render highlight jika data atau pengaturan berubah
  useEffect(() => {
    if (contentRef.current) renderHighlights(contentRef.current, highlights);
  }, [highlights, settings.value.fontSize, settings.value.fontFamily]);

  // Build DOM buku + pasang event listener
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // Render buku ke DOM (vanilla)
    container.innerHTML = '';
    container.dataset.bookId = book.id;
    buildBookDOM(container, book);

    // Pasang highlight awal
    renderHighlights(container, highlights);

    // Pulihkan posisi baca
    requestAnimationFrame(() => {
      const posStr = localStorage.getItem(`pos_${book.id}`);
      if (posStr) {
        try {
          const posObj = JSON.parse(posStr);
          if (posObj.chapterLabel) {
            setCurrentChapterLabel(posObj.chapterLabel);
          }
          const { blockId, fraction } = posObj;
          const el = container.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement;
          if (el) {
            const top = el.getBoundingClientRect().top + window.scrollY;
            const toolbarH = 56;
            window.scrollTo({ top: top + el.offsetHeight * fraction - toolbarH, behavior: 'instant' });
          }
        } catch {}
      }
    });

    // Tracking scroll untuk simpan posisi (debounced 600ms)
    let scrollTid: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(scrollTid);
      scrollTid = setTimeout(() => {
        saveReadPosition(container, book, (lbl) => setCurrentChapterLabel(lbl));
      }, 600);
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Klik tombol halaman asli
    const onContainerClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.block-page-btn');
      if (btn) {
        e.stopPropagation();
        const p = parseInt((btn as HTMLElement).dataset.page || '1', 10);
        setOriginalPage(p);
        return;
      }
      const mark = (e.target as HTMLElement).closest('mark[data-hl]');
      if (mark) {
        e.stopPropagation();
        setActiveHlId((mark as HTMLElement).dataset.hl || null);
        return;
      }
    };
    container.addEventListener('click', onContainerClick);

    // Seleksi teks
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
        setActiveSelection(null);
        return;
      }
      const segs = getSelectionSegments(sel);
      if (segs) setActiveSelection({ segments: segs, text: sel.toString() });
      else setActiveSelection(null);
    };
    document.addEventListener('selectionchange', onSelectionChange);

    return () => {
      window.removeEventListener('scroll', onScroll);
      container.removeEventListener('click', onContainerClick);
      document.removeEventListener('selectionchange', onSelectionChange);
      clearTimeout(scrollTid);
    };
  }, [book]);

  // Toggle toolbar saat klik area buku (bukan tombol/link/mark)
  function handlePageClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('button') || t.closest('a') || t.closest('mark') || t.closest('.block-page-btn')) return;
    if (window.getSelection()?.toString()) return;
    setShowToolbar(v => !v);
    setShowSettings(false);
  }

  // ─── Highlight actions ───
  async function createHighlight(color: HlColor) {
    if (!activeSelection) return;
    const hl: Highlight = {
      id: crypto.randomUUID(),
      bookId: book.id,
      groupSegments: activeSelection.segments,
      text: activeSelection.text,
      prefix: '',
      suffix: '',
      color,
      parserVersion: book.parserVersion,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveHighlight(hl);
    setHighlights(prev => [...prev, hl]);
    setActiveSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  async function updateHighlightColor(id: string, color: string) {
    const hl = highlights.find(h => h.id === id);
    if (!hl) return;
    const updated = { ...hl, color, updatedAt: Date.now() };
    await saveHighlight(updated);
    setHighlights(prev => prev.map(h => h.id === id ? updated : h));
    setActiveHlId(null);
  }

  async function saveNote(id: string, note: string) {
    const hl = highlights.find(h => h.id === id);
    if (!hl) return;
    const updated = { ...hl, note, updatedAt: Date.now() };
    await saveHighlight(updated);
    setHighlights(prev => prev.map(h => h.id === id ? updated : h));
  }

  async function removeHighlight(id: string) {
    await deleteHighlight(id);
    setHighlights(prev => prev.filter(h => h.id !== id));
    setActiveHlId(null);
  }

  function exportMarkdown() {
    let md = `# Kutipan — ${book.title}\n\n`;
    [...highlights].sort((a, b) => a.createdAt - b.createdAt).forEach(hl => {
      const ci = parseInt(hl.groupSegments[0]?.blockId.split('-')[0] || '0', 10);
      const ch = book.chapters[ci];
      const chLabel = ch ? (ch.label ? `${ch.label}${ch.title ? ' — ' + ch.title : ''}` : ch.title || '') : '';

      md += `> ${hl.text}\n\n`;
      if (chLabel) {
        md += `— ${chLabel}\n\n`;
      }
      if (hl.note) {
        md += `**Catatan:** ${hl.note}\n\n`;
      }
      md += `---\n\n`;
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.title} - Kutipan.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const activeHl = highlights.find(h => h.id === activeHlId);

  return (
    <div class="reader-page" onClick={handlePageClick}>
      {/* Toolbar atas */}
      <div class={`reader-toolbar${showToolbar ? '' : ' hidden'}`} onClick={e => e.stopPropagation()}>
        <button class="btn btn-sm" onClick={onBack}>← Kembali</button>
        <span class="toolbar-title" title={currentChapterLabel ? `${currentChapterLabel} — ${book.title}` : book.title}>
          {currentChapterLabel || book.title}
        </span>
        <div class="toolbar-actions">
          <button class="btn btn-sm" onClick={() => { setShowTocDrawer(true); setShowHlDrawer(false); setShowSettings(false); }}>Daftar Isi</button>
          <button class="btn btn-sm" onClick={() => { setShowHlDrawer(true); setShowTocDrawer(false); setShowSettings(false); }}>Penanda</button>
          <button class="btn btn-sm" onClick={() => { setShowSettings(v => !v); setShowHlDrawer(false); setShowTocDrawer(false); }}>Aa</button>
        </div>
      </div>

      {/* Isi buku */}
      <div class="reader-content" ref={contentRef} />

      {/* Overlay untuk menutup panel */}
      {(showSettings || showHlDrawer || showTocDrawer) && (
        <div class="overlay-backdrop" onClick={() => { setShowSettings(false); setShowHlDrawer(false); setShowTocDrawer(false); }} />
      )}

      {/* Panel pengaturan */}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {/* Drawer Daftar Isi */}
      {showTocDrawer && (
        <TocDrawer
          chapters={book.chapters}
          onClose={() => setShowTocDrawer(false)}
          onSelectChapter={(chapId) => {
            setShowTocDrawer(false);
            const el = document.getElementById(`chap-${chapId}`);
            if (el) {
              const top = el.getBoundingClientRect().top + window.scrollY - 60;
              window.scrollTo({ top, behavior: 'smooth' });
            }
          }}
        />
      )}

      {/* Drawer highlight */}
      {showHlDrawer && (
        <HighlightsDrawer
          highlights={highlights}
          book={book}
          contentRef={contentRef}
          onClose={() => setShowHlDrawer(false)}
          onExportMd={exportMarkdown}
          onSaveNote={saveNote}
          onDelete={removeHighlight}
        />
      )}

      {/* Modal PDF asli */}
      {originalPage != null && (
        <PdfModal bookId={book.id} pageNum={originalPage} onClose={() => setOriginalPage(null)} />
      )}

      {/* Bar aksi seleksi baru */}
      {activeSelection && !activeHlId && (
        <HighlightBar
          onColor={createHighlight}
          onCancel={() => { window.getSelection()?.removeAllRanges(); setActiveSelection(null); }}
        />
      )}

      {/* Bar aksi edit highlight */}
      {activeHlId && activeHl && (
        <HighlightBar
          isEdit
          currentColor={activeHl.color as HlColor}
          onColor={c => updateHighlightColor(activeHlId, c)}
          onDelete={() => removeHighlight(activeHlId)}
          onCancel={() => setActiveHlId(null)}
        />
      )}
    </div>
  );
}

// ─── Build DOM buku ───

function buildBookDOM(container: HTMLElement, book: Book) {
  book.chapters.forEach(chapter => {
    const chapEl = document.createElement('div');
    chapEl.className = 'book-chapter';
    chapEl.id = `chap-${chapter.id}`;

    if (chapter.label) {
      const el = document.createElement('div');
      el.className = 'book-h level-bab';
      el.textContent = chapter.label;
      chapEl.appendChild(el);
    }
    if (chapter.title) {
      const el = document.createElement('h2');
      el.className = 'book-h level-judul';
      el.textContent = chapter.title;
      chapEl.appendChild(el);
    }
    if (chapter.subtitle) {
      const el = document.createElement('h3');
      el.className = 'book-h level-sub';
      el.textContent = chapter.subtitle;
      chapEl.appendChild(el);
    }

    chapter.blocks.forEach(block => {
      chapEl.appendChild(createBlockEl(book.id, block));
    });

    container.appendChild(chapEl);
  });
}

function createBlockEl(bookId: string, block: Block): HTMLElement {
  if (block.type === 'img') {
    const wrap = document.createElement('div');
    wrap.className = 'book-block book-img-container';
    wrap.dataset.blockId = block.id;
    const img = document.createElement('img');
    img.className = 'book-img';
    img.alt = '';
    if (block.imgW) img.width = block.imgW;
    if (block.imgH) img.height = block.imgH;
    wrap.appendChild(img);
    getBlob(imageBlobKey(bookId, block.id)).then(blob => {
      if (blob) img.src = URL.createObjectURL(blob);
    });
    return wrap;
  }

  if (block.type === 'orn') {
    const el = document.createElement('div');
    el.className = 'book-block book-orn';
    el.dataset.blockId = block.id;
    return el;
  }

  const tag = block.type === 'h' ? 'h3' : 'p';
  const el = document.createElement(tag);
  el.className = `book-block book-${block.type}${block.type === 'h' ? ' level-sub' : ''}`;
  el.dataset.blockId = block.id;

  // Tombol lihat halaman asli
  const pageBtn = document.createElement('button');
  pageBtn.className = 'block-page-btn';
  pageBtn.textContent = String(block.page);
  pageBtn.dataset.page = String(block.page);
  pageBtn.title = `Halaman PDF asli: ${block.page}`;
  el.appendChild(pageBtn);

  // Isi teks (dengan format italic/bold)
  if (block.runs) {
    block.runs.forEach(run => {
      if (!run.f) {
        el.appendChild(document.createTextNode(run.t));
      } else {
        const span = document.createElement('span');
        span.className = run.f;
        span.textContent = run.t;
        el.appendChild(span);
      }
    });
  }

  return el;
}

function saveReadPosition(
  container: HTMLElement,
  book: Book,
  onChapterChange?: (label: string) => void
) {
  const blocks = container.querySelectorAll('.book-block');
  const viewTop = window.scrollY;
  const viewH = window.innerHeight;

  for (const block of Array.from(blocks)) {
    const el = block as HTMLElement;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const bottom = top + el.offsetHeight;
    if (bottom > viewTop && top < viewTop + viewH) {
      const blockId = el.dataset.blockId;
      const fraction = Math.max(0, (viewTop - top) / Math.max(1, el.offsetHeight));

      let idx = 0, total = 0, found = false;
      for (const c of book.chapters) {
        for (const b of c.blocks) {
          if (!found) idx++;
          if (b.id === blockId) found = true;
          total++;
        }
      }
      const percent = total > 0 ? Math.round((idx / total) * 100) : 0;
      const ci = parseInt(blockId?.split('-')[0] || '0', 10);
      const curChapter = book.chapters[ci];
      const chapterLabel = curChapter
        ? curChapter.label
          ? `${curChapter.label}${curChapter.title ? ' · ' + curChapter.title : ''}`
          : curChapter.title || (curChapter.kind === 'prologue' ? 'Prolog' : '')
        : '';

      localStorage.setItem(
        `pos_${book.id}`,
        JSON.stringify({ blockId, fraction, percent, chapterLabel })
      );
      if (onChapterChange) onChapterChange(chapterLabel);
      break;
    }
  }
}

// ─── Komponen: Bar aksi highlight ───

function HighlightBar({
  onColor, onCancel, onDelete, isEdit, currentColor
}: {
  onColor: (c: HlColor) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isEdit?: boolean;
  currentColor?: HlColor;
}) {
  return (
    <div class="hl-bar" onClick={e => e.stopPropagation()}>
      {HL_COLORS.map(c => (
        <button
          key={c}
          class={`color-dot dot-${c}${currentColor === c ? ' active' : ''}`}
          onClick={() => onColor(c)}
          title={c}
        />
      ))}
      <div class="hl-sep" />
      {isEdit && onDelete && (
        <button class="btn btn-sm btn-danger" style={{ border: 'none', padding: '4px 8px' }} onClick={onDelete}>Hapus</button>
      )}
      <button class="btn btn-sm btn-icon" style={{ border: 'none' }} onClick={onCancel}>✕</button>
    </div>
  );
}

// ─── Komponen: Panel pengaturan ───

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = settings.value;

  return (
    <div class="settings-panel" onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontWeight: 600 }}>Pengaturan Baca</span>
        <button class="btn btn-icon" style={{ border: 'none' }} onClick={onClose}>✕</button>
      </div>

      <div class="settings-section">
        <span class="settings-label">Tema</span>
        <div class="settings-row">
          {['light', 'sepia', 'warm', 'dark'].map(t => (
            <button key={t} class={`theme-btn${s.theme === t ? ' active' : ''}`}
              onClick={() => settings.value = { ...s, theme: t as any }}>
              {t === 'light' ? 'Terang' : t === 'sepia' ? 'Sepia' : t === 'warm' ? 'Hangat' : 'Gelap'}
            </button>
          ))}
        </div>
      </div>

      <div class="settings-section">
        <span class="settings-label">Font</span>
        <select
          value={s.fontFamily}
          onChange={e => settings.value = { ...s, fontFamily: (e.target as HTMLSelectElement).value as any }}
          style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', fontSize: '0.9rem', fontFamily: 'inherit' }}
        >
          {['Literata', 'Lora', 'Merriweather', 'Inter', 'Lexend', 'OpenDyslexic'].map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <div class="settings-section">
        <span class="settings-label">Ukuran Teks</span>
        <div class="range-row">
          <span style={{ fontSize: '0.8rem', color: 'var(--secondary-text)' }}>A</span>
          <input type="range" min={14} max={32} step={1} value={s.fontSize}
            onChange={e => settings.value = { ...s, fontSize: Number((e.target as HTMLInputElement).value) }} />
          <span style={{ fontSize: '1.1rem' }}>A</span>
          <span class="range-val">{s.fontSize}px</span>
        </div>
      </div>

      <div class="settings-section">
        <span class="settings-label">Jarak Baris</span>
        <div class="range-row">
          <input type="range" min={1.2} max={2.5} step={0.05} value={s.lineHeight}
            onChange={e => settings.value = { ...s, lineHeight: Number((e.target as HTMLInputElement).value) }} />
          <span class="range-val">{s.lineHeight.toFixed(1)}</span>
        </div>
      </div>

      <div class="settings-section">
        <span class="settings-label">Tata Letak</span>
        <div class="toggle-row">
          <label>Teks rata kanan-kiri</label>
          <input type="checkbox" checked={s.alignment === 'justify'}
            onChange={e => settings.value = { ...s, alignment: (e.target as HTMLInputElement).checked ? 'justify' : 'left' }} />
        </div>
        <div class="toggle-row">
          <label>Paragraf menjorok</label>
          <input type="checkbox" checked={s.indent}
            onChange={e => settings.value = { ...s, indent: (e.target as HTMLInputElement).checked }} />
        </div>
        <div class="toggle-row">
          <label>Drop cap</label>
          <input type="checkbox" checked={s.dropCap}
            onChange={e => settings.value = { ...s, dropCap: (e.target as HTMLInputElement).checked }} />
        </div>
      </div>
    </div>
  );
}

// ─── Komponen: Drawer Highlights ───

function HighlightsDrawer({
  highlights, book, contentRef, onClose, onExportMd, onSaveNote, onDelete
}: {
  highlights: Highlight[];
  book: Book;
  contentRef: { current: HTMLDivElement | null };
  onClose: () => void;
  onExportMd: () => void;
  onSaveNote: (id: string, note: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');

  const sorted = [...highlights].sort((a, b) => b.createdAt - a.createdAt);

  function jumpTo(hl: Highlight) {
    onClose();
    const blockId = hl.groupSegments[0]?.blockId;
    if (!blockId || !contentRef.current) return;
    const el = contentRef.current.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement;
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top, behavior: 'smooth' });
      el.style.outline = '2px solid var(--link-color)';
      setTimeout(() => { el.style.outline = ''; }, 2000);
    }
  }

  return (
    <div class="hl-drawer" onClick={e => e.stopPropagation()}>
      <div class="hl-drawer-header">
        <span style={{ fontWeight: 600 }}>Penanda ({highlights.length})</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {highlights.length > 0 && (
            <button class="btn btn-sm" onClick={onExportMd}>↓ .md</button>
          )}
          <button class="btn btn-sm btn-icon" style={{ border: 'none' }} onClick={onClose}>✕</button>
        </div>
      </div>
      <div class="hl-drawer-body">
        {sorted.length === 0 ? (
          <div class="empty-state">
            <div class="icon">🖍️</div>
            <p>Belum ada penanda.</p>
            <p>Pilih teks saat membaca untuk menandainya.</p>
          </div>
        ) : sorted.map(hl => {
          const ci = parseInt(hl.groupSegments[0]?.blockId.split('-')[0] || '0', 10);
          const ch = book.chapters[ci];
          const chLabel = ch ? (ch.label ? `${ch.label}${ch.title ? ' · ' + ch.title : ''}` : ch.title || '') : '';

          return (
            <div class="hl-card" key={hl.id} onClick={() => jumpTo(hl)}>
              <div class="hl-card-meta">
                <div class="hl-color-dot" style={{ background: COLOR_HEX[hl.color as HlColor] || '#ccc' }} />
                {chLabel && (
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--secondary-text)' }}>
                    {chLabel}
                  </span>
                )}
                <span class="hl-date" style={{ marginLeft: 'auto' }}>
                  {new Date(hl.createdAt).toLocaleDateString('id-ID')}
                </span>
              </div>
              <div class="hl-card-text">"{hl.text}"</div>
              {hl.note && editNoteId !== hl.id && (
                <div class="hl-card-note">📝 {hl.note}</div>
              )}
              {editNoteId === hl.id && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }} onClick={e => e.stopPropagation()}>
                  <input
                    type="text"
                    value={noteText}
                    onInput={e => setNoteText((e.target as HTMLInputElement).value)}
                    placeholder="Tulis catatan..."
                    style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', fontSize: '0.85rem', fontFamily: 'inherit' }}
                    onKeyDown={e => { if (e.key === 'Enter') { onSaveNote(hl.id, noteText); setEditNoteId(null); } }}
                  />
                  <button class="btn btn-sm btn-primary" onClick={() => { onSaveNote(hl.id, noteText); setEditNoteId(null); }}>Simpan</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                <button class="btn btn-sm" onClick={() => { setEditNoteId(hl.id); setNoteText(hl.note || ''); }}>
                  {hl.note ? '✏️ Edit catatan' : '📝 Tambah catatan'}
                </button>
                <button class="btn btn-sm btn-danger" onClick={() => onDelete(hl.id)}>Hapus</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Komponen: Drawer Daftar Isi ───

function TocDrawer({
  chapters,
  onClose,
  onSelectChapter,
}: {
  chapters: Chapter[];
  onClose: () => void;
  onSelectChapter: (chapterId: string) => void;
}) {
  return (
    <div class="hl-drawer" onClick={(e) => e.stopPropagation()}>
      <div class="hl-drawer-header">
        <span style={{ fontWeight: 600 }}>Daftar Isi</span>
        <button class="btn btn-sm btn-icon" style={{ border: 'none' }} onClick={onClose}>✕</button>
      </div>
      <div class="hl-drawer-body">
        {chapters.map((ch) => {
          const displayLabel = ch.label || '';
          const displayTitle = ch.title || (ch.kind === 'prologue' ? 'Prolog' : '');
          return (
            <div
              key={ch.id}
              class="hl-card"
              onClick={() => onSelectChapter(ch.id)}
              style={{ cursor: 'pointer' }}
            >
              {displayLabel && (
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--secondary-text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {displayLabel}
                </div>
              )}
              {displayTitle && (
                <div style={{ fontSize: '0.95rem', fontWeight: 500, marginTop: displayLabel ? 2 : 0 }}>
                  {displayTitle}
                </div>
              )}
              {ch.subtitle && (
                <div style={{ fontSize: '0.8rem', color: 'var(--secondary-text)', marginTop: 2, fontStyle: 'italic' }}>
                  {ch.subtitle}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Komponen: Modal PDF asli ───

function PdfModal({ bookId, pageNum, onClose }: { bookId: string; pageNum: number; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let task: any;
    (async () => {
      try {
        const blob = await getBlob(`pdf_${bookId}`);
        if (!blob) return;
        const buf = await blob.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
        const page = await pdf.getPage(pageNum);
        const scale = Math.min(2, (window.innerWidth - 40) / page.getViewport({ scale: 1 }).width);
        const vp = page.getViewport({ scale });
        const canvas = canvasRef.current!;
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d')!;
        task = page.render({ canvasContext: ctx, viewport: vp } as any);
        await task.promise;
      } catch (e) { console.error('PDF render error:', e); }
    })();
    return () => { if (task) task.cancel(); };
  }, [bookId, pageNum]);

  return (
    <div class="pdf-modal" onClick={onClose}>
      <div class="pdf-modal-bar">
        <span>Halaman PDF Asli #{pageNum}</span>
        <button style={{ color: '#fff', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }} onClick={onClose}>✕</button>
      </div>
      <div class="pdf-modal-body" onClick={e => e.stopPropagation()}>
        <canvas ref={canvasRef} style={{ maxWidth: '100%', background: '#fff', display: 'block' }} />
      </div>
    </div>
  );
}
