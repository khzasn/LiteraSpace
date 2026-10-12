import { describe, it, expect } from 'vitest';
import { createBlockEl } from '../src/lib/blocks';
import type { Block } from '../src/types/book';

describe('Bagian 2: Gambar Gagal Dipotong & Placeholder', () => {
  it('blok gambar menampilkan placeholder ketika gambar tidak tersedia di database', async () => {
    const dummyBlock: Block = {
      id: '1-0',
      type: 'img',
      page: 12,
      imgW: 200,
      imgH: 150,
    };

    const el = createBlockEl('non-existent-book', dummyBlock);
    expect(el.className).toContain('book-img-container');

    // Tunggu promise getBlob resolve
    await new Promise((r) => setTimeout(r, 60));

    expect(el.innerHTML).toContain('Gambar tidak tersedia (hal. 12)');
    expect(el.innerHTML).toContain('Lihat halaman asli');
    const btn = el.querySelector('.block-page-btn');
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute('data-page')).toBe('12');
  });
});
