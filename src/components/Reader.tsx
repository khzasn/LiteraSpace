import { useEffect, useRef, useState } from 'preact/hooks';
import type { Book, Block } from '../types/book';
import { getBlob } from '../lib/db';
import { settings } from '../lib/settings';

export function Reader({ book, onBack }: { book: Book; onBack: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [originalPage, setOriginalPage] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    
    // Event delegation untuk tombol "Lihat Halaman Asli"
    const onBlockClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('block-action-btn')) {
        e.stopPropagation();
        const p = parseInt(target.dataset.page || '1', 10);
        setOriginalPage(p);
      }
    };
    container.addEventListener('click', onBlockClick);

    // Cegah render ulang jika buku sama sudah dirender
    if (container.dataset.bookId === book.id) {
      return () => container.removeEventListener('click', onBlockClick);
    }
    
    container.innerHTML = '';
    container.dataset.bookId = book.id;

    // Render per bab
    book.chapters.forEach(chapter => {
      const chapEl = document.createElement('div');
      chapEl.className = 'book-chapter';
      chapEl.id = `chap-${chapter.id}`;
      
      // Render judul bab
      if (chapter.label) {
        const lbl = document.createElement('h2');
        lbl.className = 'book-h level-bab';
        lbl.textContent = chapter.label;
        chapEl.appendChild(lbl);
      }
      if (chapter.title) {
        const title = document.createElement('h2');
        title.className = 'book-h level-judul';
        title.textContent = chapter.title;
        chapEl.appendChild(title);
      }
      if (chapter.subtitle) {
        const sub = document.createElement('h3');
        sub.className = 'book-h level-sub';
        sub.textContent = chapter.subtitle;
        chapEl.appendChild(sub);
      }
      
      chapter.blocks.forEach(block => {
        const blockEl = createBlockElement(book.id, block);
        chapEl.appendChild(blockEl);
      });
      
      container.appendChild(chapEl);
    });

    // Pulihkan posisi baca sebelumnya
    const restorePos = () => {
      const posStr = localStorage.getItem(`pos_${book.id}`);
      if (!posStr) return;
      try {
        const { blockId, fraction } = JSON.parse(posStr);
        const el = container.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement;
        if (el) {
          // Hitung posisi gulir absolut
          const top = el.offsetTop + (el.offsetHeight * fraction);
          container.scrollTop = top - 40; // Kurangi sedikit padding atas
        }
      } catch (e) {}
    };
    
    // Panggil setelah DOM ter-render
    setTimeout(restorePos, 100);

    // Lacak dan simpan posisi baca saat menggulir (di-debounce 500ms)
    let scrollTimeout: any;
    const onScroll = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const rect = container.getBoundingClientRect();
        const blocks = container.querySelectorAll('.book-block');
        
        for (let i = 0; i < blocks.length; i++) {
          const bRect = blocks[i].getBoundingClientRect();
          // Cari blok pertama yang bersinggungan dengan viewport atas
          if (bRect.bottom > rect.top && bRect.top < rect.bottom) {
             const blockId = (blocks[i] as HTMLElement).dataset.blockId;
             // Fraksi = seberapa jauh kita menscroll melewati bagian atas blok tersebut
             let fraction = 0;
             if (bRect.top < rect.top) {
               fraction = (rect.top - bRect.top) / bRect.height;
             }
             localStorage.setItem(`pos_${book.id}`, JSON.stringify({ blockId, fraction }));
             break;
          }
        }
      }, 500);
    };
    container.addEventListener('scroll', onScroll);

    return () => {
      container.removeEventListener('click', onBlockClick);
      container.removeEventListener('scroll', onScroll);
    };
  }, [book]);

  function handleCenterClick(e: MouseEvent) {
    // Jika user menyeleksi teks, jangan toggle toolbar
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    
    // Cek apakah klik terjadi di margin/tengah (bukan di link atau tombol)
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a')) return;
    
    setShowToolbar(prev => !prev);
    setShowSettings(false); // Tutup drawer bila toolbar di-toggle
  }

  return (
    <div 
      style={{ position: 'relative', width: '100%', height: '100dvh', overflowY: 'auto' }} 
      onClick={handleCenterClick}
    >
      {/* Kontainer Utama Buku (Vanilla DOM) */}
      <div className="reader-container" ref={containerRef} />
      
      {/* Top Toolbar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, 
        padding: 'calc(15px + var(--safe-top)) 15px 15px 15px', 
        background: 'var(--toolbar-bg)',
        borderBottom: '1px solid var(--border-color)',
        display: showToolbar ? 'flex' : 'none',
        justifyContent: 'space-between',
        transition: 'opacity 0.3s',
        zIndex: 100
      }}>
        <button onClick={(e) => { e.stopPropagation(); onBack(); }} style={btnStyle}>← Kembali</button>
        <div>
          <button style={{ ...btnStyle, marginRight: 10 }}>Daftar Isi</button>
          <button onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }} style={btnStyle}>Aa</button>
        </div>
      </div>

      {/* Settings Drawer (Sederhana untuk sekarang) */}
      {showSettings && (
        <div style={{
          position: 'fixed', top: '70px', right: '15px',
          background: 'var(--toolbar-bg)',
          border: '1px solid var(--border-color)',
          padding: '15px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          zIndex: 101
        }} onClick={e => e.stopPropagation()}>
          <h4 style={{ marginBottom: 10 }}>Tema</h4>
          <div style={{ display: 'flex', gap: 10, marginBottom: 15, flexWrap: 'wrap' }}>
            {['light', 'sepia', 'warm', 'dark'].map(t => (
              <button 
                key={t}
                onClick={() => settings.value = { ...settings.value, theme: t as any }}
                style={{
                  ...btnStyle,
                  background: settings.value.theme === t ? 'var(--text-color)' : 'transparent',
                  color: settings.value.theme === t ? 'var(--bg-color)' : 'var(--text-color)',
                  textTransform: 'capitalize'
                }}
              >
                {t}
              </button>
            ))}
          </div>
          
          <h4 style={{ marginBottom: 10 }}>Ukuran Teks: {settings.value.fontSize}px</h4>
          <input 
            type="range" min="14" max="32" step="1" 
            value={settings.value.fontSize}
            onChange={(e) => settings.value = { ...settings.value, fontSize: Number((e.target as HTMLInputElement).value) }}
            style={{ width: '100%', marginBottom: 15 }}
          />

          <h4 style={{ marginBottom: 10 }}>Font</h4>
          <select 
            value={settings.value.fontFamily}
            onChange={(e) => settings.value = { ...settings.value, fontFamily: (e.target as HTMLSelectElement).value as any }}
            style={{ width: '100%', padding: '8px', marginBottom: 15, background: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)' }}
          >
            {['Literata', 'Lora', 'Merriweather', 'Inter', 'Lexend', 'OpenDyslexic'].map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          <h4 style={{ marginBottom: 10 }}>Jarak Baris: {settings.value.lineHeight}</h4>
          <input 
            type="range" min="1.2" max="2.5" step="0.1" 
            value={settings.value.lineHeight}
            onChange={(e) => settings.value = { ...settings.value, lineHeight: Number((e.target as HTMLInputElement).value) }}
            style={{ width: '100%', marginBottom: 15 }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={settings.value.indent} onChange={e => settings.value = { ...settings.value, indent: (e.target as HTMLInputElement).checked }} />
              Menjorok
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={settings.value.dropCap} onChange={e => settings.value = { ...settings.value, dropCap: (e.target as HTMLInputElement).checked }} />
              Drop Cap
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
            <button 
              onClick={() => settings.value = { ...settings.value, alignment: 'left' }}
              style={{ ...btnStyle, flex: 1, background: settings.value.alignment === 'left' ? 'var(--text-color)' : 'transparent', color: settings.value.alignment === 'left' ? 'var(--bg-color)' : 'var(--text-color)' }}
            >Rata Kiri</button>
            <button 
              onClick={() => settings.value = { ...settings.value, alignment: 'justify' }}
              style={{ ...btnStyle, flex: 1, background: settings.value.alignment === 'justify' ? 'var(--text-color)' : 'transparent', color: settings.value.alignment === 'justify' ? 'var(--bg-color)' : 'var(--text-color)' }}
            >Kanan Kiri</button>
          </div>
        </div>
      )}
      {/* Modal Halaman Asli */}
      {originalPage && (
        <PdfModal bookId={book.id} pageNum={originalPage} onClose={() => setOriginalPage(null)} />
      )}
    </div>
  );
}

const btnStyle = {
  padding: '6px 12px',
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-color)',
  cursor: 'pointer',
  fontSize: '14px'
};

import * as pdfjs from 'pdfjs-dist';
// @ts-ignore
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

function PdfModal({ bookId, pageNum, onClose }: { bookId: string; pageNum: number; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let renderTask: any;
    (async () => {
      try {
        const blob = await getBlob(`pdf_${bookId}`);
        if (!blob) {
          alert('PDF asli tidak ditemukan di database.');
          return;
        }
        const buffer = await blob.arrayBuffer();
        const pdf = await pdfjs.getDocument({
          data: new Uint8Array(buffer),
          standardFontDataUrl: '/node_modules/pdfjs-dist/standard_fonts/',
        }).promise;
        const page = await pdf.getPage(pageNum);
        
        // Sesuaikan skala render dengan layar
        const scale = Math.min(2.0, window.innerWidth / page.getViewport({ scale: 1 }).width);
        const vp = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        renderTask = page.render({ canvasContext: ctx, viewport: vp } as any);
        await renderTask.promise;
      } catch (e) {
        console.error('Gagal me-render PDF:', e);
      }
    })();
    return () => {
      if (renderTask) renderTask.cancel();
    };
  }, [bookId, pageNum]);

  return (
    <div 
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 999, display: 'flex', flexDirection: 'column' }} 
      onClick={onClose}
    >
       <div style={{ padding: '15px calc(15px + var(--safe-right)) 15px calc(15px + var(--safe-left))', background: '#111', color: '#fff', display: 'flex', justifyContent: 'space-between' }}>
         <span>Halaman Asli: {pageNum}</span>
         <button onClick={onClose} style={{ color: '#fff', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px' }}>Tutup</button>
       </div>
       <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '20px calc(20px + var(--safe-right)) 20px calc(20px + var(--safe-left))' }}>
         <canvas ref={canvasRef} style={{ background: '#fff', maxWidth: '100%', objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
       </div>
    </div>
  );
}

