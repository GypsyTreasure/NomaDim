import type { SketchId } from '../../core';
import type { DocumentState } from '../model';

/**
 * Per-sketch display metadata (Fusion parity: a sketch is visible while you
 * build it, auto-hides the moment a feature consumes it, and can be shown
 * again from the browser tree). Kept OUT of the constraint-ready `Sketch`
 * model — visibility is session-facing display state, not geometry — and
 * lazily materialized exactly like `bodyMeta` (F8): sketches without an entry
 * report `defaultSketchMeta` (visible), so the document stays minimal until
 * the user (or an auto-hide) flips one.
 */
export interface SketchMeta {
  readonly id: SketchId;
  readonly visible: boolean;
}

/** A never-touched sketch shows its preview by default. */
export function defaultSketchMeta(id: SketchId): SketchMeta {
  return { id, visible: true };
}

export function getSketchMeta(state: DocumentState, id: SketchId): SketchMeta {
  return state.sketchMeta.find((m) => m.id === id) ?? defaultSketchMeta(id);
}

/** Upserts one sketch's metadata, returning the next whole list. */
export function upsertSketchMeta(state: DocumentState, meta: SketchMeta): readonly SketchMeta[] {
  const without = state.sketchMeta.filter((m) => m.id !== meta.id);
  return [...without, meta];
}
