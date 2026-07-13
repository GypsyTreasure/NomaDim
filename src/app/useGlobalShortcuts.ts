import { useEffect, useRef } from 'react';
import { createId, type BodyId } from '../core';
import type { CopyBodyOp } from '../document';
import { commandBus, useDocumentStore } from './store/documentStore';
import { useSessionStore } from './store/sessionStore';
import { existingIds, mintName } from './features/timeline/dialogData';

/**
 * Global (non-sketch) keyboard shortcuts: undo/redo and whole-body
 * copy/paste (F9). Disabled while a sketch is active — the sketcher owns
 * keystrokes then — and while typing in a form field. Ctrl+C stores the
 * selected body; Ctrl+V appends a CopyBody op at the rollback marker.
 */
export function useGlobalShortcuts(sketchActive: boolean): void {
  const clipboard = useRef<BodyId | null>(null);

  useEffect(() => {
    if (sketchActive) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key === 'z') {
        event.preventDefault();
        commandBus.undo();
      } else if (ctrl && event.key === 'y') {
        event.preventDefault();
        commandBus.redo();
      } else if (ctrl && event.key === 'c') {
        clipboard.current = useSessionStore.getState().selectedBodyId;
      } else if (ctrl && event.key === 'v') {
        pasteBody(clipboard.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sketchActive]);
}

function pasteBody(sourceBodyId: BodyId | null): void {
  if (!sourceBodyId) return;
  const doc = useDocumentStore.getState().document;
  const ids = existingIds(doc);
  const op: CopyBodyOp = {
    type: 'CopyBody',
    id: createId<'OpId'>(ids),
    name: mintName(doc, 'Copy'),
    suppressed: false,
    sourceBodyId,
    translate: [0, 0, 0],
    bodyId: createId<'BodyId'>(ids),
  };
  commandBus.dispatch({ type: 'AddOp', payload: { op } });
}
