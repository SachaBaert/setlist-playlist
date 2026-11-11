// IndexedDB cache of the normalized history, so the stats load without
// uploading the export again. Stays on this device.
import type { CachedStream } from './cache';

const DB = 'setlist-stats';
const STORE = 'cache';
const KEY = 'history';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadCache(): Promise<CachedStream[] | null> {
  try {
    const v = await run<{ streams: CachedStream[] } | undefined>('readonly', (s) => s.get(KEY));
    return v?.streams?.length ? v.streams : null;
  } catch {
    return null; // private mode or storage blocked: just no cache
  }
}

export async function saveCache(streams: CachedStream[]): Promise<void> {
  await run('readwrite', (s) => s.put({ streams, savedAt: Date.now() }, KEY));
  // Ask the browser not to evict it under storage pressure (best effort).
  await navigator.storage?.persist?.().catch(() => false);
}

export async function forgetCache(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
