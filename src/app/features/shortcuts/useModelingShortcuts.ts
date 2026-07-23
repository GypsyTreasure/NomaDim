import { useEffect } from 'react';
import type { OpType } from '../../../document';

/**
 * Non-sketch keyboard shortcuts for the modeling menus (project master rule,
 * ADR-0032): New Sketch, Measure, and the six create-ops. Bound only while a
 * sketch is NOT being edited (the sketcher owns keystrokes then) and never
 * while typing in a field. Save/Open/Export and view navigation live with
 * their own components; this covers the app + timeline action buttons.
 */

export interface ModelingShortcutActions {
  readonly newSketch: () => void;
  readonly toggleMeasure: () => void;
  readonly createOp: (type: OpType) => void;
  /** Mirrors the create buttons' disabled state (need a sketch first). */
  readonly hasSketch: boolean;
}

/** Letter → create-op, matching the timeline toolbar order. */
const OP_KEYS: Readonly<Record<string, OpType>> = {
  e: 'Extrude',
  v: 'Revolve',
  f: 'Fillet',
  h: 'Chamfer',
  b: 'Combine',
  d: 'CopyBody',
  i: 'Mirror',
  p: 'Pattern',
  l: 'Shell',
};

export function useModelingShortcuts(active: boolean, actions: ModelingShortcutActions): void {
  const { newSketch, toggleMeasure, createOp, hasSketch } = actions;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        // Shift is reserved for other actions (e.g. Shift+N = New Project); none
        // of these single-letter shortcuts use it.
        event.shiftKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'n') {
        newSketch();
        return;
      }
      if (key === 'm') {
        toggleMeasure();
        return;
      }
      const op = OP_KEYS[key];
      if (op && hasSketch) createOp(op);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [active, newSketch, toggleMeasure, createOp, hasSketch]);
}
