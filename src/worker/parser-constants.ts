/**
 * Konstanta parser — semua ambang RELATIF terhadap ukuran body isi.
 * Bisa disetel tanpa mengubah logika inti.
 */

/** Versi parser. Naikkan saat logika berubah (memicu re-anchor highlight). */
export const PARSER_VERSION = '1.1.0';

/** Toleransi baseline-y saat mengelompokkan item teks menjadi baris (pt) */
export const LINE_Y_TOLERANCE = 2.5;

/** Ukuran font isi buku (dihitung otomatis, ini fallback) */
export const BODY_SIZE_FALLBACK = 15;

/** Ambang indent paragraf baru: x0 > leftMargin + INDENT_THRESHOLD (pt) */
export const INDENT_THRESHOLD = 12;

/** Faktor jarak baris untuk paragraf baru: gap > leading * PARA_GAP_FACTOR */
export const PARA_GAP_FACTOR = 1.35;

/** Ambang ukuran font untuk judul bab besar (pt) */
export const CHAPTER_TITLE_SIZE = 24;

/** Ambang ukuran font untuk subjudul dalam bab (pt) */
export const SUBHEAD_SIZE = 16.5;

/** Ambang ukuran font untuk subjudul tepat setelah judul (pt) */
export const SUBTITLE_SIZE = 16;

/** Gambar besar (figure): lebar >= dan tinggi >= (pt) */
export const IMG_MIN_W = 50;
export const IMG_MIN_H = 40;

/** Ornamen gambar kecil: lebar <= dan tinggi <= (pt) */
export const ORN_MAX_W = 120;
export const ORN_MAX_H = 26;
export const ORN_MIN_W = 8;

/** Gambar hampir penuh halaman (abaikan sebagai latar) */
export const IMG_PAGE_FRACTION = 0.7;

/** Ambang kutipan tengah: x0 > leftMargin + CENTER_X_THRESHOLD */
export const CENTER_X_THRESHOLD = 45;
/** Simetri kutipan tengah: |x0 - left - (maxRight - x1)| < CENTER_SYMMETRY */
export const CENTER_SYMMETRY = 18;

/** Gap leading untuk deteksi leading median */
export const LEAD_MIN = 5;
export const LEAD_MAX = 40;

/** Faktor epigraf: baris epigraf terpisah jarak >= lead * EPIGRAF_LEAD_FACTOR */
export const EPIGRAF_LEAD_FACTOR = 1.6;

/** Resolusi render gambar (DPI) */
export const IMG_DPI = 150;
export const PDF_DPI = 72;
export const IMG_SCALE = IMG_DPI / PDF_DPI; // 150/72 ≈ 2.083

/** Padding crop gambar (px pada skala DPI render) */
export const IMG_CROP_PAD = 4;

/** Font isi: range ukuran valid (pt) */
export const BODY_SIZE_MIN = 9;
export const BODY_SIZE_MAX = 16;
