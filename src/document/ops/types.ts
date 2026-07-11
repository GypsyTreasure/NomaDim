import type { BodyId, EntityId, OpId, ProfileId, SketchId } from '../../core';

/**
 * Timeline operation model (MASTER_DOCUMENT F1/F3, ARCHITECTURE §7-§9).
 * The timeline is a multi-body DAG evaluated by the worker over a
 * BodyStateMap — never assume a linear single-body chain. Ops are plain
 * serializable data; each OpType's behavior lives in the three registries
 * (document codec, worker executor, app feature) keyed by this union.
 */

export type OpType = 'Sketch' | 'Extrude' | 'Revolve';

interface OpBase {
  readonly id: OpId;
  readonly type: OpType;
  readonly name: string;
  readonly suppressed: boolean;
}

/** Sketch as a timeline citizen: geometry lives in DocumentState.sketches. */
export interface SketchOp extends OpBase {
  readonly type: 'Sketch';
  readonly sketchId: SketchId;
}

export type BooleanOperation = 'NewBody' | 'Join' | 'Cut' | 'Intersect';

export type ExtrudeDirection = 'one-side' | 'symmetric' | 'two-sides';

export interface ExtrudeOp extends OpBase {
  readonly type: 'Extrude';
  readonly sketchId: SketchId;
  readonly profileIds: readonly ProfileId[];
  readonly distanceMm: number;
  readonly direction: ExtrudeDirection;
  /** Second-side distance; only meaningful for direction 'two-sides'. */
  readonly distance2Mm: number;
  readonly operation: BooleanOperation;
  /** Target for Join/Cut/Intersect; ignored for NewBody. */
  readonly targetBodyId: BodyId | null;
  /** Minted at creation (§8) — the produced body for NewBody, stable across regens. */
  readonly bodyId: BodyId;
}

/** Revolve axis: a line of the SAME sketch (dependency containment, ADR-0007) or an origin axis. */
export type RevolveAxis =
  | { readonly kind: 'entity'; readonly entityId: EntityId }
  | { readonly kind: 'origin'; readonly axis: 'X' | 'Y' | 'Z' };

export interface RevolveOp extends OpBase {
  readonly type: 'Revolve';
  readonly sketchId: SketchId;
  readonly profileIds: readonly ProfileId[];
  readonly axis: RevolveAxis;
  readonly angleDeg: number;
  readonly operation: BooleanOperation;
  readonly targetBodyId: BodyId | null;
  readonly bodyId: BodyId;
}

export type TimelineOp = SketchOp | ExtrudeOp | RevolveOp;

/** Dependency semantics consumed by dirty tracking and suppression skipping. */
export interface OpDependencies {
  /** Bodies this op creates when it runs (absent from the map when suppressed). */
  readonly producesBodies: readonly BodyId[];
  /** Bodies this op reads/modifies — absent input ⇒ op enters 'skipped'. */
  readonly consumesBodies: readonly BodyId[];
  /** Sketch whose edits dirty this op. */
  readonly consumesSketch: SketchId | null;
  /**
   * Sketch this op IS (the Sketch op); null for consumers. Lets the regen
   * planner mark downstream ops `inputsSuppressed` when the producing Sketch
   * op is suppressed — no per-op type switch needed (R4).
   */
  readonly producesSketch: SketchId | null;
}
