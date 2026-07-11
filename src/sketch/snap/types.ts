import type { EntityId, PointId, Vec2 } from '../../core';
import type { Sketch } from '../../document';
import type { EvaluatedEntity } from '../entities/curves';

/**
 * Snap system contracts (ARCHITECTURE §10). The engine is unit-pure (R11):
 * every tolerance is in sketch units (mm) — the CALLER converts pixel
 * tolerances using the camera scale. Providers are queried in order; the
 * highest-priority candidate within tolerance wins. Extend by adding
 * providers — never by special-casing inside the engine.
 */

export type SnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'quadrant'
  | 'intersection'
  | 'on-entity'
  | 'grid'
  | GuideKind
  | 'guide-intersection';

export type GuideKind = 'align-h' | 'align-v' | 'parallel' | 'perpendicular' | 'tangent';

/** What a committed point should reference — pool ids make shared topology (§8). */
export type SnapSourceRef =
  | { readonly type: 'point'; readonly pointId: PointId }
  | { readonly type: 'entity'; readonly entityId: EntityId }
  | { readonly type: 'entities'; readonly entityIds: readonly EntityId[] }
  | { readonly type: 'free' };

export interface SnapCandidate {
  readonly point: Vec2;
  readonly kind: SnapKind;
  readonly priority: number;
  readonly sourceRef: SnapSourceRef;
}

/** Infinite guide line for the viewport overlay to draw dashed (engine computes, viewport draws). */
export interface Guide {
  readonly kind: GuideKind;
  readonly through: Vec2;
  readonly direction: Vec2; // unit
}

export interface SnapContext {
  readonly sketch: Sketch;
  /** Pre-evaluated curves (callers evaluate once per document change, not per cursor move). */
  readonly evaluated: readonly EvaluatedEntity[];
  readonly cursor: Vec2;
  /** Snap tolerance in sketch units (mm) — pixel conversion happens in the caller (R11). */
  readonly toleranceMm: number;
  /** Angular tolerance for direction-based guides (parallel/perpendicular/tangent). */
  readonly angularToleranceRad: number;
  readonly gridSpacingMm: number;
  /** Chained-tool anchor (previous point) — enables direction guides. */
  readonly anchor?: Vec2;
  /** Entities to ignore (the one being dragged / currently drawn). */
  readonly excludeEntityIds?: ReadonlySet<EntityId>;
  /** Per-kind toggles (sketch toolbar); absent = enabled. `Ctrl` disables all in the caller. */
  readonly disabledKinds?: ReadonlySet<SnapKind>;
}

export interface SnapResult {
  /** Winning candidate, or null (cursor stays free). */
  readonly snap: SnapCandidate | null;
  /** Guides active at this cursor position (for overlay rendering). */
  readonly guides: readonly Guide[];
}

export interface SnapProvider {
  readonly name: string;
  provide(ctx: SnapContext): readonly SnapCandidate[];
}

export interface GuideProvider {
  readonly name: string;
  provide(ctx: SnapContext): { guides: readonly Guide[]; candidates: readonly SnapCandidate[] };
}

/**
 * Priorities — higher wins within tolerance (Fusion-like ranking). Guides
 * rank BELOW `on-entity` deliberately: inference guides are an empty-space
 * aid, and when the cursor is on real geometry the entity snap must win —
 * it carries the entity/point sourceRef that committed topology needs.
 */
export const SNAP_PRIORITY: Record<SnapKind, number> = {
  endpoint: 100,
  intersection: 90,
  midpoint: 85,
  center: 85,
  quadrant: 80,
  'on-entity': 40,
  'guide-intersection': 38,
  'align-h': 35,
  'align-v': 35,
  parallel: 33,
  perpendicular: 33,
  tangent: 33,
  grid: 20,
};
