import { useState, useEffect } from 'preact/hooks';
import type { Book } from './types/book';
import { getAllBooks, saveBook, saveBlob, getDB, getBlob } from './lib/db';
import { Reader } from './components/Reader';
import ParserWorker from './worker/parser.worker?worker';
import type { ParserMessage } from './worker/parser';
import { PARSER_VERSION } from './worker/parser-constants';
import { coverBlobKey, pdfBlobKey } from './lib/keys';
import { createZipBackup, parseBackupFile } from './lib/backup';
import { settings } from './lib/settings';
import type { Theme } from './lib/settings';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function reparseBookInWorker(
  buffer: ArrayBuffer,
  title: string,
  author: string
): Promise<{ book: Book; blobs?: Record<string, Blob> }> {
  return new Promise((resolve, reject) => {
    const worker = new ParserWorker();
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'done') {
        worker.terminate();
        resolve({ book: msg.book, blobs: msg.blobs });
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage({ buffer, title, author }, [buffer]);
  });
}

export function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ page: number; total: number; msg: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [includePdfInExport, setIncludePdfInExport] = useState(true);
  const [exportSizes, setExportSizes] = useState({ baseSize: 0, pdfSize: 0 });
  const [exporting, setExporting] = useState(false);

  // Status penyimpanan (usage / quota / persist)
  const [storageInfo, setStorageInfo] = useState<{
    usage: number;
    quota: number;
    persisted: boolean | null;
    persistDenied: boolean;
  } | null>(null);

  // PWA Install Prompt & Standalone detection
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [dismissInstallHint, setDismissInstallHint] = useState(() => {
    try { return sessionStorage.getItem('ebookly-dismiss-install') === '1'; } catch { return false; }
  });

  useEffect(() => {
    loadLibrary();

    const checkStandalone = () => {
      const standalone =
        window.matchMedia?.('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true;
      setIsStandalone(!!standalone);
    };
    checkStandalone();

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  async function updateStorageInfo(requestPersist = false) {
    if (typeof navigator === 'undefined' || !navigator.storage) return;
    try {
      let persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
      let persistDenied = false;
      if (requestPersist && navigator.storage.persist) {
        const granted = await navigator.storage.persist();
        persisted = granted;
        if (!granted) {
          persistDenied = true;
        }
      }
      const est = navigator.storage.estimate ? await navigator.storage.estimate() : { usage: 0, quota: 0 };
      setStorageInfo(prev => ({
        usage: est.usage || 0,
        quota: est.quota || 0,
        persisted,
        persistDenied: persistDenied || (prev?.persistDenied ?? false),
      }));
    } catch (e) {
      console.warn('Gagal memeriksa status penyimpanan:', e);
    }
  }

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } catch {}
  }

  async function loadLibrary() {
    setLoading(true);
    try {
      const bks = await getAllBooks();

      // Migrasi: jika parserVersion berbeda, hitung ulang buku dari salinan PDF yang tersimpan
      for (let i = 0; i < bks.length; i++) {
        const b = bks[i];
        if (b.parserVersion !== PARSER_VERSION) {
          const pdfBlob = await getBlob(pdfBlobKey(b.id));
          if (pdfBlob) {
            try {
              const buffer = await pdfBlob.arrayBuffer();
              const { book: reParsed, blobs } = await reparseBookInWorker(buffer, b.title, b.author);
              reParsed.id = b.id; // Pertahankan ID agar blockId dan highlight tetap menempel
              await saveBook(reParsed);
              if (blobs) {
                for (const [k, blob] of Object.entries(blobs)) {
                  await saveBlob(k, blob);
                }
              }
              bks[i] = reParsed;
            } catch (err) {
              console.warn('Gagal re-parse buku saat migrasi:', b.title, err);
              // Fallback migrasi label in-place
              b.chapters.forEach((c) => {
                if (/^BAB\s*\d+$/i.test(c.label)) {
                  c.label = c.label.replace(/^BAB\s*/i, 'CHAPTER ');
                }
              });
              b.parserVersion = PARSER_VERSION;
              await saveBook(b);
            }
          } else {
            // Update label in-place jika PDF blob tidak tersedia
            b.chapters.forEach((c) => {
              if (/^BAB\s*\d+$/i.test(c.label)) {
                c.label = c.label.replace(/^BAB\s*/i, 'CHAPTER ');
              }
            });
            b.parserVersion = PARSER_VERSION;
            await saveBook(b);
          }
        }
      }

      setBooks(bks);
      const newCovers: Record<string, string> = {};
      for (const b of bks) {
        const blob = await getBlob(coverBlobKey(b.id));
        if (blob) newCovers[b.id] = URL.createObjectURL(blob);
      }
      setCovers(newCovers);
      await updateStorageInfo(false);
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
          await saveBlob(pdfBlobKey(msg.book.id), new Blob([bufferForSave], { type: 'application/pdf' }));

          // Simpan gambar + sampul
          if (msg.blobs) {
            for (const [key, blob] of Object.entries(msg.blobs)) {
              await saveBlob(key, blob);
            }
          }

          await saveBook(msg.book);
          await updateStorageInfo(true);
          worker.terminate();
          setUploading(false);
          setProgress(null);
          if (msg.imgStats && msg.imgStats.failed > 0) {
            setUploadWarning(
              `${msg.imgStats.success} dari ${msg.imgStats.total} gambar berhasil diproses (${msg.imgStats.failed} gambar gagal dipotong). Anda tetap dapat melihat halaman asli melalui tombol baca.`
            );
          }
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
      if (
        typeof k === 'string' &&
        (k.startsWith(`img_${id}_`) || k === coverBlobKey(id) || k === pdfBlobKey(id) || k.includes(id))
      ) {
        await tx.store.delete(k);
      }
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

  async function openExportModal() {
    const db = await getDB();
    const highlights = await db.getAll('highlights');
    const jsonEstimate = JSON.stringify({ books, highlights }).length;

    const tx = db.transaction('blobs', 'readonly');
    const keys = await tx.store.getAllKeys();
    let baseBlobsSize = 0;
    let pdfBlobsSize = 0;

    for (const k of keys) {
      if (typeof k === 'string') {
        const blob = await tx.store.get(k);
        if (blob) {
          if (k.startsWith('pdf_')) {
            pdfBlobsSize += blob.size;
          } else {
            baseBlobsSize += blob.size;
          }
        }
      }
    }
    await tx.done;

    setExportSizes({
      baseSize: jsonEstimate + baseBlobsSize,
      pdfSize: pdfBlobsSize,
    });
    setIncludePdfInExport(true);
    setShowExportModal(true);
  }

  async function confirmExportBackup() {
    setExporting(true);
    try {
      const db = await getDB();
      const highlights = await db.getAll('highlights');
      const tx = db.transaction('blobs', 'readonly');
      const keys = await tx.store.getAllKeys();
      const blobs: Record<string, Blob> = {};
      for (const k of keys) {
        if (typeof k === 'string') {
          const b = await tx.store.get(k);
          if (b) blobs[k] = b;
        }
      }
      await tx.done;

      const positions = Object.keys(localStorage)
        .filter(k => k.startsWith('pos_'))
        .map(k => ({ k, v: localStorage.getItem(k) }));

      const zipBlob = await createZipBackup({
        books,
        highlights,
        settings: localStorage.getItem('pembaca-nyaman-settings'),
        positions,
        blobs,
        includePdf: includePdfInExport,
      });

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pembaca-nyaman-backup-${Date.now()}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setShowExportModal(false);
    } catch (err) {
      setUploadError(`Gagal membuat backup: ${err}`);
    } finally {
      setExporting(false);
    }
  }

  async function importBackup(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;

    setUploadError(null);
    setUploadWarning(null);
    setProgress({ page: 1, total: 1, msg: 'Mengimpor backup...' });

    try {
      const parsed = await parseBackupFile(file);
      const { backup, blobs, warning } = parsed;

      if (backup.settings) localStorage.setItem('pembaca-nyaman-settings', backup.settings);
      if (Array.isArray(backup.positions)) {
        backup.positions.forEach((p: any) => {
          if (p && p.k && p.v !== null && p.v !== undefined) {
            localStorage.setItem(p.k, p.v);
          }
        });
      }

      // Simpan semua blob terlebih dahulu (gambar, sampul, pdf)
      for (const [key, blob] of Object.entries(blobs)) {
        await saveBlob(key, blob);
      }

      if (Array.isArray(backup.books)) {
        for (const b of backup.books) await saveBook(b);
      }
      if (Array.isArray(backup.highlights) && backup.highlights.length > 0) {
        const db = await getDB();
        const tx = db.transaction('highlights', 'readwrite');
        for (const h of backup.highlights) await tx.store.put(h);
        await tx.done;
      }

      await updateStorageInfo(true);
      if (warning) {
        setUploadWarning(warning);
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
      {/* Header & Navigasi */}
      <div class="library-header-wrapper">
        <header class="library-header">
          <div class="brand-group">
            <svg class="brand-logo-svg" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="3" y="9" width="18" height="20" rx="3.5" fill="#6366f1" />
              <rect x="7" y="5.5" width="18" height="20" rx="3.5" fill="#10b981" />
              <rect x="11" y="2" width="18" height="20" rx="3.5" fill="#f43f5e" />
              <rect x="14.5" y="6" width="11" height="2" rx="1" fill="#ffffff" fill-opacity="0.8" />
              <rect x="14.5" y="10" width="7" height="2" rx="1" fill="#ffffff" fill-opacity="0.8" />
            </svg>
            <h1 class="brand-title">Ebookly</h1>
          </div>

          <div class="header-controls">
            {/* Theme Selector */}
            <div class="theme-picker" role="group" aria-label="Pilih tema">
              {(['light', 'sepia', 'warm', 'dark'] as Theme[]).map(t => {
                const labels: Record<Theme, string> = { light: 'Terang', sepia: 'Sepia', warm: 'Hangat', dark: 'Gelap' };
                return (
                  <button
                    key={t}
                    class="theme-swatch"
                    data-theme-val={t}
                    aria-label={labels[t]}
                    aria-pressed={settings.value.theme === t}
                    onClick={() => settings.value = { ...settings.value, theme: t }}
                  />
                );
              })}
            </div>

            {/* Tombol Impor & Ekspor Outline */}
            <div class="header-actions">
              <label class="btn-outline" style={{ cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 13v3a2 2 0 002 2h10a2 2 0 002-2v-3M10 3v10m-4-4l4 4 4-4" />
                </svg>
                <span>Impor</span>
                <input type="file" accept=".zip,.json,application/zip,application/json" style={{ display: 'none' }} onChange={importBackup} />
              </label>
              <button class="btn-outline" onClick={openExportModal}>
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 13v3a2 2 0 002 2h10a2 2 0 002-2v-3M10 13V3m-4 4l4-4 4 4" />
                </svg>
                <span>Ekspor</span>
              </button>
            </div>
          </div>
        </header>
      </div>

      <div class="library-body">
        {/* Petunjuk Pasang PWA (Tambahkan ke layar utama) — hanya jika belum standalone */}
        {!isStandalone && !dismissInstallHint && (
          <div class="install-hint-banner">
            <div class="install-hint-content">
              <div class="install-hint-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                  <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
                <strong>Tambahkan ke layar utama</strong>
                <span class="install-badge-offline">Siap Offline</span>
              </div>
              <p class="install-hint-desc">
                {deferredPrompt
                  ? 'Pasang Ebookly di layar utama HP/perangkat Anda agar dapat dibuka layar penuh dan tetap berfungsi tanpa koneksi internet.'
                  : 'Android (Chrome): ketuk menu ⋮ → "Tambahkan ke layar utama". iOS (Safari): ketuk tombol Bagikan → "Tambah ke Layar Utama".'}
              </p>
            </div>
            <div class="install-hint-actions">
              {deferredPrompt && (
                <button class="btn-install-pwa" onClick={handleInstallClick}>
                  Tambahkan ke layar utama
                </button>
              )}
              <button
                class="btn-dismiss-install"
                aria-label="Tutup petunjuk pasang"
                onClick={() => {
                  setDismissInstallHint(true);
                  try { sessionStorage.setItem('ebookly-dismiss-install', '1'); } catch {}
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Error banner */}
        {uploadError && (
          <div class="error-banner">
            ⚠️ {uploadError}
            <button onClick={() => setUploadError(null)} style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
          </div>
        )}

        {/* Warning banner */}
        {uploadWarning && (
          <div class="warning-banner">
            <span>ℹ️ {uploadWarning}</span>
            <button onClick={() => setUploadWarning(null)} style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
          </div>
        )}

        {/* Peringatan jika navigator.storage.persist() ditolak */}
        {storageInfo?.persistDenied && (
          <div class="warning-banner storage-persist-warning">
            <span>
              ⚠️ <strong>Penyimpanan permanen tidak diizinkan browser.</strong> Data buku berisiko dibersihkan otomatis oleh sistem jika ruang penyimpanan perangkat hampir penuh. Gunakan tombol <strong>Ekspor</strong> secara berkala untuk menyimpan cadangan.
            </span>
          </div>
        )}

        {/* Progress Box */}
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

        {/* Area Unggah (Upload Dropzone) */}
        {!uploading && (
          <label class="upload-dropzone">
            <div class="upload-icon-circle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <polyline points="9 15 12 12 15 15" />
              </svg>
            </div>
            <h2 class="upload-title">Unggah E-Book PDF</h2>
            <p class="upload-subtitle">
              Pilih file PDF berisi teks (bukan hasil scan). Semua diproses di browser, tidak ada data yang dikirim ke server.
            </p>
            <input
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={handleUpload}
              disabled={uploading}
            />
            <span class="btn-upload-primary">
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M10 4v12M4 10h12" />
              </svg>
              Pilih File PDF
            </span>
          </label>
        )}

        {/* Bagian Koleksi (Gallery) + Status Penyimpanan */}
        <section class="collection-section">
          <div class="collection-header-row">
            <h2 class="collection-heading">
              Koleksi Anda <span class="collection-count">({books.length} {books.length === 1 ? 'buku' : 'buku'})</span>
            </h2>
            {storageInfo && storageInfo.quota > 0 && (
              <div class="storage-status-pill" title="Status penyimpanan lokal browser (IndexedDB)">
                <span>Penyimpanan: {formatBytes(storageInfo.usage)} / {formatBytes(storageInfo.quota)}</span>
                {storageInfo.persisted !== null && (
                  <span class={`storage-persist-badge ${storageInfo.persisted ? 'is-persisted' : 'is-volatile'}`}>
                    {storageInfo.persisted ? 'Persisten ✓' : 'Sementara'}
                  </span>
                )}
              </div>
            )}
          </div>

          {books.length === 0 ? (
            <div class="empty-state">
              <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <p>Belum ada buku di perpustakaan Anda.<br />Unggah file PDF pertama Anda di atas!</p>
            </div>
          ) : (
            <div class="book-grid">
              {books.map(b => {
                const posRaw = localStorage.getItem(`pos_${b.id}`);
                let pctRead = 0;
                let chLabel = '';
                if (posRaw) {
                  try {
                    const pos = JSON.parse(posRaw);
                    pctRead = pos.percent || 0;
                    chLabel = pos.chapterLabel || '';
                  } catch {}
                }
                if (!chLabel && b.chapters && b.chapters.length > 0) {
                  const firstChapter = b.chapters.find(c => c.kind === 'part' || (c.label && c.label.startsWith('PART'))) || b.chapters.find(c => c.label) || b.chapters[0];
                  if (firstChapter) {
                    chLabel = firstChapter.label
                      ? `${firstChapter.label}${firstChapter.title ? ' ' + firstChapter.title : ''}`
                      : firstChapter.title;
                  }
                }

                return (
                  <div class="book-card" key={b.id} onClick={() => setActiveBook(b)}>
                    {/* Thumbnail dengan margin & padding pas */}
                    <div class="book-cover-frame">
                      <div
                        class="book-cover-inner"
                        style={{
                          backgroundImage: covers[b.id] ? `url(${covers[b.id]})` : 'none',
                        }}
                      >
                        {!covers[b.id] && (
                          <div class="book-fallback-cover">
                            <svg class="book-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                            </svg>
                            <span class="book-fallback-title">{b.title}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Informasi Buku */}
                    <div class="book-info-body">
                      <h3 class="book-card-title" title={b.title}>{b.title}</h3>

                      {/* Label bab 'PART I Individual...' diletakkan rapi, tidak terpotong acak */}
                      {chLabel && (
                        <div class="book-chapter-badge" title={chLabel}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                          </svg>
                          <span>{chLabel}</span>
                        </div>
                      )}

                      {/* Progress bar jika sudah mulai dibaca, atau info halaman */}
                      {posRaw ? (
                        <div class="book-progress-wrapper">
                          <div class="book-progress-track">
                            <div class="book-progress-fill" style={{ width: `${pctRead}%` }} />
                          </div>
                          <div class="book-progress-meta">
                            <span>{pctRead}% dibaca</span>
                            <span>{b.pageCount} hal</span>
                          </div>
                        </div>
                      ) : (
                        <div class="book-meta-simple">{b.pageCount} halaman</div>
                      )}
                    </div>

                    {/* Aksi Buku */}
                    <div class="book-card-actions">
                      <button class="btn-read-action" onClick={(e) => { e.stopPropagation(); setActiveBook(b); }}>
                        {posRaw ? 'Lanjut Baca' : 'Mulai Baca'}
                      </button>
                      <button
                        class="btn-delete-action"
                        title="Hapus buku"
                        aria-label="Hapus buku"
                        onClick={(e) => deleteBook(b.id, e)}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Modal Ekspor Backup */}
      {showExportModal && (
        <div
          class="pdf-modal"
          style={{ background: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 }}
          onClick={() => !exporting && setShowExportModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-color)',
              color: 'var(--text-color)',
              border: '1px solid var(--border-color)',
              borderRadius: 14,
              padding: 20,
              maxWidth: 380,
              width: '100%',
              boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '1.1rem', marginBottom: 8 }}>📦 Ekspor Backup (.zip)</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--secondary-text)', marginBottom: 14, lineHeight: 1.5 }}>
              Backup menyimpan buku, gambar bab, sampul, highlight, pengaturan, dan posisi baca terakhir.
            </p>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: 'var(--accent-color)',
                borderRadius: 8,
                cursor: 'pointer',
                marginBottom: 12,
                fontSize: '0.9rem',
              }}
            >
              <input
                type="checkbox"
                checked={includePdfInExport}
                onChange={e => setIncludePdfInExport((e.target as HTMLInputElement).checked)}
              />
              <span>Sertakan salinan PDF</span>
            </label>

            <div style={{ fontSize: '0.85rem', color: 'var(--secondary-text)', marginBottom: 18 }}>
              Ukuran perkiraan:{' '}
              <strong style={{ color: 'var(--text-color)' }}>
                ~{formatBytes(exportSizes.baseSize + (includePdfInExport ? exportSizes.pdfSize : 0))}
              </strong>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                class="btn btn-sm"
                disabled={exporting}
                onClick={() => setShowExportModal(false)}
              >
                Batal
              </button>
              <button
                class="btn btn-sm btn-primary"
                disabled={exporting}
                onClick={confirmExportBackup}
              >
                {exporting ? 'Menyiapkan...' : 'Unduh Backup (.zip)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
