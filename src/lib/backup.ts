import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { Book, Highlight } from '../types/book';

export interface BackupData {
  version: number;
  exportedAt: string;
  books: Book[];
  highlights: Highlight[];
  settings: string | null;
  positions: { k: string; v: string | null }[];
}

export interface CreateZipBackupOptions {
  books: Book[];
  highlights: Highlight[];
  settings: string | null;
  positions: { k: string; v: string | null }[];
  blobs: Record<string, Blob>;
  includePdf?: boolean;
}

export interface ParseBackupResult {
  backup: BackupData;
  blobs: Record<string, Blob>;
  isLegacyJson: boolean;
  warning?: string;
}

/**
 * Membuat file backup .zip berisi backup.json dan folder blobs/
 */
export async function createZipBackup(options: CreateZipBackupOptions): Promise<Blob> {
  const { books, highlights, settings, positions, blobs, includePdf = true } = options;

  const backupJson: BackupData = {
    version: 2,
    exportedAt: new Date().toISOString(),
    books,
    highlights,
    settings,
    positions,
  };

  const zippable: Record<string, Uint8Array> = {};
  zippable['backup.json'] = strToU8(JSON.stringify(backupJson, null, 2));

  for (const [key, blob] of Object.entries(blobs)) {
    if (!includePdf && (key.startsWith('pdf_') || key.endsWith('.pdf'))) {
      continue;
    }
    const buffer = await blob.arrayBuffer();
    const safeName = `blobs/${encodeURIComponent(key)}`;
    zippable[safeName] = new Uint8Array(buffer);
  }

  const zipBytes = zipSync(zippable);
  return new Blob([zipBytes], { type: 'application/zip' });
}

/**
 * Membaca file backup baik berupa .zip (versi 2) maupun .json lama (versi 1)
 */
export async function parseBackupFile(fileOrBlob: Blob): Promise<ParseBackupResult> {
  const arrayBuffer = await fileOrBlob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  // Periksa apakah file berupa ZIP (Magic bytes PK\x03\x04 atau PK\x05\x06)
  const isZip = uint8.length >= 4 && uint8[0] === 0x50 && uint8[1] === 0x4B;

  if (isZip) {
    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(uint8);
    } catch (err) {
      throw new Error(`Gagal membuka file ZIP: ${err}`);
    }

    let backupJsonStr = '';
    const blobs: Record<string, Blob> = {};

    for (const [path, data] of Object.entries(unzipped)) {
      if (path === 'backup.json') {
        backupJsonStr = strFromU8(data);
      } else if (path.startsWith('blobs/') && !path.endsWith('/')) {
        const rawKey = decodeURIComponent(path.slice('blobs/'.length));
        let mimeType = 'application/octet-stream';
        if (rawKey.startsWith('img_') || rawKey.startsWith('cover_')) {
          mimeType = 'image/jpeg';
        } else if (rawKey.startsWith('pdf_')) {
          mimeType = 'application/pdf';
        }
        blobs[rawKey] = new Blob([data as unknown as BlobPart], { type: mimeType });
      }
    }

    if (!backupJsonStr) {
      throw new Error('File backup ZIP tidak memiliki backup.json.');
    }

    const backup = JSON.parse(backupJsonStr);
    return {
      backup,
      blobs,
      isLegacyJson: false,
    };
  }

  // Backup JSON lama
  try {
    const text = strFromU8(uint8);
    const backup = JSON.parse(text);
    return {
      backup,
      blobs: {},
      isLegacyJson: true,
      warning: 'Backup lama tidak berisi gambar. Unggah ulang PDF-nya untuk memulihkan gambar.',
    };
  } catch (err) {
    throw new Error('File backup tidak valid atau rusak.');
  }
}
