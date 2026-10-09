import type { Highlight, HighlightSegment } from '../types/book';

/**
 * Mendapatkan offset teks murni (plain-text) untuk sebuah Node di dalam parent block-nya.
 */
function getTextOffset(block: HTMLElement, targetNode: Node, nodeOffset: number): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
  let offset = 0;
  let currentNode = walker.nextNode();
  
  while (currentNode) {
    if (currentNode === targetNode) {
      return offset + nodeOffset;
    }
    offset += currentNode.textContent?.length || 0;
    currentNode = walker.nextNode();
  }
  return offset;
}

/**
 * Menerjemahkan seleksi window murni menjadi segmen Highlight anti-rapuh.
 */
export function getSelectionSegments(selection: Selection): HighlightSegment[] | null {
  if (selection.isCollapsed || selection.rangeCount === 0) return null;
  
  const range = selection.getRangeAt(0);
  const segments: HighlightSegment[] = [];
  
  // Ambil semua elemen block yang beririsan dengan seleksi
  let commonAncestor = range.commonAncestorContainer;
  if (commonAncestor.nodeType === Node.TEXT_NODE) {
    commonAncestor = commonAncestor.parentNode!;
  }
  
  const blocks = Array.from((commonAncestor as HTMLElement).querySelectorAll('.book-block')) as HTMLElement[];
  // Jika blok itu sendiri adalah yang dipilih
  if ((commonAncestor as HTMLElement).classList?.contains('book-block')) {
    blocks.unshift(commonAncestor as HTMLElement);
  }

  if (blocks.length === 0) return null;

  blocks.forEach((block: HTMLElement) => {
    if (!selection.containsNode(block, true)) return;
    
    const blockId = block.dataset.blockId;
    if (!blockId) return;

    let start = 0;
    let end = block.textContent?.length || 0;

    // Jika seleksi dimulai di dalam blok ini
    if (block.contains(range.startContainer)) {
      start = getTextOffset(block, range.startContainer, range.startOffset);
    }
    // Jika seleksi berakhir di dalam blok ini
    if (block.contains(range.endContainer)) {
      end = getTextOffset(block, range.endContainer, range.endOffset);
    }

    if (start < end) {
      segments.push({ blockId, start, end });
    }
  });

  return segments.length > 0 ? segments : null;
}

/**
 * Merender (injeksi) tag <mark> ke dalam struktur DOM blok, berdasarkan plain-text offsets.
 * Bersifat idempoten (bisa dipanggil berulang kali untuk membersihkan lalu menggambar ulang).
 */
export function renderHighlights(container: HTMLElement, highlights: Highlight[]) {
  // 1. Bersihkan semua highlight lama dari container (unwrap <mark>)
  const marks = container.querySelectorAll('mark[data-hl]');
  marks.forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  });
  
  // (Penting: unwrap bisa memecah text node, jadi kita normalkan)
  container.normalize();

  // 2. Susun peta highlight per blockId
  const blockMap = new Map<string, { hlId: string; color: string; start: number; end: number }[]>();
  highlights.forEach(hl => {
    hl.groupSegments.forEach(seg => {
      if (!blockMap.has(seg.blockId)) blockMap.set(seg.blockId, []);
      blockMap.get(seg.blockId)!.push({
        hlId: hl.id,
        color: hl.color,
        start: seg.start,
        end: seg.end
      });
    });
  });

  // 3. Render per blok (dari ujung belakang/kanan agar offset tidak kacau saat di-split)
  blockMap.forEach((segs, blockId) => {
    const block = container.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement;
    if (!block) return;

    // Urutkan segmen dari indeks terbesar ke terkecil
    segs.sort((a, b) => b.start - a.start);

    segs.forEach(seg => {
      wrapTextRange(block, seg.start, seg.end, seg.hlId, seg.color);
    });
  });
}

/**
 * Fungsi utilitas untuk memotong dan membungkus sebagian text node dengan tag <mark>
 */
function wrapTextRange(block: HTMLElement, start: number, end: number, hlId: string, color: string) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
  let offset = 0;
  
  const nodesToWrap: { node: Text; s: number; e: number }[] = [];
  
  let currentNode = walker.nextNode() as Text | null;
  while (currentNode) {
    const len = currentNode.textContent?.length || 0;
    const nodeStart = offset;
    const nodeEnd = offset + len;

    // Cek apakah node bersinggungan dengan rentang highlight
    if (nodeEnd > start && nodeStart < end) {
      const overlapStart = Math.max(0, start - nodeStart);
      const overlapEnd = Math.min(len, end - nodeStart);
      nodesToWrap.push({ node: currentNode, s: overlapStart, e: overlapEnd });
    }
    
    offset += len;
    currentNode = walker.nextNode() as Text | null;
  }

  // Bungkus dari node paling belakang agar split tidak merusak referensi offset node di depannya
  nodesToWrap.reverse().forEach(({ node, s, e }) => {
    let targetNode = node;
    
    // Split akhir
    if (e < targetNode.length) {
      targetNode.splitText(e);
    }
    // Split awal
    if (s > 0) {
      targetNode = targetNode.splitText(s);
    }
    
    const mark = document.createElement('mark');
    mark.dataset.hl = hlId;
    mark.className = `hl-color-${color}`;
    
    const parent = targetNode.parentNode;
    parent?.insertBefore(mark, targetNode);
    mark.appendChild(targetNode);
  });
}
