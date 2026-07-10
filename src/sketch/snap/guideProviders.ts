import {
  add,
  distance,
  dot,
  length,
  normalize,
  perp,
  scale,
  sub,
  vec2,
  type Vec2,
} from '../../core';
import { closestPointOnCurve } from '../entities/queries';
import { entityPointIds } from '../entities/topology';
import {
  SNAP_PRIORITY,
  type Guide,
  type GuideProvider,
  type SnapCandidate,
  type SnapContext,
} from './types';

/**
 * Inference-guide providers (ARCHITECTURE §10): horizontal/vertical
 * alignment to existing points, parallel/perpendicular to existing lines,
 * tangent continuation off circles/arcs. Each returns guides (dashed lines
 * for the overlay) plus snap candidates ON those guides. Unit-pure (R11).
 */

const EMPTY: { guides: readonly Guide[]; candidates: readonly SnapCandidate[] } = {
  guides: [],
  candidates: [],
};

function candidate(p: Vec2, kind: SnapCandidate['kind']): SnapCandidate {
  return { point: p, kind, priority: SNAP_PRIORITY[kind], sourceRef: { type: 'free' } };
}

/**
 * Pool points usable as alignment sources: points referenced by at least
 * one non-excluded entity (or by none at all). Excluding an entity — e.g.
 * while dragging it — must also silence guides sourced from its own points.
 */
function alignmentSourcePoints(ctx: SnapContext): Vec2[] {
  const excluded = ctx.excludeEntityIds;
  if (!excluded || excluded.size === 0) {
    return ctx.sketch.points.map((p) => vec2(p.x, p.y));
  }
  const referencedByLive = new Set<string>();
  const referencedByAny = new Set<string>();
  for (const entity of ctx.sketch.entities) {
    for (const pointId of entityPointIds(entity)) {
      referencedByAny.add(pointId);
      if (!excluded.has(entity.id)) referencedByLive.add(pointId);
    }
  }
  return ctx.sketch.points
    .filter((p) => referencedByLive.has(p.id) || !referencedByAny.has(p.id))
    .map((p) => vec2(p.x, p.y));
}

/**
 * Horizontal/vertical alignment to existing pool points and the anchor.
 * Nearest source point wins per axis; when both axes align (to possibly
 * different sources) the exact corner is offered as `guide-intersection`.
 */
export const alignmentGuideProvider: GuideProvider = {
  name: 'alignment',
  provide(ctx: SnapContext) {
    const sources: Vec2[] = alignmentSourcePoints(ctx);
    if (ctx.anchor) sources.push(ctx.anchor);
    if (sources.length === 0) return EMPTY;

    let bestV: Vec2 | null = null; // vertical guide source (same x)
    let bestH: Vec2 | null = null; // horizontal guide source (same y)
    for (const source of sources) {
      const dx = Math.abs(ctx.cursor.x - source.x);
      const dy = Math.abs(ctx.cursor.y - source.y);
      if (dx <= ctx.toleranceMm && (bestV === null || dx < Math.abs(ctx.cursor.x - bestV.x))) {
        bestV = source;
      }
      if (dy <= ctx.toleranceMm && (bestH === null || dy < Math.abs(ctx.cursor.y - bestH.y))) {
        bestH = source;
      }
    }

    const guides: Guide[] = [];
    const candidates: SnapCandidate[] = [];
    if (bestV) {
      guides.push({ kind: 'align-v', through: bestV, direction: vec2(0, 1) });
      candidates.push(candidate(vec2(bestV.x, ctx.cursor.y), 'align-v'));
    }
    if (bestH) {
      guides.push({ kind: 'align-h', through: bestH, direction: vec2(1, 0) });
      candidates.push(candidate(vec2(ctx.cursor.x, bestH.y), 'align-h'));
    }
    if (bestV && bestH) {
      candidates.push(candidate(vec2(bestV.x, bestH.y), 'guide-intersection'));
    }
    return { guides, candidates };
  },
};

