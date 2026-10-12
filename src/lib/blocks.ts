import type { Block } from '../types/book';
import { getBlob } from './db';
import { imageBlobKey } from './keys';

export function showImagePlaceholder(wrap: HTMLElement, page: number) {
  wrap.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'img-failed-placeholder';
  box.innerHTML = `
    <div style="font-size: 1.5rem; margin-bottom: 4px;">🖼️</div>
    <div style="font-size: 0.88rem; color: var(--secondary-text); margin-bottom: 8px;">
      Gambar tidak tersedia (hal. ${page})
    </div>
    <button class="btn btn-sm block-page-btn" data-page="${page}" style="font-size: 0.8rem; padding: 4px 10px;">
      Lihat halaman asli
    </button>
  `;
  wrap.appendChild(box);
}

export function createBlockEl(bookId: string, block: Block): HTMLElement {
  if (block.type === 'img') {
    const wrap = document.createElement('div');
    wrap.className = 'book-block book-img-container';
    wrap.dataset.blockId = block.id;
    const img = document.createElement('img');
    img.className = 'book-img';
    img.alt = '';
    if (block.imgW) img.width = block.imgW;
    if (block.imgH) img.height = block.imgH;
    wrap.appendChild(img);

    img.onerror = () => {
      showImagePlaceholder(wrap, block.page);
    };

    getBlob(imageBlobKey(bookId, block.id))
      .then((blob) => {
        if (blob) {
          img.src = URL.createObjectURL(blob);
        } else {
          showImagePlaceholder(wrap, block.page);
        }
      })
      .catch(() => {
        showImagePlaceholder(wrap, block.page);
      });

    return wrap;
  }

  if (block.type === 'orn') {
    const el = document.createElement('div');
    el.className = 'book-block book-orn';
    el.dataset.blockId = block.id;
    return el;
  }

  const tag = block.type === 'h' ? 'h3' : 'p';
  const el = document.createElement(tag);
  el.className = `book-block book-${block.type}${block.type === 'h' ? ' level-sub' : ''}`;
  el.dataset.blockId = block.id;

  // Tombol lihat halaman asli
  const pageBtn = document.createElement('button');
  pageBtn.className = 'block-page-btn';
  pageBtn.textContent = String(block.page);
  pageBtn.dataset.page = String(block.page);
  pageBtn.title = `Halaman PDF asli: ${block.page}`;
  el.appendChild(pageBtn);

  // Isi teks (dengan format italic/bold)
  if (block.runs) {
    block.runs.forEach((run) => {
      if (!run.f) {
        el.appendChild(document.createTextNode(run.t));
      } else {
        const span = document.createElement('span');
        span.className = run.f;
        span.textContent = run.t;
        el.appendChild(span);
      }
    });
  }

  return el;
}
