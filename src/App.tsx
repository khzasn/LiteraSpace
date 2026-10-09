import { useState, useEffect } from 'preact/hooks';
import type { Book } from './types/book';
import { getAllBooks, saveBook, saveBlob } from './lib/db';
import { Reader } from './components/Reader';
import ParserWorker from './worker/parser.worker?worker';
import type { ParserMessage } from './worker/parser';

export function App() {
  const [books, setBooks] = useState<Book[]>([]);
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
        
        // Simpan PDF asli
        await saveBlob(`pdf_${msg.book.id}`, new Blob([buffer], { type: 'application/pdf' }));
        
        // Simpan gambar-gambar crop
        if (msg.blobs) {
          for (const [key, blob] of Object.entries(msg.blobs)) {
            await saveBlob(key, blob);
          }
        }
        
        // Simpan buku
        await saveBook(msg.book);
        
        worker.terminate();
        setProgress(null);
        await loadLibrary();
        setActiveBook(msg.book);
      } else if (msg.type === 'error') {
        alert('Gagal memproses PDF: ' + msg.message);
        worker.terminate();
        setProgress(null);
      }
    };
  }

  if (loading) return <div style={{ padding: 20 }}>Memuat...</div>;

  if (activeBook) {
    return <Reader book={activeBook} onBack={() => setActiveBook(null)} />;
  }

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Pembaca Nyaman</h1>
      <p style={{ opacity: 0.7, marginBottom: 20 }}>Unggah PDF E-book untuk mengubah tampilannya menjadi nyaman dibaca.</p>
      
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

      <h2>Perpustakaan</h2>
      <div style={{ display: 'grid', gap: 15, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginTop: 15 }}>
        {books.map(b => (
          <div 
            key={b.id} 
            onClick={() => setActiveBook(b)}
            style={{ 
              padding: 15, 
              border: '1px solid var(--border-color)', 
              borderRadius: 8, 
              cursor: 'pointer',
              background: 'var(--toolbar-bg)'
            }}
          >
            <h3 style={{ fontSize: '1.1em', marginBottom: 5 }}>{b.title}</h3>
            <div style={{ fontSize: '0.85em', opacity: 0.7 }}>{b.pageCount} halaman</div>
          </div>
        ))}
        {books.length === 0 && (
          <div style={{ opacity: 0.5 }}>Belum ada buku tersimpan.</div>
        )}
      </div>
    </div>
  );
}
