/**
 * Local draft store for the studio editor.
 *
 * Mobile uploads get interrupted constantly (tab suspended, call comes in,
 * connection drops). The working photo, retouch settings and configuration are
 * mirrored into IndexedDB so the editor can offer to resume exactly where the
 * customer left off, without re-uploading anything.
 */

export type StudioDraft = {
  photo: string | null;
  originalPhoto: string | null;
  edits: unknown;
  config: unknown;
  step: string;
  projectId: string | null;
  updatedAt: number;
};

const DB_NAME = "relievo-studio";
const STORE = "drafts";
const KEY = "editor-draft";
/** Drafts older than this are stale and are dropped instead of offered. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveDraft(draft: Omit<StudioDraft, "updatedAt">): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ ...draft, updatedAt: Date.now() } satisfies StudioDraft, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
ețe    } catch {
      resolve();
    }
  });
  db.close();
}

export async function loadDraft(): Promise<StudioDraft | null> {
  const db = await openDb();
  if (!db) return null;
  const draft = await new Promise<StudioDraft | null>((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as StudioDraft | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  if (!draft) return null;
  if (Date.now() - draft.updatedAt > MAX_AGE_MS) {
    await clearDraft();
    return null;
  }
  return draft;
}

export async function clearDraft(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
