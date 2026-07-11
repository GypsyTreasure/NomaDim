import { create } from 'zustand';
import { emptyDocument, type DocumentState } from '../../document';
import { CommandBus, type DocumentHost } from '../../services';

/**
 * documentStore (ARCHITECTURE §5): owns timeline ops + sketches. Data shape
 * lives in document/; this store only hosts it for React. Components READ
 * via selectors — all writes go through `commandBus.dispatch` (R1).
 */

interface DocumentStore {
  readonly document: DocumentState;
  /** Internal setter used by the CommandBus host adapter — never call from components. */
  readonly __setDocument: (state: DocumentState) => void;
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  document: emptyDocument(),
  __setDocument: (state) => {
    set({ document: state });
  },
}));

const host: DocumentHost = {
  getDocument: () => useDocumentStore.getState().document,
  setDocument: (state) => {
    useDocumentStore.getState().__setDocument(state);
  },
};

/** The app-wide single write path (one bus per document/tab). */
export const commandBus = new CommandBus(host);
