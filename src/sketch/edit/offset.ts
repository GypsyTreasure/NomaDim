import {
  add,
  createId,
  distance,
  dot,
  normalize,
  perp,
  scale,
  sub,
  vec2,
  type EntityId,
  type PointId,
  type Vec2,
} from '../../core';
import { pointMap, type Sketch, type SketchPoint } from '../../document';
import type { SketchGeometryDelta } from '../sketchTransform';
import type { Curve } from '../entities/curves';

/**
 * Sketch Offset (#8, AutoCAD-like): a parallel copy of one entity that passes
 * (approximately) through a "through" point the user indicates on one side of
 * the source. Solver-free — like Mirror/Pattern it generates plain new pool
 * points + an entity for the `AddSketchGeometry` command. Lines offset
 * perpendicular; circles/arcs offset radially (concentric). Splines/points have
 * no well-defined single-distance offset here and are not supported.
 */

const EPS = 1e-6;

/** Perpendicular translation putting a segment through `through`; null if degenerate. */
function offsetSegment(a: Vec2, b: Vec2, through: Vec2): { a: Vec2; b: Vec2 } | null {
  if (distance(a, b) < EPS) return null;
  const n = normalize(perp(sub(b, a))); // unit normal to the segment
  const d = dot(sub(through, a), n); // signed perpendicular distance (side + magnitude)
  return { a: add(a, scale(n, d)), b: add(b, scale(n, d)) };
}

/** Radially scale a point on a circle/arc of radius `r` to radius `r2`. */
function radialScale(center: Vec2, p: Vec2, r: number, r2: number): Vec2 {
  return add(center, scale(sub(p, center), r2 / r));
}

/** All ids already used in the sketch, so minted ids never collide. */
function existingIds(sketch: Sketch): Set<string> {
  const ids = new Set<string>();
  for (const p of sketch.points) ids.add(p.id);
  for (const e of sketch.entities) ids.add(e.id);
  for (const d of sketch.dimensions) ids.add(d.id);
  return ids;
}

/**
 * A preview curve for the offset of `curve` through `through` (evaluated form),
 * or null when the kind is unsupported / degenerate. Same math as the commit.
 */
export function offsetPreviewCurve(curve: Curve, through: Vec2): Curve | null {
  switch (curve.kind) {
    case 'segment': {
      const seg = offsetSegment(curve.a, curve.b, through);
      return seg ? { kind: 'segment', a: seg.a, b: seg.b } : null;
    }
    case 'circle': {
      const r2 = distance(curve.center, through);
      return r2 < EPS ? null : { kind: 'circle', center: curve.center, r: r2 };
    }
    case 'arc': {
      const r2 = distance(curve.center, through);
      return r2 < EPS
        ? null
        : {
            kind: 'arc',
            center: curve.center,
            r: r2,
            startAngle: curve.startAngle,
            sweep: curve.sweep,
          };
    }
    case 'spline':
      return null;
    default: {
      const exhaustive: never = curve;
      return exhaustive;
    }
  }
}

/**
 * New geometry (points + one entity) for the offset of `entityId` through
 * `through`, or null if the entity is missing/unsupported/degenerate. Ready for
 * the `AddSketchGeometry` command. Construction flag is inherited.
 */
export function offsetEntity(
  sketch: Sketch,
  entityId: EntityId,
  through: Vec2
): SketchGeometryDelta | null {
  const entity = sketch.entities.find((e) => e.id === entityId);
  if (!entity) return null;
  const pts = pointMap(sketch);
  const taken = existingIds(sketch);
  const mkPoint = (p: Vec2): { id: PointId; point: SketchPoint } => {
    const id = createId<'PointId'>(taken);
    taken.add(id);
    return { id, point: { id, x: p.x, y: p.y } };
  };
  const mkEntityId = (): EntityId => {
    const id = createId<'EntityId'>(taken);
    taken.add(id);
    return id;
  };
  const at = (id: PointId): Vec2 | null => {
    const p = pts.get(id);
    return p ? vec2(p.x, p.y) : null;
  };

  switch (entity.type) {
    case 'line': {
      const a = at(entity.start);
      const b = at(entity.end);
      if (!a || !b) return null;
      const seg = offsetSegment(a, b, through);
      if (!seg) return null;
      const s = mkPoint(seg.a);
      const e = mkPoint(seg.b);
      return {
        points: [s.point, e.point],
        entities: [
          {
            type: 'line',
            id: mkEntityId(),
            start: s.id,
            end: e.id,
            construction: entity.construction,
            ...(entity.axis ? { axis: true } : {}),
          },
        ],
      };
    }
    case 'circle': {
      const center = at(entity.center);
      if (!center) return null;
      const r2 = distance(center, through);
      if (r2 < EPS) return null;
      const c = mkPoint(center);
      return {
        points: [c.point],
        entities: [
          {
            type: 'circle',
            id: mkEntityId(),
            center: c.id,
            r: r2,
            construction: entity.construction,
          },
        ],
      };
    }
    case 'arc': {
      const center = at(entity.center);
      const start = at(entity.start);
      const end = at(entity.end);
      if (!center || !start || !end) return null;
      const r = distance(center, start);
      const r2 = distance(center, through);
      if (r < EPS || r2 < EPS) return null;
      const c = mkPoint(center);
      const s = mkPoint(radialScale(center, start, r, r2));
      const e = mkPoint(radialScale(center, end, r, r2));
      return {
        points: [c.point, s.point, e.point],
        entities: [
          {
            type: 'arc',
            id: mkEntityId(),
            center: c.id,
            start: s.id,
            end: e.id,
            ccw: entity.ccw,
            construction: entity.construction,
          },
        ],
      };
    }
    case 'point':
    case 'spline':
      return null;
    default: {
      const exhaustive: never = entity;
      return exhaustive;
    }
  }
}
