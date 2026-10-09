import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Book, Highlight } from '../types/book';

interface AppDB extends DBSchema {
  books: {
    key: string;
    value: Book;
  };
  blobs: {
    key: string;
    value: Blob;
  };
  highlights: {
    key: string;
    value: Highlight;
    indexes: { 'by-book': string };
  };
}

let dbPromise: Promise<IDBPDatabase<AppDB>>;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>('pembaca-nyaman', 2, {
      upgrade(db, oldVersion, _newVersion, _transaction) {
        if (oldVersion < 1) {
          db.createObjectStore('books', { keyPath: 'id' });
          db.createObjectStore('blobs');
        }
        if (oldVersion < 2) {
          const hlStore = db.createObjectStore('highlights', { keyPath: 'id' });
          hlStore.createIndex('by-book', 'bookId');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveBook(book: Book) {
  const db = await getDB();
  await db.put('books', book);
}

export async function getBook(id: string): Promise<Book | undefined> {
  const db = await getDB();
  return db.get('books', id);
}

export async function getAllBooks(): Promise<Book[]> {
  const db = await getDB();
  return db.getAll('books');
}

export async function saveBlob(key: string, blob: Blob) {
  const db = await getDB();
  await db.put('blobs', blob, key);
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const db = await getDB();
  return db.get('blobs', key);
}

export async function saveHighlight(hl: Highlight) {
  const db = await getDB();
  await db.put('highlights', hl);
}

export async function deleteHighlight(id: string) {
  const db = await getDB();
  await db.delete('highlights', id);
}

export async function getHighlightsByBook(bookId: string): Promise<Highlight[]> {
  const db = await getDB();
  return db.getAllFromIndex('highlights', 'by-book', bookId);
}
