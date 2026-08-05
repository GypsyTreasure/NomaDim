import { documentFromXml, documentToXml, type DocumentState } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { getSettings } from '../../store/settingsStore';

/**
 * Client-side autosave (ARCHITECTURE §7: static-host, no backend). The whole
 * document is serialized through the existing `.nomadim.xml` codec and mirrored
 * into `localStorage` on every change, then restored on the next load — so a
 * page refresh (or a mobile browser silently discarding a backgrounded tab)
 * resumes exactly where the user left off instead of a blank project.
 *
 * This is a persistence mirror, not a second write path: restore replays the
 * document through `commandBus.loadDocument` (the same load→regen path as
 * File → Open), and saves only observe the store — never mutate it.
 */

const STORAGE_KEY = 'nomadim.document.v1';
/** When the autosave was last written (epoch ms) — drives the retention TTL. */
const SAVED_AT_KEY = 'nomadim.document.savedAt';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Coalesce bursts of edits (keystroke-fast entry) into one write. */
const DEBOUNCE_MS = 400;

/** localStorage can throw (Safari private mode, disabled storage) — never let that break the app. */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Restore the last autosaved document, if any. Call ONCE before `startRegen()`
 * so the scheduler's initial regen rebuilds bodies from the restored timeline.
 * A parse failure (corrupt data, or a document written by a newer schema) is
 * swallowed — better to start fresh than to crash on load.
 */
export function restorePersistedDocument(): void {
  const storage = safeStorage();
  const xml = storage?.getItem(STORAGE_KEY);
  if (!xml) return;
  // Retention TTL (Admin panel): if the last save is older than the configured
  // number of days, drop it so the user opens a fresh project instead of a
  // stale one. `null` TTL (the default) keeps the project forever.
  const ttlDays = getSettings().autosaveTtlDays;
  if (ttlDays !== null && ttlDays > 0) {
    const savedAt = Number(storage?.getItem(SAVED_AT_KEY) ?? '');
    if (Number.isFinite(savedAt) && savedAt > 0 && Date.now() - savedAt > ttlDays * MS_PER_DAY) {
      clearPersistedDocument();
      return;
    }
  }
  const result = documentFromXml(xml);
  if (!result.ok) return;
  commandBus.loadDocument(result.value);
}

/** Erase the autosaved document (New Project). The next load starts blank. */
export function clearPersistedDocument(): void {
  try {
    const storage = safeStorage();
    storage?.removeItem(STORAGE_KEY);
    storage?.removeItem(SAVED_AT_KEY);
  } catch {
    // Storage blocked — nothing to clear.
  }
}

function persist(doc: DocumentState): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, documentToXml(doc));
    storage.setItem(SAVED_AT_KEY, String(Date.now()));
  } catch {
    // Quota exceeded or storage blocked mid-session — autosave is best-effort.
  }
}

/**
 * Mirror every document change into `localStorage` (debounced), and flush
 * immediately when the page is hidden or unloading — mobile browsers can freeze
 * or kill a backgrounded tab without emitting further events, so the pending
 * write must land before the tab goes away. Returns an unsubscribe/teardown.
 *
 * The hide flush is the mobile-critical path: iOS Safari fires `visibilitychange`
 * (on `document` — NOT `window`, where it never fires) the instant the app is
 * backgrounded, which is typically the last event before the OS reclaims the
 * tab's memory and kills it. `pagehide` covers bfcache/navigation. Getting this
 * right is what makes a mid-work crash lossless.
 */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: DocumentState | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending !== null) {
      persist(pending);
      pending = null;
    }
  };

  const unsubscribe = useDocumentStore.subscribe((state, prev) => {
    if (state.document === prev.document) return;
    pending = state.document;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });

  // visibilitychange fires on document; pagehide on window. Both flush so the
  // last edit lands before a backgrounded mobile tab is discarded/killed.
  document.addEventListener('visibilitychange', flush);
  window.addEventListener('pagehide', flush);

  return () => {
    flush();
    unsubscribe();
    document.removeEventListener('visibilitychange', flush);
    window.removeEventListener('pagehide', flush);
  };
}
