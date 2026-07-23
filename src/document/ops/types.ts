import type { BodyId, EntityId, OpId, ProfileId, SketchId } from '../../core';

/**
 * Timeline operation model (MASTER_DOCUMENT F1/F3, ARCHITECTURE §7-§9).
 * The timeline is a multi-body DAG evaluated by the worker over a
 * BodyStateMap — never assume a linear single-body chain. Ops are plain
 * serializable data; each OpType's behavior lives in the three registries
 * (document codec, worker executor, app feature) keyed by this union.
 */

export type OpType =
  | 'Sketch'
  | 'Extrude'
  | 'Revolve'
  | 'Fillet'
  | 'Chamfer'
  | 'Combine'
  | 'CopyBody'
  | 'Mirror'
  | 'Pattern';

/** Placement/array ops keep the source body (NewBody) or fuse into it (Join). */
export type TransformOperation = 'NewBody' | 'Join';

/** World origin plane / axis a transform op works about. */
export type OriginPlane = 'XY' | 'XZ' | 'YZ';
export type OriginAxis = 'X' | 'Y' | 'Z';

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

export type ExtrudeDirection = 'one-side' | 'symmetric' | 'two-sides' | 'all';

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

/**
 * Persistent 3D edge reference (ARCHITECTURE §8, line 160): a geometric
 * fingerprint resolved against the input body AT REGEN, never a topology
 * index. A geometric edit that keeps the edge re-resolves it; an edit that
 * removes it → the op enters error state and the user re-picks (accepted v1
 * tradeoff, MASTER_DOCUMENT §4). All coordinates are world-space (mm).
 */
export interface EdgeFingerprint {
  readonly midpoint: readonly [number, number, number];
  /** Edge tangent at the midpoint, normalized; sign-normalized on resolve. */
  readonly direction: readonly [number, number, number];
  /** Sorted surface-kind tags of the ≤2 adjacent faces (disambiguates matches). */
  readonly adjFaceKinds: readonly string[];
  /** Match tolerance (mm) for midpoint proximity. */
  readonly tolMm: number;
}

/** Fillet (F4): rounds picked edges of ONE body by a single radius. */
export interface FilletOp extends OpBase {
  readonly type: 'Fillet';
  /** Body being filleted — modified in place (its id is unchanged, §9). */
  readonly bodyId: BodyId;
  readonly edges: readonly EdgeFingerprint[];
  readonly radiusMm: number;
}

/** Chamfer (F4): equal-distance bevel of picked edges of ONE body. */
export interface ChamferOp extends OpBase {
  readonly type: 'Chamfer';
  readonly bodyId: BodyId;
  readonly edges: readonly EdgeFingerprint[];
  readonly distanceMm: number;
}

/** Combine operation (F5): body-to-body boolean — never creates a new body. */
export type CombineOperation = 'Join' | 'Cut' | 'Intersect';

/** Combine (F5): target body + tool bodies → Join/Cut/Intersect, keep-tools option. */
export interface CombineOp extends OpBase {
  readonly type: 'Combine';
  readonly targetBodyId: BodyId;
  readonly toolBodyIds: readonly BodyId[];
  readonly operation: CombineOperation;
  /** When true, tool bodies remain after the combine (Fusion "Keep Tools"). */
  readonly keepTools: boolean;
}

/**
 * Copy/Paste a whole body (F9). Parametric + positional: at regen the copy
 * reproduces the source body AS OF this op's timeline position (the worker
 * evaluates it against the live BodyStateMap), so edits to earlier ops flow
 * into the copy while later ops do not. Optional XYZ translation (mm).
 */
export interface CopyBodyOp extends OpBase {
  readonly type: 'CopyBody';
  readonly sourceBodyId: BodyId;
  readonly translate: readonly [number, number, number];
  /** Euler XYZ rotation in degrees, applied about the world origin before the
   * translation. Defaults to [0,0,0] (a pure copy) for back-compat. */
  readonly rotate: readonly [number, number, number];
  /** Minted at creation — the produced copy, stable across regens (§8). */
  readonly bodyId: BodyId;
}

/** Mirror a body across a world origin plane (P1). Join fuses the reflection
 * into the source; NewBody produces a separate mirrored body. */
export interface MirrorOp extends OpBase {
  readonly type: 'Mirror';
  readonly sourceBodyId: BodyId;
  readonly plane: OriginPlane;
  readonly operation: TransformOperation;
  readonly bodyId: BodyId;
}

export type PatternKind = 'linear' | 'circular';

/** Array a body linearly (along an axis) or circularly (about an axis). `count`
 * includes the source position; Join fuses the extra instances into the source,
 * NewBody collects them as a separate body (P1). */
export interface PatternOp extends OpBase {
  readonly type: 'Pattern';
  readonly sourceBodyId: BodyId;
  readonly kind: PatternKind;
  readonly count: number;
  /** Linear: centre-to-centre spacing (mm) along `axis`. */
  readonly spacingMm: number;
  /** Linear: translation axis. Circular: rotation axis. */
  readonly axis: OriginAxis;
  /** Circular: total sweep angle (deg) across all instances. */
  readonly angleDeg: number;
  readonly operation: TransformOperation;
  readonly bodyId: BodyId;
}

export type TimelineOp =
  | SketchOp
  | ExtrudeOp
  | RevolveOp
  | FilletOp
  | ChamferOp
  | CombineOp
  | CopyBodyOp
  | MirrorOp
  | PatternOp;

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
