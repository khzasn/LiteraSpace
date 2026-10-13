import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePdfPath = path.resolve(__dirname, '../fixtures/gutenberg.pdf');
const screenshotBab1Path = path.resolve(__dirname, 'bab1-images.png');

test.describe('E2E: Gambar di Reader dan Backup/Restore .zip & .json (Viewport 390x844)', () => {
  test('Unggah gutenberg.pdf -> 4 gambar + sampul + pdf -> Reader naturalWidth > 0 -> Backup .zip -> Clear DB -> Impor .zip -> Impor .json lama', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pembaca-nyaman/');

    // Bersihkan IndexedDB dan localStorage terlebih dahulu
    await page.evaluate(async () => {
      localStorage.clear();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('pembaca-nyaman');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    });
    await page.reload();

    // 1. Unggah tests/fixtures/gutenberg.pdf
    const fileInput = page.locator('label.upload-dropzone input[type="file"]');
    await fileInput.setInputFiles(fixturePdfPath);

    // Tunggu sampai kartu buku muncul
    const bookCard = page.locator('.book-card').first();
    await expect(bookCard).toBeVisible({ timeout: 90000 });

    // Verifikasi store `blobs` berisi 4 gambar + sampul + pdf (total 6 item)
    const blobCounts = await page.evaluate(async () => {
      const dbReq = indexedDB.open('pembaca-nyaman', 2);
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });
      const tx = db.transaction('blobs', 'readonly');
      const keys = (await new Promise<IDBValidKey[]>((resolve, reject) => {
        const r = tx.objectStore('blobs').getAllKeys();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })).map(String);
      db.close();

      return {
        total: keys.length,
        imgCount: keys.filter(k => k.startsWith('img_')).length,
        coverCount: keys.filter(k => k.startsWith('cover_')).length,
        pdfCount: keys.filter(k => k.startsWith('pdf_')).length,
      };
    });

    expect(blobCounts.imgCount).toBe(4);
    expect(blobCounts.coverCount).toBe(1);
    expect(blobCounts.pdfCount).toBe(1);
    expect(blobCounts.total).toBe(6);

    // Pastikan sampul muncul di library
    const coverStyle = await page.locator('.book-cover-inner').first().getAttribute('style');
    expect(coverStyle).toContain('blob:');

    // 2. Masuk ke Reader
    await bookCard.click();
    await expect(page.locator('.reader-content')).toBeVisible();

    // Tunggu semua 4 <img.book-img> memiliki src blob: dan selesai dimuat (naturalWidth > 0)
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img.book-img')) as HTMLImageElement[];
        if (imgs.length !== 4) return -1;
        return imgs.filter(img => img.complete && img.naturalWidth > 0).length;
      });
    }, { timeout: 30000 }).toBe(4);

    // Buat highlight dan simpan posisi baca di CHAPTER 1
    // Scroll ke awal CHAPTER 1 tempat judul bab dan gambar pembuka berada
    await page.evaluate(() => {
      const chapters = Array.from(document.querySelectorAll('.book-chapter'));
      const chap1 = chapters.find(ch =>
        ch.querySelector('.level-bab')?.textContent?.trim() === 'CHAPTER 1'
      );
      const firstImg = chap1?.querySelector('img.book-img') as HTMLImageElement | null;
      if (firstImg) {
        firstImg.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    });
    await page.waitForTimeout(800); // Tunggu debounce scroll 600ms menyimpan posisi

    // Ambil screenshot Bab 1 dengan gambar
    await page.screenshot({ path: screenshotBab1Path, fullPage: false });

    // Buat sebuah highlight secara programatik via seleksi teks pada paragraf di CHAPTER 1
    await page.evaluate(() => {
      const chapters = Array.from(document.querySelectorAll('.book-chapter'));
      const chap1 = chapters.find(ch =>
        ch.querySelector('.level-bab')?.textContent?.trim() === 'CHAPTER 1'
      ) || document;
      const p = chap1.querySelector('p.book-p.book-block') as HTMLElement | null;
      if (p) {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) =>
            (node.parentElement?.classList.contains('block-page-btn') ||
              (node.textContent?.trim().length || 0) < 5)
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        });
        const textNode = walker.nextNode();
        if (textNode) {
          const range = document.createRange();
          range.setStart(textNode, 0);
          range.setEnd(textNode, Math.min(20, textNode.textContent?.length || 10));
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
        }
      }
    });
    const yellowDot = page.locator('.hl-bar .dot-yellow');
    await expect(yellowDot).toBeVisible();
    await yellowDot.click();
    await expect(page.locator('mark[data-hl]')).toHaveCount(1);

    // Kembali ke perpustakaan
    await page.locator('button', { hasText: '← Kembali' }).click();
    await expect(page.locator('.book-card').first()).toBeVisible();

    // 3. Ekspor .zip
    await page.locator('button', { hasText: 'Ekspor' }).click();
    await expect(page.locator('h3', { hasText: 'Ekspor Backup (.zip)' })).toBeVisible();
    await expect(page.locator('text=Ukuran perkiraan:')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button', { hasText: 'Unduh Backup (.zip)' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const zipPath = path.resolve(__dirname, 'temp-backup.zip');
    await download.saveAs(zipPath);

    // 4. Hapus seluruh IndexedDB & localStorage
    await page.evaluate(async () => {
      localStorage.clear();
      // Hapus isi semua objectStore di pembaca-nyaman
      const dbReq = indexedDB.open('pembaca-nyaman', 2);
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });
      const tx = db.transaction(['books', 'blobs', 'highlights'], 'readwrite');
      tx.objectStore('books').clear();
      tx.objectStore('blobs').clear();
      tx.objectStore('highlights').clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await expect(page.locator('.book-card')).toHaveCount(0);

    // 5. Impor file .zip
    const importInput = page.locator('header.library-header input[type="file"]');
    await importInput.setInputFiles(zipPath);

    // Pastikan buku kembali muncul beserta sampul dan progres baca
    await expect(page.locator('.book-card').first()).toBeVisible({ timeout: 30000 });
    const restoredCoverStyle = await page.locator('.book-cover-inner').first().getAttribute('style');
    expect(restoredCoverStyle).toContain('blob:');
    await expect(page.locator('.book-progress-wrapper')).toBeVisible();

    // Buka kembali Reader dan verifikasi:
    // - 4 gambar tetap termuat (naturalWidth > 0)
    // - highlight tetap ada
    // - tombol "Lihat halaman asli" berfungsi
    await page.locator('.book-card').first().click();
    await expect(page.locator('.reader-content')).toBeVisible();

    await expect.poll(async () => {
      return await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img.book-img')) as HTMLImageElement[];
        if (imgs.length !== 4) return -1;
        return imgs.filter(img => img.complete && img.naturalWidth > 0).length;
      });
    }, { timeout: 30000 }).toBe(4);

    await expect(page.locator('mark[data-hl]')).toHaveCount(1);

    // Klik tombol "Lihat halaman asli" (.block-page-btn)
    await page.locator('.block-page-btn').first().dispatchEvent('click');
    await expect(page.locator('.pdf-modal')).toBeVisible();
    await expect(page.locator('.pdf-modal-bar')).toContainText('Halaman PDF Asli');

    // Tunggu canvas PDF asli dirender (width > 0)
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const c = document.querySelector('.pdf-modal canvas') as HTMLCanvasElement | null;
        return c ? c.width : 0;
      });
    }, { timeout: 15000 }).toBeGreaterThan(0);

    // Tutup modal PDF
    await page.locator('.pdf-modal-bar button').click();
    await expect(page.locator('.pdf-modal')).toHaveCount(0);

    // Kembali ke library
    await page.locator('button', { hasText: '← Kembali' }).click();
    await expect(page.locator('.book-card').first()).toBeVisible();

    // 6. Impor backup .json lama -> tidak crash dan menampilkan peringatan
    const legacyJsonContent = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      books: [],
      highlights: [],
    });
    await importInput.setInputFiles({
      name: 'legacy-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(legacyJsonContent, 'utf-8'),
    });

    const warningBanner = page.locator('.warning-banner');
    await expect(warningBanner).toBeVisible();
    await expect(warningBanner).toContainText(
      'Backup lama tidak berisi gambar. Unggah ulang PDF-nya untuk memulihkan gambar.'
    );

    const fs = await import('fs');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  });
});