/** Smallest unsigned angle between two directions, treating d and -d alike. */
function axialAngleBetween(a: Vec2, b: Vec2): number {
  const cos = Math.abs(dot(normalize(a), normalize(b)));
  return Math.acos(Math.min(1, cos));
}

/** Projects cursor onto the line through `anchor` with `direction`. */
function projectOnRay(anchor: Vec2, direction: Vec2, cursor: Vec2): Vec2 {
  const dir = normalize(direction);
  return add(anchor, scale(dir, dot(sub(cursor, anchor), dir)));
}

/**
 * Parallel / perpendicular to existing (non-excluded) line segments while
 * drawing from an anchor. Best angular match per kind wins.
 */
export const directionGuideProvider: GuideProvider = {
  name: 'direction',
  provide(ctx: SnapContext) {
    const anchor = ctx.anchor;
    if (!anchor) return EMPTY;
    const stroke = sub(ctx.cursor, anchor);
    if (length(stroke) < ctx.toleranceMm) return EMPTY;

    let best: { kind: 'parallel' | 'perpendicular'; direction: Vec2; deviation: number } | null =
      null;
    for (const entity of ctx.evaluated) {
      if (entity.curve.kind !== 'segment') continue;
      if (ctx.excludeEntityIds?.has(entity.entityId)) continue;
      const base = sub(entity.curve.b, entity.curve.a);
      if (length(base) === 0) continue;

      const parallelDev = axialAngleBetween(stroke, base);
      if (
        parallelDev <= ctx.angularToleranceRad &&
        (best === null || parallelDev < best.deviation)
      ) {
        best = { kind: 'parallel', direction: normalize(base), deviation: parallelDev };
      }
      const perpDir = perp(base);
      const perpDev = axialAngleBetween(stroke, perpDir);
      if (perpDev <= ctx.angularToleranceRad && (best === null || perpDev < best.deviation)) {
        best = { kind: 'perpendicular', direction: normalize(perpDir), deviation: perpDev };
      }
    }
    if (!best) return EMPTY;

    // Orient the guide along the stroke so the projection lands ahead of the anchor.
    const oriented = dot(best.direction, stroke) >= 0 ? best.direction : scale(best.direction, -1);
    const snapped = projectOnRay(anchor, oriented, ctx.cursor);
    return {
      guides: [{ kind: best.kind, through: anchor, direction: oriented }],
      candidates: [candidate(snapped, best.kind)],
    };
  },
};

/**
 * Tangent continuation: when the anchor sits on a circle/arc, snap the
 * stroke onto the tangent direction at that point.
 */
export const tangentGuideProvider: GuideProvider = {
  name: 'tangent',
  provide(ctx: SnapContext) {
    const anchor = ctx.anchor;
    if (!anchor) return EMPTY;
    const stroke = sub(ctx.cursor, anchor);
    if (length(stroke) < ctx.toleranceMm) return EMPTY;

    for (const entity of ctx.evaluated) {
      const curve = entity.curve;
      if (curve.kind === 'segment') continue;
      if (ctx.excludeEntityIds?.has(entity.entityId)) continue;
      const onCurve = closestPointOnCurve(curve, anchor);
      if (distance(onCurve, anchor) > ctx.toleranceMm) continue;

      const radial = sub(anchor, curve.center);
      if (length(radial) === 0) continue;
      const tangent = normalize(perp(radial));
      if (axialAngleBetween(stroke, tangent) > ctx.angularToleranceRad) continue;

      const oriented = dot(tangent, stroke) >= 0 ? tangent : scale(tangent, -1);
      const snapped = projectOnRay(anchor, oriented, ctx.cursor);
      return {
        guides: [{ kind: 'tangent', through: anchor, direction: oriented }],
        candidates: [candidate(snapped, 'tangent')],
      };
    }
    return EMPTY;
  },
};

export const DEFAULT_GUIDE_PROVIDERS: readonly GuideProvider[] = [
  alignmentGuideProvider,
  directionGuideProvider,
  tangentGuideProvider,
];
