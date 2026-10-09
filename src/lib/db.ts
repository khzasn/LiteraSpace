import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Book } from '../types/book';

interface AppDB extends DBSchema {
  books: {
    key: string;
    value: Book;
  };
  blobs: {
    key: string;
    value: Blob;
  };
}

let dbPromise: Promise<IDBPDatabase<AppDB>>;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>('pembaca-nyaman', 1, {
      upgrade(db) {
        db.createObjectStore('books', { keyPath: 'id' });
        db.createObjectStore('blobs');
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
