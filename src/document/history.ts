import { UNDO_STACK_MIN_DEPTH } from '../core';
import type { DocumentState } from './model';
import type { Sketch } from './sketch/types';
import type { SketchMeta } from './sketch/meta';
import type { BodyMeta } from './bodies/types';

/**
 * Undo/redo (ARCHITECTURE §4 R2): every command produces exactly one
 * Transaction, stored as inverse patches. M2 patches replace whole sketches
 * — sketches are small and this is trivially correct; finer patches can
 * arrive later without changing this contract. Applying a history entry
 * flows through the same dirty-mark path as the original transaction (the
 * bus re-emits changes identically — no second sync mechanism).
 */

export interface SketchPatch {
  readonly kind: 'replaceSketch';
  readonly sketchId: string;
  /** null = sketch absent on that side (create/delete). */
  readonly before: Sketch | null;
  readonly after: Sketch | null;
}

/** Whole-timeline replacement — ops are small; correctness beats granularity. */
export interface TimelinePatch {
  readonly kind: 'replaceTimeline';
  readonly before: TimelineSnapshot;
  readonly after: TimelineSnapshot;
}

export interface TimelineSnapshot {
  readonly ops: DocumentState['ops'];
  readonly rollbackIndex: number;
}

/** Whole body-metadata replacement (F8) — the list is tiny, one row per body. */
export interface BodyMetaPatch {
  readonly kind: 'replaceBodyMeta';
  readonly before: readonly BodyMeta[];
  readonly after: readonly BodyMeta[];
}

/** Whole sketch-metadata replacement (sketch visibility) — one row per sketch. */
export interface SketchMetaPatch {
  readonly kind: 'replaceSketchMeta';
  readonly before: readonly SketchMeta[];
  readonly after: readonly SketchMeta[];
}

export type DocumentPatch = SketchPatch | TimelinePatch | BodyMetaPatch | SketchMetaPatch;

export interface Transaction {
  readonly label: string;
  readonly patches: readonly DocumentPatch[];
}

export interface HistoryState {
  readonly undoStack: readonly Transaction[];
  readonly redoStack: readonly Transaction[];
}

export const emptyHistory: HistoryState = { undoStack: [], redoStack: [] };

const HISTORY_CAPACITY = UNDO_STACK_MIN_DEPTH * 2; // 100 — comfortably ≥ the required 50

export function pushTransaction(history: HistoryState, transaction: Transaction): HistoryState {
  const undoStack = [...history.undoStack, transaction].slice(-HISTORY_CAPACITY);
  return { undoStack, redoStack: [] };
}

function applyPatches(
  state: DocumentState,
  patches: readonly DocumentPatch[],
  direction: 'forward' | 'inverse'
): DocumentState {
  let next = state;
  for (const patch of patches) {
    switch (patch.kind) {
      case 'replaceSketch': {
        const target = direction === 'forward' ? patch.after : patch.before;
        const without = next.sketches.filter((s) => s.id !== patch.sketchId);
        next = { ...next, sketches: target ? [...without, target] : without };
        break;
      }
      case 'replaceTimeline': {
        const target = direction === 'forward' ? patch.after : patch.before;
        next = { ...next, ops: target.ops, rollbackIndex: target.rollbackIndex };
        break;
      }
      case 'replaceBodyMeta': {
        next = { ...next, bodyMeta: direction === 'forward' ? patch.after : patch.before };
        break;
      }
      case 'replaceSketchMeta': {
        next = { ...next, sketchMeta: direction === 'forward' ? patch.after : patch.before };
        break;
      }
      default: {
        const exhaustive: never = patch;
        return exhaustive;
      }
    }
  }
  return next;
}

export function applyTransaction(state: DocumentState, transaction: Transaction): DocumentState {
  return applyPatches(state, transaction.patches, 'forward');
}

export function undo(
  state: DocumentState,
  history: HistoryState
): { state: DocumentState; history: HistoryState; undone: Transaction } | null {
  const transaction = history.undoStack[history.undoStack.length - 1];
  if (!transaction) return null;
  return {
    state: applyPatches(state, transaction.patches, 'inverse'),
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, transaction],
    },
    undone: transaction,
  };
}

export function redo(
  state: DocumentState,
  history: HistoryState
): { state: DocumentState; history: HistoryState; redone: Transaction } | null {
  const transaction = history.redoStack[history.redoStack.length - 1];
  if (!transaction) return null;
  return {
    state: applyPatches(state, transaction.patches, 'forward'),
    history: {
      undoStack: [...history.undoStack, transaction],
      redoStack: history.redoStack.slice(0, -1),
    },
    redone: transaction,
  };
}
