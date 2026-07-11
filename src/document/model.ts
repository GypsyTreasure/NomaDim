import type { Sketch } from './sketch/types';

/**
 * Document root (ARCHITECTURE §5: shape defined here, held by the Zustand
 * `documentStore` in app/store). M2 scope: sketches only — the operation
 * timeline, body metadata, and rollback position join this shape in M3.
 */
export interface DocumentState {
  readonly sketches: readonly Sketch[];
}

export function emptyDocument(): DocumentState {
  return { sketches: [] };
}

export function findSketch(state: DocumentState, sketchId: string): Sketch | undefined {
  return state.sketches.find((s) => s.id === sketchId);
}
