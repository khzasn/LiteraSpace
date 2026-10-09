/** Hitung median array angka */
export const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** Hitung modus array angka */
export const mode = (a: number[]): number | undefined => {
  if (!a.length) return undefined;
  const m = new Map<number, number>();
  a.forEach((v) => m.set(v, (m.get(v) ?? 0) + 1));
  return [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
};

/** Deteksi italic dari nama font */
export const isItalic = (name: string): boolean =>
  /italic|oblique|ital\b|-it\b|,it$/i.test(name ?? '');

/** Deteksi bold dari nama font */
export const isBold = (name: string): boolean =>
  /bold|black|heavy|semibold|-bd\b/i.test(name ?? '');

/** Apakah teks berakhir tanda baca akhir kalimat? */
export const endsSentence = (t: string): boolean =>
  /[.!?…:"\"'\)\]][\s]*$/.test(t);

/** Pattern ornamen (kotak kosong, glyph unicode) */
export const ORN_RE = /^[\s□▢◻▪■□▪]+$/;

/** Apakah baris ini semua tanda baca (buang)? */
export const isAllPunct = (t: string): boolean => /^[\s—\-–.,]+$/.test(t);

/** Perkalian matriks CTM 2D (untuk tracking posisi gambar) */
export const mulCTM = (m: number[], c: number[]): number[] => [
  m[0] * c[0] + m[1] * c[2],
  m[0] * c[1] + m[1] * c[3],
  m[2] * c[0] + m[3] * c[2],
  m[2] * c[1] + m[3] * c[3],
  m[4] * c[0] + m[5] * c[2] + c[4],
  m[4] * c[1] + m[5] * c[3] + c[5],
];
