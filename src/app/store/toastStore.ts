import { create } from 'zustand';

/**
 * Transient notifications (MASTER_DOCUMENT §7: "failed op → red chip + toast").
 * A tiny append/dismiss store, written from event handlers and the op-error
 * watcher (`useOpErrorToasts`) — never a source of document truth (R1). The
 * `Toaster` renders the list and auto-dismisses each entry after a delay.
 */

export type ToastKind = 'error' | 'info' | 'success';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly kind: ToastKind;
}

interface ToastStore {
  readonly toasts: readonly Toast[];
  readonly push: (message: string, kind?: ToastKind) => number;
  readonly dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (message, kind = 'info') => {
    const id = nextId;
    nextId += 1;
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }));
    return id;
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

/** Non-hook push, for services and plain event handlers. */
export function pushToast(message: string, kind: ToastKind = 'info'): void {
  useToastStore.getState().push(message, kind);
}
