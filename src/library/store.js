// Keeps imported songs in IndexedDB so the library survives reloads.

const DB_NAME = 'fretline';
const STORE = 'songs';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** @param {import('./loader.js').SongPackage} pkg */
export function saveSong(pkg) {
  return run('readwrite', (s) => s.put({ ...pkg, addedAt: Date.now() }));
}

export function deleteSong(id) {
  return run('readwrite', (s) => s.delete(id));
}

/** @returns {Promise<import('./loader.js').SongPackage[]>} */
export async function listSongs() {
  const all = (await run('readonly', (s) => s.getAll())) ?? [];
  return all.sort((a, b) => a.meta.artist.localeCompare(b.meta.artist) || a.meta.name.localeCompare(b.meta.name));
}

/** Ask the browser not to evict stored songs under storage pressure (best effort). */
export function requestPersistentStorage() {
  return navigator.storage?.persist?.().catch(() => false);
}
