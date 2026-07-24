import { create } from 'zustand';
import type { Datum, DatumKind } from '../../document';

/**
 * Construction-geometry editor state (ARCHITECTURE §5): which creation/edit
 * dialog is open, and the live preview datum shown as an amber ghost in the
 * viewport while the user tweaks fields (Fusion-style preview). Transient —
 * never persisted, not part of undo history.
 */
interface ConstructStore {
  /** Open dialog: the kind to create/edit, and the datum being edited (null = create). */
  readonly open: { readonly kind: DatumKind; readonly editing: Datum | null } | null;
  /** Live preview of the in-progress datum (amber ghost); null when idle. */
  readonly preview: Datum | null;
  readonly openCreate: (kind: DatumKind) => void;
  readonly openEdit: (datum: Datum) => void;
  readonly close: () => void;
  readonly setPreview: (datum: Datum | null) => void;
}

export const useConstructStore = create<ConstructStore>((set) => ({
  open: null,
  preview: null,
  openCreate: (kind) => {
    set({ open: { kind, editing: null }, preview: null });
  },
  openEdit: (datum) => {
    set({ open: { kind: datum.kind, editing: datum }, preview: null });
  },
  close: () => {
    set({ open: null, preview: null });
  },
  setPreview: (datum) => {
    set({ preview: datum });
  },
}));
