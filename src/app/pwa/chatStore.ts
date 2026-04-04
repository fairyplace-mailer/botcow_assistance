'use client';

import type { ChatStateRef } from '../../backend/contracts/chat';

export type Role = 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
}

export interface StoredChatSession {
  messages: Message[];
  state: ChatStateRef;
}

const DB_NAME = 'botcow';
const DB_VERSION = 2;
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

function normalizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      role: (m as { role?: unknown }).role,
      content: (m as { content?: unknown }).content,
    }))
    .filter((m): m is Message => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES);
}

function normalizeState(value: unknown): ChatStateRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const conversationId = typeof (value as { conversationId?: unknown }).conversationId === 'string'
    ? (value as { conversationId: string }).conversationId
    : undefined;
  const previousResponseId = typeof (value as { previousResponseId?: unknown }).previousResponseId === 'string'
    ? (value as { previousResponseId: string }).previousResponseId
    : undefined;

  return {
    ...(conversationId ? { conversationId } : {}),
    ...(previousResponseId ? { previousResponseId } : {}),
  };
}

export async function loadRecentChatSession(): Promise<StoredChatSession> {
  try {
    return await withStore('readonly', (store) => {
      return new Promise<StoredChatSession>((resolve, reject) => {
        const req = store.get(KEY);
        req.onsuccess = () => {
          const value = req.result;
          if (!value || typeof value !== 'object') {
            resolve({ messages: [], state: {} });
            return;
          }

          resolve({
            messages: normalizeMessages((value as { messages?: unknown }).messages),
            state: normalizeState((value as { state?: unknown }).state),
          });
        };
        req.onerror = () => reject(req.error);
      });
    });
  } catch {
    return { messages: [], state: {} };
  }
}

export async function saveRecentChatSession(session: StoredChatSession): Promise<void> {
  const payload: StoredChatSession = {
    messages: normalizeMessages(session.messages),
    state: normalizeState(session.state),
  };

  try {
    await withStore('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put({ ...payload, updatedAt: Date.now() }, KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  } catch {
    // ignore
  }
}

export async function clearRecentChatSession(): Promise<void> {
  try {
    await withStore('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.delete(KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  } catch {
    // ignore
  }
}
