import { useEffect, useRef } from 'react';
import type { TimelineOp } from '../../../document';
import type { PlanOp } from '../../../kernel';
import { OP_PLAN_RESOLVERS } from '../../../services';
import { useDocumentStore } from '../../store/documentStore';
import { getKernelClient } from '../../store/kernelStore';
import { usePreviewStore } from '../../store/previewStore';

/**
 * F3 live ghost preview: given the prospective op an open dialog would create,
 * resolve its inputs (profiles / axis) on the main thread and ask the kernel for
 * a throwaway mesh of the bodies it would change, then publish that to the
 * preview store for the Viewport to render translucently. Debounced so dragging
 * a value doesn't flood the worker; only the latest result is applied; the store
 * is cleared when the dialog closes (draft becomes null) or on unmount.
 *
 * Preview is for NEW ops only — an edit's live regen already shows its effect.
 */
const DEBOUNCE_MS = 120;

export function usePreview(draft: TimelineOp | null): void {
  const setGhosts = usePreviewStore((s) => s.setGhosts);
  const clear = usePreviewStore((s) => s.clear);
  const seq = useRef(0);
  // Serialize the draft so the effect only re-fires on a real parameter change,
  // not on every render's fresh object identity.
  const key = draft ? JSON.stringify(draft) : null;

  useEffect(() => {
    if (!draft) {
      clear();
      return;
    }
    const client = getKernelClient();
    if (!client) return;
    const requestId = seq.current + 1;
    seq.current = requestId;
    const handle = window.setTimeout(() => {
      const doc = useDocumentStore.getState().document;
      const inputs = OP_PLAN_RESOLVERS[draft.type].resolve(doc, draft);
      const planOp: PlanOp = {
        op: draft,
        profiles: inputs.profiles,
        axisWorld: inputs.axisWorld,
        inputsSuppressed: false,
      };
      client.preview(planOp).then(
        (ghosts) => {
          if (seq.current === requestId) setGhosts(ghosts);
        },
        () => {
          if (seq.current === requestId) clear();
        }
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
    };
    // `key` captures every meaningful field of `draft`; re-run when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, clear, setGhosts]);

  // Clear on unmount (dialog closed) so a stale ghost never lingers.
  useEffect(() => {
    return () => {
      usePreviewStore.getState().clear();
    };
  }, []);
}
