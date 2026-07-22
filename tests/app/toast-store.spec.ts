import { beforeEach, describe, expect, it } from 'vitest';
import { pushToast, useToastStore } from '../../src/app/store/toastStore';

/**
 * Toast store (MASTER_DOCUMENT §7 "failed op → red chip + toast"): append,
 * dismiss, and the non-hook `pushToast` helper used from services/handlers.
 */

describe('toast store', () => {
  beforeEach(() => {
    // Clear any toasts left by a prior test.
    for (const toast of useToastStore.getState().toasts) {
      useToastStore.getState().dismiss(toast.id);
    }
  });

  it('appends toasts with unique ids and the given kind', () => {
    const a = useToastStore.getState().push('first', 'error');
    const b = useToastStore.getState().push('second');
    expect(a).not.toBe(b);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(2);
    expect(toasts[0]).toMatchObject({ id: a, message: 'first', kind: 'error' });
    expect(toasts[1]).toMatchObject({ id: b, message: 'second', kind: 'info' }); // default kind
  });

  it('dismiss removes exactly one toast by id', () => {
    const a = useToastStore.getState().push('a');
    const b = useToastStore.getState().push('b');
    useToastStore.getState().dismiss(a);
    const ids = useToastStore.getState().toasts.map((toast) => toast.id);
    expect(ids).toEqual([b]);
  });

  it('pushToast helper appends without a hook', () => {
    pushToast('via helper', 'success');
    const last = useToastStore.getState().toasts.at(-1);
    expect(last).toMatchObject({ message: 'via helper', kind: 'success' });
  });
});
