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
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ page: number; total: number; msg: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => { loadLibrary(); }, []);

  async function loadLibrary() {
    setLoading(true);
    try {
      const bks = await getAllBooks();
      setBooks(bks);
      const newCovers: Record<string, string> = {};
      for (const b of bks) {
        const blob = await getBlob(`cover_${b.id}`);
        if (blob) newCovers[b.id] = URL.createObjectURL(blob);
      }
      setCovers(newCovers);
    } catch (e) {
      console.error('Gagal memuat perpustakaan:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    // Reset input agar file yang sama bisa di-upload ulang
    (e.target as HTMLInputElement).value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Hanya file PDF yang didukung.');
      return;
    }

    setUploadError(null);
    setUploading(true);
    setProgress({ page: 0, total: 100, msg: 'Membaca file PDF...' });

    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      setUploadError('Gagal membaca file. Pastikan file tidak rusak.');
      setUploading(false);
      setProgress(null);
      return;
    }

    const worker = new ParserWorker();

    // Buat dua salinan: satu untuk worker (akan di-transfer), satu untuk disimpan ke DB
    const bufferForWorker = buffer.slice(0);
    const bufferForSave = buffer.slice(0);

    // Kirim ke worker dengan transfer agar efisien
    worker.postMessage(
      { buffer: bufferForWorker, title: file.name.replace(/\.pdf$/i, ''), author: '' },
      [bufferForWorker]
    );

    worker.onerror = (err) => {
      console.error('Worker error:', err);
      setUploadError(`Error pada parser: ${err.message}`);
      worker.terminate();
      setUploading(false);
      setProgress(null);
    };

    worker.onmessage = async (ev: MessageEvent<ParserMessage>) => {
      const msg = ev.data;

      if (msg.type === 'progress') {
        setProgress({
          page: msg.page,
          total: msg.total,
          msg: msg.message || `Memproses halaman ${msg.page} / ${msg.total}...`
        });
      } else if (msg.type === 'done') {
        setProgress({ page: 1, total: 1, msg: 'Menyimpan ke database...' });
        try {
          // Simpan PDF asli menggunakan salinan buffer yang sudah disiapkan
          await saveBlob(`pdf_${msg.book.id}`, new Blob([bufferForSave], { type: 'application/pdf' }));

          // Simpan gambar + sampul
          if (msg.blobs) {
            for (const [key, blob] of Object.entries(msg.blobs)) {
              await saveBlob(key, blob);
            }
          }

          await saveBook(msg.book);
          worker.terminate();
          setUploading(false);
          setProgress(null);
          await loadLibrary();
        } catch (saveErr) {
          console.error('Gagal menyimpan:', saveErr);
          setUploadError(`Gagal menyimpan buku: ${saveErr}`);
          worker.terminate();
          setUploading(false);
          setProgress(null);
        }
      } else if (msg.type === 'error') {
        setUploadError(msg.message);
        worker.terminate();
        setUploading(false);
        setProgress(null);
      }
    };
  }

  async function deleteBook(id: string, e: MouseEvent) {
    e.stopPropagation();
    if (!confirm('Hapus buku ini dari perpustakaan? Data highlight dan progres baca juga akan terhapus.')) return;
    const db = await getDB();
    await db.delete('books', id);
    // Hapus semua blobs terkait
    const tx = db.transaction('blobs', 'readwrite');
    const keys = await tx.store.getAllKeys();
    for (const k of keys) {
      if (typeof k === 'string' && k.includes(id)) await tx.store.delete(k);
    }
    await tx.done;
    // Hapus highlights
    const tx2 = db.transaction('highlights', 'readwrite');
    const idx = tx2.store.index('by-book');
    const hls = await idx.getAllKeys(id);
    for (const k of hls) await tx2.store.delete(k);
    await tx2.done;
    localStorage.removeItem(`pos_${id}`);
    await loadLibrary();
  }

  async function exportBackup() {
    const db = await getDB();
    const highlights = await db.getAll('highlights');
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      books,
      highlights,
      settings: localStorage.getItem('pembaca-nyaman-settings'),
      positions: Object.keys(localStorage)
        .filter(k => k.startsWith('pos_'))
        .map(k => ({ k, v: localStorage.getItem(k) }))
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pembaca-nyaman-backup-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function importBackup(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (backup.settings) localStorage.setItem('pembaca-nyaman-settings', backup.settings);
      if (Array.isArray(backup.positions)) {
        backup.positions.forEach((p: any) => localStorage.setItem(p.k, p.v));
      }
      setProgress({ page: 1, total: 1, msg: 'Mengimpor backup...' });
      if (Array.isArray(backup.books)) {
        for (const b of backup.books) await saveBook(b);
      }
      if (Array.isArray(backup.highlights) && backup.highlights.length > 0) {
        const db = await getDB();
        const tx = db.transaction('highlights', 'readwrite');
        for (const h of backup.highlights) await tx.store.put(h);
        await tx.done;
      }
      setProgress(null);
      await loadLibrary();
    } catch {
      setUploadError('File backup tidak valid atau rusak.');
      setProgress(null);
    }
  }

  // ─── Tampilan ───────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: '2rem' }}>📚</div>
        <span style={{ color: 'var(--secondary-text)', fontSize: '0.9rem' }}>Memuat perpustakaan...</span>
      </div>
    );
  }

  if (activeBook) {
    return <Reader book={activeBook} onBack={() => { setActiveBook(null); loadLibrary(); }} />;
  }

  const pct = progress ? Math.round((progress.page / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div class="library-page">
      {/* Header */}
      <header class="library-header">
        <h1>📚 Pembaca Nyaman</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <label class="btn btn-sm" style={{ cursor: 'pointer' }}>
            Impor
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={importBackup} />
          </label>
          <button class="btn btn-sm" onClick={exportBackup}>Ekspor</button>
        </div>
      </header>

      <div class="library-body">
        {/* Error banner */}
        {uploadError && (
          <div class="error-banner">
            ⚠️ {uploadError}
            <button onClick={() => setUploadError(null)} style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
          </div>
        )}

        {/* Progress */}
        {progress && (
          <div class="progress-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{progress.msg}</span>
              <span style={{ fontSize: '0.85rem', color: 'var(--secondary-text)' }}>{pct}%</span>
            </div>
            <div class="progress-bar-outer">
              <div class="progress-bar-inner" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {/* Upload zone */}
        {!uploading && (
          <label class="upload-zone">
            <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>📤</div>
            <h2>Unggah E-Book PDF</h2>
            <p>Pilih file PDF berisi teks (bukan hasil scan). Semua diproses di browser, tidak ada data yang dikirim ke server.</p>
            <input
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={handleUpload}
              disabled={uploading}
            />
            <span class="btn btn-primary" style={{ display: 'inline-block' }}>Pilih File PDF</span>
          </label>
        )}

        {/* Koleksi Buku */}
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 14, color: 'var(--secondary-text)' }}>
          Koleksi Anda ({books.length} buku)
        </h2>

        {books.length === 0 ? (
          <div class="empty-state">
            <div class="icon">📖</div>
            <p>Belum ada buku. Unggah PDF pertama Anda di atas!</p>
          </div>
        ) : (
          <div class="book-grid">
            {books.map(b => {
              const posRaw = localStorage.getItem(`pos_${b.id}`);
              let pctRead = 0;
              if (posRaw) { try { pctRead = JSON.parse(posRaw).percent || 0; } catch {} }
              return (
                <div class="book-card" key={b.id} onClick={() => setActiveBook(b)}>
                  <div
                    class="book-cover"
                    style={{
                      backgroundImage: covers[b.id] ? `url(${covers[b.id]})` : 'none',
                      backgroundColor: covers[b.id] ? undefined : 'var(--accent-color)'
                    }}
                  >
                    {!covers[b.id] && '📖'}
                  </div>
                  <div class="book-info">
                    <h3>{b.title}</h3>
                    <div class="book-meta">{b.pageCount} halaman</div>
                    {posRaw && (
                      <span class="progress-pill">{pctRead}% dibaca</span>
                    )}
                  </div>
                  <div class="book-card-actions">
                    <button class="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={() => setActiveBook(b)}>
                      {posRaw ? 'Lanjut Baca' : 'Mulai Baca'}
                    </button>
                    <button class="btn btn-sm btn-danger" onClick={(e) => deleteBook(b.id, e)}>Hapus</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
