# 📚 LiteraSpace

**LiteraSpace** adalah aplikasi web progresif (*Progressive Web App* / PWA) pembaca e-book PDF yang mengubah dokumen PDF berisi teks menjadi tampilan baca yang nyaman layaknya buku fisik—lengkap dengan pilihan tema warna (*Light, Sepia, Warm, Dark*), penyesuaian tipografi, daftar isi otomatis, penanda (*highlight*) multi-warna beserta catatan, ekstraksi ilustrasi, dan penyimpanan 100% lokal di perangkat Anda.

---

## 📱 1. Cara Membuka & Memasang di HP (Android & iOS)

Aplikasi ini dirancang sebagai **PWA** sehingga dapat dipasang ke layar utama (*Home Screen*) HP Anda, berjalan dalam tampilan layar penuh (tanpa *address bar* browser), dan **tetap dapat dibuka sepenuhnya secara *offline*** setelah kunjungan pertama.

### Android (Google Chrome / Microsoft Edge)
1. Buka alamat aplikasi di **Google Chrome** pada HP Android Anda:  
   `https://khzasn.github.io/LiteraSpace/`
2. Pada halaman Perpustakaan, ketuk tombol **"Tambahkan ke layar utama"** pada kotak petunjuk di bagian atas, **ATAU**:
3. Ketuk ikon menu **⋮ (tiga titik)** di pojok kanan atas Chrome → pilih **"Tambahkan ke layar utama"** (*Add to Home screen*) atau **"Instal aplikasi"** (*Install app*).
4. Konfirmasi dengan mengetuk **Instal / Tambah**. Ikon **LiteraSpace** akan muncul di daftar aplikasi HP Anda.

### iOS / iPadOS (Safari)
1. Buka alamat aplikasi menggunakan browser **Safari** di iPhone atau iPad Anda.
2. Ketuk tombol **Bagikan (*Share*)** (ikon kotak dengan panah ke atas di bilah bawah/atas Safari).
3. Gulir ke bawah lalu pilih **"Tambah ke Layar Utama"** (*Add to Home Screen*).
4. Ketuk **Tambah** (*Add*) di pojok kanan atas. Aplikasi kini dapat diakses langsung dari layar utama seperti aplikasi *native*.

---

## 🔄 2. Cara Memindahkan Buku Antar Perangkat Lewat Cadangan (Backup & Restore)

Karena LiteraSpace tidak menggunakan server eksternal maupun akun *cloud* demi privasi penuh, seluruh buku diproses dan disimpan langsung di perangkat Anda. Untuk memindahkan koleksi buku, gambar bab, penanda (*highlight*), catatan, pengaturan baca, serta posisi halaman terakhir dari satu perangkat ke perangkat lain (misalnya dari Laptop ke HP, atau saat ganti HP baru):

### Langkah A — Ekspor Cadangan di Perangkat Asal
1. Buka halaman **Perpustakaan** LiteraSpace di perangkat asal.
2. Klik tombol **Ekspor** di bagian kanan atas header.
3. Pastikan opsi **"Sertakan salinan PDF"** dicentang (default aktif) agar file PDF asli ikut terbawa di dalam cadangan.
4. Klik **"Unduh Backup (.zip)"**.
5. Kirim file `.zip` tersebut ke perangkat tujuan Anda (melalui WhatsApp, Telegram, Google Drive, AirDrop, kabel data, atau email).

### Langkah B — Impor Cadangan di Perangkat Tujuan
1. Buka **LiteraSpace** di perangkat tujuan (HP/Tablet/Laptop).
2. Klik tombol **Impor** di bagian kanan atas header.
3. Pilih file `.zip` hasil ekspor tadi (aplikasi juga tetap mendukung file cadangan format lama `.json`).
4. Seluruh buku, sampul, gambar ilustrasi, *highlight*, pengaturan tema/font, dan persentase progres baca akan langsung dipulihkan seperti semula.

---

## ⚠️ 3. Peringatan Penting Tentang Data Browser

Harap perhatikan hal-hal berikut agar koleksi bacaan dan catatan Anda tetap aman:

1. **Penyimpanan 100% Lokal di Browser**:  
   Semua data buku, potongan gambar, *highlight*, dan posisi baca disimpan di dalam database internal browser (**IndexedDB** dan **localStorage**) pada perangkat yang Anda gunakan. Tidak ada data yang diunggah ke server mana pun.
2. **Jangan Menghapus Data Situs (*Clear Site Data*)**:  
   Menghapus *Data Situs / Penyimpanan Situs (Site Data / Cookies & Cached Data)* pada pengaturan browser akan **menghapus seluruh buku dan catatan** yang tersimpan di dalam browser tersebut.
3. **Hindari Mode Penyamaran (*Incognito / Private Mode*)**:  
   Jangan menggunakan Mode Penyamaran untuk menyimpan bacaan jangka panjang karena browser akan menghapus seluruh database begitu tab penyamaran ditutup.
4. **Izin Penyimpanan Permanen (*Persistent Storage*)**:  
   Saat buku pertama disimpan, aplikasi otomatis meminta izin `navigator.storage.persist()` agar sistem operasi tidak menghapus data saat memori HP hampir penuh. Jika browser menolak izin tersebut (status **Sementara**), sangat disarankan untuk rutin mengunduh file cadangan lewat tombol **Ekspor**.

---

## 🛠️ Pengembangan Lokal & Deployment

```bash
# 1. Instal dependensi
npm ci

# 2. Jalankan server pengembangan lokal
npm run dev

# 3. Jalankan pengujian (Vitest)
npm test

# 4. Bangun bundel produksi (termasuk Service Worker & PWA Manifest)
npm run build
```

### Deployment Otomatis ke GitHub Pages
Repositori ini telah dilengkapi workflow `.github/workflows/deploy.yml`. Setiap *push* ke branch `main` / `master` akan otomatis menjalankan `npm ci`, `npm test`, `npm run build`, dan men-deploy isi folder `dist/` ke **GitHub Pages**.
Pastikan pada menu **Settings → Pages** di repositori GitHub Anda, bagian **Build and deployment → Source** diatur ke **GitHub Actions**.
