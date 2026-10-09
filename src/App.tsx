import { useState, useEffect } from 'preact/hooks';
import type { Book } from './types/book';
import { getAllBooks, saveBook, saveBlob, getDB, getBlob } from './lib/db';
import { Reader } from './components/Reader';
import ParserWorker from './worker/parser.worker?worker';
import type { ParserMessage } from './worker/parser';

export function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ page: number; total: number; msg?: string } | null>(null);

  useEffect(() => {
    loadLibrary();
  }, []);

  async function loadLibrary() {
    setLoading(true);
    try {
      const bks = await getAllBooks();
      setBooks(bks);
      
      // Load covers
      const newCovers: Record<string, string> = {};
      for (const b of bks) {
        const coverBlob = await getBlob(`cover_${b.id}`);
        if (coverBlob) {
          newCovers[b.id] = URL.createObjectURL(coverBlob);
        }
      }
      setCovers(newCovers);
    } catch (e) {
      console.error('Gagal memuat perpustakaan', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    setProgress({ page: 0, total: 100, msg: 'Membaca file...' });

    const buffer = await file.arrayBuffer();
    
    // Mulai Worker
    const worker = new ParserWorker();
    worker.postMessage({ buffer, title: file.name.replace(/\.pdf$/i, ''), author: 'Unknown' });

    worker.onmessage = async (ev: MessageEvent<ParserMessage>) => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        setProgress({ page: msg.page, total: msg.total, msg: msg.message || 'Memproses teks...' });
      } else if (msg.type === 'done') {
        setProgress({ page: 1, total: 1, msg: 'Menyimpan ke database...' });
        
        await saveBlob(`pdf_${msg.book.id}`, new Blob([buffer], { type: 'application/pdf' }));
        if (msg.blobs) {
          for (const [key, blob] of Object.entries(msg.blobs)) {
            await saveBlob(key, blob);
          }
        }
        await saveBook(msg.book);
        
        worker.terminate();
        setProgress(null);
        await loadLibrary();
      } else if (msg.type === 'error') {
        alert(msg.message);
        worker.terminate();
        setProgress(null);
      }
    };
  }

  async function deleteBook(id: string) {
    if (!confirm('Hapus buku ini dari perpustakaan?')) return;
    const db = await getDB();
    await db.delete('books', id);
    // Hapus blobs terkait (opsional, untuk menghemat space)
    const tx = db.transaction('blobs', 'readwrite');
    const keys = await tx.store.getAllKeys();
    for (const k of keys) {
      if (typeof k === 'string' && k.includes(id)) {
        await tx.store.delete(k);
      }
    }
    await tx.done;
    localStorage.removeItem(`pos_${id}`);
    await loadLibrary();
  }

  async function exportBackup() {
    const db = await getDB();
    const highlights = await db.getAll('highlights');
    const backup = {
      books,
      highlights,
      settings: localStorage.getItem('pembaca-nyaman-settings'),
      positions: Object.keys(localStorage).filter(k => k.startsWith('pos_')).map(k => ({ k, v: localStorage.getItem(k) }))
    };
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pembaca_backup_${new Date().getTime()}.json`;
    a.click();
  }

  function importBackup(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const backup = JSON.parse(ev.target?.result as string);
        if (backup.settings) localStorage.setItem('pembaca-nyaman-settings', backup.settings);
        if (backup.positions) {
          backup.positions.forEach((p: any) => localStorage.setItem(p.k, p.v));
        }
        if (backup.books && backup.books.length > 0) {
          setProgress({ page: 1, total: 1, msg: 'Mengimpor buku dan highlight...' });
          for (const b of backup.books) {
            await saveBook(b);
          }
        }
        if (backup.highlights && backup.highlights.length > 0) {
          const db = await getDB();
          const tx = db.transaction('highlights', 'readwrite');
          for (const h of backup.highlights) {
            await tx.store.put(h);
          }
          await tx.done;
        }
        alert('Backup berhasil diimpor! (Catatan: file gambar/PDF asli tidak ikut ter-backup demi menghemat ruang)');
        setProgress(null);
        await loadLibrary();
      } catch (err) {
        alert('File backup tidak valid.');
        setProgress(null);
      }
    };
    reader.readAsText(file);
  }

  if (loading) return <div style={{ padding: 20 }}>Memuat...</div>;

  if (activeBook) {
    return <Reader book={activeBook} onBack={() => { setActiveBook(null); loadLibrary(); }} />;
  }

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', fontFamily: 'var(--font-family)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>Pembaca Nyaman</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ padding: '6px 12px', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-color)', borderRadius: 4 }}>
            Impor
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={importBackup} />
          </label>
          <button onClick={exportBackup} style={{ padding: '6px 12px', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-color)', borderRadius: 4 }}>Ekspor</button>
        </div>
      </div>
      
      {progress && (
        <div style={{ padding: 15, background: 'var(--accent-color)', borderRadius: 8, marginBottom: 20 }}>
          <strong>{progress.msg}</strong> ({progress.page}/{progress.total})
        </div>
      )}

      <div style={{ marginBottom: 30 }}>
        <input 
          type="file" 
          accept="application/pdf" 
          onChange={handleUpload}
          disabled={!!progress}
          style={{ padding: 10, border: '1px solid var(--border-color)', borderRadius: 4 }}
        />
      </div>

      <h2 style={{ marginBottom: 15 }}>Perpustakaan Anda</h2>
      <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {books.map(b => {
          const posRaw = localStorage.getItem(`pos_${b.id}`);
          const isStarted = !!posRaw;
          let percent = 0;
          if (posRaw) {
            try { percent = JSON.parse(posRaw).percent || 0; } catch {}
          }
          return (
            <div 
              key={b.id} 
              style={{ 
                border: '1px solid var(--border-color)', 
                borderRadius: 8, 
                overflow: 'hidden',
                background: 'var(--toolbar-bg)',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <div 
                onClick={() => setActiveBook(b)}
                style={{ height: 240, background: '#eee', cursor: 'pointer', backgroundImage: covers[b.id] ? `url(${covers[b.id]})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center' }}
              >
                {!covers[b.id] && <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>No Cover</div>}
              </div>
              <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: '1.1em', marginBottom: 5, lineHeight: 1.2 }}>{b.title}</h3>
                  <div style={{ fontSize: '0.85em', opacity: 0.7, marginBottom: 10 }}>{b.pageCount} halaman {isStarted ? `• ${percent}% selesai` : ''}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button onClick={() => setActiveBook(b)} style={{ padding: '4px 8px', background: 'var(--text-color)', color: 'var(--bg-color)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    {isStarted ? 'Lanjut' : 'Baca'}
                  </button>
                  <button onClick={() => deleteBook(b.id)} style={{ padding: '4px 8px', background: 'transparent', color: 'red', border: '1px solid red', borderRadius: 4, cursor: 'pointer' }}>Hapus</button>
                </div>
              </div>
            </div>
          );
        })}
        {books.length === 0 && (
          <div style={{ opacity: 0.5, gridColumn: '1 / -1' }}>Belum ada buku. Silakan unggah PDF pertama Anda!</div>
        )}
      </div>
    </div>
  );
}
