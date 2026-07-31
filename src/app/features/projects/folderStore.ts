import { create } from 'zustand';

/**
 * Local project folder (ADR-0089). Lets a professional user point NomaDim at a
 * real directory on their machine — a workshop's shared drive, a job folder —
 * and Save / list / re-open `.nomadim.xml` projects there, with no backend
 * (static-host safe). Built on the File System Access API; the granted
 * directory handle is persisted in IndexedDB (handles are structured-clonable
 * but NOT JSON-serializable, so localStorage can't hold them) and re-authorized
 * on the next visit.
 *
 * Chromium-only. `isFolderAccessSupported()` gates every entry point; on Safari
 * / Firefox the Settings row and PROJECTS button explain the requirement rather
 * than offering a broken control.
 */

const PROJECT_EXT = '.nomadim.xml';

const DB_NAME = 'nomadim.fs';
const DB_STORE = 'handles';
const HANDLE_KEY = 'projectFolder';

export interface ProjectFile {
  /** File name including the `.nomadim.xml` extension. */
  readonly name: string;
  /** Display name with the extension stripped. */
  readonly label: string;
}

/** True when this browser exposes the File System Access directory picker. */
export function isFolderAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('indexedDB open failed'));
    };
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('indexedDB get failed'));
    };
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('indexedDB put failed'));
    };
  });
}

async function persistHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  try {
    const db = await openDb();
    await idbPut(db, HANDLE_KEY, handle);
    db.close();
  } catch {
    /* IndexedDB blocked (private mode) — the folder just won't survive reload */
  }
}

async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  interactive: boolean
): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  const query = await handle.queryPermission?.(opts);
  if (query === 'granted') return true;
  if (!interactive) return false;
  const request = await handle.requestPermission?.(opts);
  return request === 'granted';
}

interface FolderStore {
  /** The chosen directory, once authorized this session; null when none/denied. */
  readonly handle: FileSystemDirectoryHandle | null;
  /** Folder display name for the Settings row; null when none chosen. */
  readonly name: string | null;
  /** Opens the OS directory picker and stores the grant (interactive). */
  readonly choose: () => Promise<void>;
  /** Forgets the folder (clears the persisted handle). */
  readonly clear: () => Promise<void>;
  /** Re-authorizes the persisted handle silently on startup; no prompt. */
  readonly restore: () => Promise<void>;
  /** Lists `.nomadim.xml` files in the folder, sorted by name. */
  readonly list: () => Promise<ProjectFile[]>;
  /** Reads a project file's text by name. */
  readonly read: (name: string) => Promise<string>;
  /** Writes text to `name`, creating or overwriting it. */
  readonly save: (name: string, text: string) => Promise<void>;
}

export const useFolderStore = create<FolderStore>((set, get) => ({
  handle: null,
  name: null,

  choose: async () => {
    if (!isFolderAccessSupported() || !window.showDirectoryPicker) return;
    const handle = await window.showDirectoryPicker({ id: 'nomadim-projects', mode: 'readwrite' });
    const granted = await ensurePermission(handle, true);
    if (!granted) return;
    await persistHandle(handle);
    set({ handle, name: handle.name });
  },

  clear: async () => {
    await persistHandle(null);
    set({ handle: null, name: null });
  },

  restore: async () => {
    if (!isFolderAccessSupported()) return;
    try {
      const db = await openDb();
      const stored = await idbGet(db, HANDLE_KEY);
      db.close();
      if (!stored || !(stored instanceof FileSystemDirectoryHandle)) return;
      // Silent re-check only — never prompt on startup (would be a popup on
      // load). Keep the handle either way so the folder name shows and the
      // first interactive Save/list can re-request permission.
      await ensurePermission(stored, false);
      set({ handle: stored, name: stored.name });
    } catch {
      /* handle unreadable — leave folder unset */
    }
  },

  list: async () => {
    const { handle } = get();
    if (!handle) return [];
    if (!(await ensurePermission(handle, true))) return [];
    const files: ProjectFile[] = [];
    for await (const entry of handle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith(PROJECT_EXT)) {
        files.push({ name: entry.name, label: entry.name.slice(0, -PROJECT_EXT.length) });
      }
    }
    files.sort((a, b) => a.label.localeCompare(b.label));
    return files;
  },

  read: async (name) => {
    const { handle } = get();
    if (!handle) throw new Error('no project folder');
    const fileHandle = await handle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return file.text();
  },

  save: async (name, text) => {
    const { handle } = get();
    if (!handle) throw new Error('no project folder');
    if (!(await ensurePermission(handle, true))) throw new Error('folder permission denied');
    const fileHandle = await handle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  },
}));

/** The `.nomadim.xml` extension, shared with the save UI. */
export { PROJECT_EXT };
