import { documentFromXml, documentToXml, type DocumentState } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';

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
  const xml = safeStorage()?.getItem(STORAGE_KEY);
  if (!xml) return;
  const result = documentFromXml(xml);
  if (!result.ok) return;
  commandBus.loadDocument(result.value);
}

/** Erase the autosaved document (New Project). The next load starts blank. */
export function clearPersistedDocument(): void {
  try {
    safeStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked — nothing to clear.
  }
}

function persist(doc: DocumentState): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, documentToXml(doc));
  } catch {
    // Quota exceeded or storage blocked mid-session — autosave is best-effort.
  }
}

/**
 * Mirror every document change into `localStorage` (debounced), and flush
 * immediately when the page is hidden or unloading — mobile browsers can freeze
 * or kill a backgrounded tab without emitting further events, so the pending
 * write must land before the tab goes away. Returns an unsubscribe/teardown.
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

  window.addEventListener('visibilitychange', flush);
  window.addEventListener('pagehide', flush);

  return () => {
    flush();
    unsubscribe();
    window.removeEventListener('visibilitychange', flush);
    window.removeEventListener('pagehide', flush);
  };
}
