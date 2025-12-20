'use client';

export type Role = 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
}

const DB_NAME = 'botcow';
const DB_VERSION = 1;
const STORE = 'chat';
const KEY = 'recent';
const MAX_MESSAGES = 20;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = await fn(store);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

export async function loadRecentMessages(): Promise<Message[]> {
  try {
    return await withStore('readonly', (store) => {
      return new Promise<Message[]>((resolve, reject) => {
        const req = store.get(KEY);
        req.onsuccess = () => {
          const value = req.result;
          if (!value || typeof value !== 'object') return resolve([]);
          const arr = (value as any).messages;
          if (!Array.isArray(arr)) return resolve([]);
          resolve(
            arr
              .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
              .slice(-MAX_MESSAGES),
          );
        };
        req.onerror = () => reject(req.error);
      });
    });
  } catch {
    return [];
  }
}

export async function saveRecentMessages(messages: Message[]): Promise<void> {
  const trimmed = (Array.isArray(messages) ? messages : []).slice(-MAX_MESSAGES);
  try {
    await withStore('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put({ messages: trimmed, updatedAt: Date.now() }, KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  } catch {
    // ignore (best-effort)
  }
}

export async function clearRecentMessages(): Promise<void> {
  try {
    await withStore('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.delete(KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  } catch {
    // ignore (best-effort)
  }
}
