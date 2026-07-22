import { create } from 'zustand';
import type { MeshTransfer } from '../../kernel';

/**
 * F3 live ghost preview: the translucent meshes an open Extrude/Revolve dialog
 * would produce, recomputed as its parameters change. Display-only — never a
 * document source of truth (R1), never persisted. The dialog writes it via the
 * `usePreview` hook; the Viewport renders it as ghost bodies and clears it when
 * the dialog closes.
 */
interface PreviewStore {
  readonly ghosts: MeshTransfer[];
  readonly setGhosts: (ghosts: MeshTransfer[]) => void;
  readonly clear: () => void;
}

export const usePreviewStore = create<PreviewStore>((set) => ({
  ghosts: [],
  setGhosts: (ghosts) => {
    set({ ghosts });
  },
  clear: () => {
    set({ ghosts: [] });
  },
}));