/** Fungsi merakit Vanilla DOM untuk sebuah blok */
function createBlockElement(bookId: string, block: Block): HTMLElement {
  let el: HTMLElement;
  
  if (block.type === 'p' || block.type === 'quote' || block.type === 'h' || block.type === 'orn') {
    el = document.createElement(block.type === 'h' ? 'h3' : 'p');
    el.className = `book-block book-${block.type}${block.type === 'h' ? ' level-sub' : ''}`;
    el.dataset.blockId = block.id;

    if (block.type === 'orn') {
      return el; // Ornamen kosong (dibentuk lewat CSS ::after)
    }

    const actionBtn = document.createElement('span');
    actionBtn.className = 'block-action-btn';
    actionBtn.textContent = '¶';
    actionBtn.dataset.page = String(block.page);
    el.appendChild(actionBtn);

    // Bangun teks berformat
    if (block.runs) {
      block.runs.forEach(run => {
        if (!run.f) {
          el.appendChild(document.createTextNode(run.t));
        } else {
          const span = document.createElement('span');
          span.className = run.f; // 'i', 'b', 'ib'
          span.textContent = run.t;
          el.appendChild(span);
        }
      });
    }
  } else if (block.type === 'img') {
    el = document.createElement('div');
    el.className = 'book-block book-img-container';
    el.dataset.blockId = block.id;
    
    const img = document.createElement('img');
    img.className = 'book-img';
    if (block.imgW && block.imgH) {
      img.width = block.imgW;
      img.height = block.imgH;
    }
    el.appendChild(img);
    
    // Muat gambar secara asinkron dari IndexedDB
    if (block.imgKey) {
      getBlob(`${bookId}_${block.imgKey}`).then(blob => {
        if (blob) {
          img.src = URL.createObjectURL(blob);
        }
      });
    }
  } else {
    el = document.createElement('div'); // Fallback
  }
  
  return el;
}
