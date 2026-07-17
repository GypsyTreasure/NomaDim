import type { DimensionId, EntityId, PointId, SketchId } from '../../core';

/**
 * Sketch document model (MASTER_DOCUMENT F2/F7, ARCHITECTURE §8, §10).
 * Pure serializable data — no geometry computation here (that lives in
 * `sketch/`), no kernel or render objects.
 *
 * Constraint-ready by construction (C6): a per-sketch point pool where a
 * shared endpoint is ONE pool point (topology, not coincident coordinates),
 * plus reserved `constraints`/`dimensions` arrays so a v2 solver is purely
 * additive. Do not "optimize away" the reserved slots.
 */

/** A pool point. Entities reference these by id; shared endpoints share one entry. */
export interface SketchPoint {
  readonly id: PointId;
  readonly x: number;
  readonly y: number;
}

interface EntityBase {
  readonly id: EntityId;
  readonly construction: boolean;
}

/** Straight segment between two pool points. */
export interface LineEntity extends EntityBase {
  readonly type: 'line';
  readonly start: PointId;
  readonly end: PointId;
  /**
   * Centerline flag (F3): an axis line drawn with the Axis tool, offered as a
   * revolve axis and rendered as a centerline. Axis lines are always
   * construction (reference geometry), so they never join a profile loop.
   * Optional/absent = a normal line (the overwhelming majority); treat absent
   * as false everywhere.
   */
  readonly axis?: boolean;
}

/** Full circle: center pool point + explicit radius (mm). */
export interface CircleEntity extends EntityBase {
  readonly type: 'circle';
  readonly center: PointId;
  readonly r: number;
}

/**
 * Circular arc from `start` to `end` about `center`; `ccw` picks which of
 * the two sweeps. Radius is derived (|center→start|); validation enforces
 * |center→start| ≈ |center→end|.
 */
export interface ArcEntity extends EntityBase {
  readonly type: 'arc';
  readonly center: PointId;
  readonly start: PointId;
  readonly end: PointId;
  readonly ccw: boolean;
}

/** Standalone sketch point entity (F2 "Point" tool) wrapping a pool point. */
export interface PointEntity extends EntityBase {
  readonly type: 'point';
  readonly point: PointId;
}

/**
 * Persisted entity kinds. Rectangle/Polygon are macro TOOLS: they expand to
 * `line` entities on commit (F2) and never appear in the document.
 */
export type SketchEntity = LineEntity | CircleEntity | ArcEntity | PointEntity;

export type SketchEntityType = SketchEntity['type'];

/** Origin planes (M2). */
export interface OriginPlaneRef {
  readonly kind: 'origin';
  readonly plane: 'XY' | 'XZ' | 'YZ';
}

/**
 * Face-based sketch plane (schema reserved now; behavior lands with the
 * milestones that resolve fingerprints at regen — ARCHITECTURE §8).
 */
export interface FacePlaneRef {
  readonly kind: 'face';
  readonly fingerprint: string;
  readonly planeSnapshot: {
    readonly origin: readonly [number, number, number];
    readonly xAxis: readonly [number, number, number];
    readonly yAxis: readonly [number, number, number];
  };
}

export type SketchPlaneRef = OriginPlaneRef | FacePlaneRef;

/**
 * Reference (associative) dimension between two pool points — solver-free
 * (ADR-0002): the value is MEASURED from the current point positions and
 * displayed, never driving the geometry. Occupies the constraint-ready C6
 * `dimensions` slot; a v2 solver can later make these driving.
 * - `linear`     straight distance |ab|
 * - `horizontal` |Δx|      · `vertical` |Δy|
 * - `angle`      inclination of a→b from +X, degrees
 * - `radius`     distance |ab| shown as R (a = centre, b = on the circle)
 */
export type SketchDimensionKind = 'linear' | 'horizontal' | 'vertical' | 'angle' | 'radius';

export interface SketchDimension {
  readonly id: DimensionId;
  readonly kind: SketchDimensionKind;
  readonly a: PointId;
  readonly b: PointId;
  /** Perpendicular offset (mm) of the dimension line from the a→b span; sign = side. */
  readonly offset: number;
}

export interface Sketch {
  readonly id: SketchId;
  readonly name: string;
  readonly plane: SketchPlaneRef;
  /** Point pool — insertion-ordered; XML codec sorts for determinism. */
  readonly points: readonly SketchPoint[];
  readonly entities: readonly SketchEntity[];
  /** Reserved for the v2 solver (C6). Always empty in v1 — but always present. */
  readonly constraints: readonly never[];
  /** Reference dimensions (C6 slot). Associative + solver-free in v1. */
  readonly dimensions: readonly SketchDimension[];
}
