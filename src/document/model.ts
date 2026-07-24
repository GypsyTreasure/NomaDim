import type { Sketch } from './sketch/types';
import type { SketchMeta } from './sketch/meta';
import type { TimelineOp } from './ops/types';
import type { BodyMeta } from './bodies/types';
import type { Datum } from './datums/types';

/**
 * Document root (ARCHITECTURE §5: shape defined here, held by the Zustand
 * `documentStore` in app/store).
 */
export interface DocumentState {
  readonly sketches: readonly Sketch[];
  /** The timeline — a multi-body DAG evaluated in order (§9). */
  readonly ops: readonly TimelineOp[];
  /**
   * Rollback marker (F1): ops at index >= rollbackIndex exist and serialize
   * but never evaluate. New ops insert AT the marker; it advances past them.
   */
  readonly rollbackIndex: number;
  /** Per-body name/colour/visibility (F8); lazily materialized on edit. */
  readonly bodyMeta: readonly BodyMeta[];
  /** Per-sketch visibility (preview shown until consumed); lazily materialized. */
  readonly sketchMeta: readonly SketchMeta[];
  /** Construction geometry (datum planes & axes) — reusable reference geometry. */
  readonly datums: readonly Datum[];
}

export function emptyDocument(): DocumentState {
  return { sketches: [], ops: [], rollbackIndex: 0, bodyMeta: [], sketchMeta: [], datums: [] };
}

export function findSketch(state: DocumentState, sketchId: string): Sketch | undefined {
  return state.sketches.find((s) => s.id === sketchId);
}
