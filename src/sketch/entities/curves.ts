import { angleOf, ccwSweep, distance, sub, type EntityId, type Vec2 } from '../../core';
import { pointMap, type Sketch, type SketchEntity } from '../../document';

/**
 * Evaluated 2D curves (sketch-local coordinates). `document/` stores
 * topology + baked coordinates; this module turns entities into geometry
 * the snap engine, profile detection, and overlay rendering can query
 * (ARCHITECTURE §3: sketch/ = "2D geometry evaluation (entity → curves)").
 *
 * Arcs canonicalize to CCW (`startAngle` + positive `sweep`): a CW arc from
 * start to end covers the same point set as a CCW arc from end to start, so
 * one representation serves all geometric queries; traversal direction,
 * where it matters (profiles), comes from topology.
 */

export interface SegmentCurve {
  readonly kind: 'segment';
  readonly a: Vec2;
  readonly b: Vec2;
}

export interface CircleCurve {
  readonly kind: 'circle';
  readonly center: Vec2;
  readonly r: number;
}

export interface ArcCurve {
  readonly kind: 'arc';
  readonly center: Vec2;
  readonly r: number;
  /** Angle of the CCW-start endpoint, in (-PI, PI]. */
  readonly startAngle: number;
  /** CCW sweep in (0, 2*PI). */
  readonly sweep: number;
}

export type Curve = SegmentCurve | CircleCurve | ArcCurve;

export interface EvaluatedEntity {
  readonly entityId: EntityId;
  readonly construction: boolean;
  readonly curve: Curve;
}

/**
 * Evaluates every entity that produces a curve (point entities produce
 * none). Entities referencing missing pool points are skipped — validation
 * rejects such documents before they get here; evaluation stays total.
 */
export function evaluateSketch(sketch: Sketch): readonly EvaluatedEntity[] {
  const points = pointMap(sketch);
  const out: EvaluatedEntity[] = [];

  for (const entity of sketch.entities) {
    const curve = evaluateEntity(entity, points);
    if (curve) {
      out.push({ entityId: entity.id, construction: entity.construction, curve });
    }
  }
  return out;
}

export function evaluateEntity(
  entity: SketchEntity,
  points: ReadonlyMap<string, Vec2>
): Curve | null {
  switch (entity.type) {
    case 'line': {
      const a = points.get(entity.start);
      const b = points.get(entity.end);
      return a && b ? { kind: 'segment', a, b } : null;
    }
    case 'circle': {
      const center = points.get(entity.center);
      return center ? { kind: 'circle', center, r: entity.r } : null;
    }
    case 'arc': {
      const center = points.get(entity.center);
      const start = points.get(entity.start);
      const end = points.get(entity.end);
      if (!center || !start || !end) return null;
      const r = distance(center, start);
      const startAngleRaw = angleOf(sub(start, center));
      const endAngleRaw = angleOf(sub(end, center));
      const startAngle = entity.ccw ? startAngleRaw : endAngleRaw;
      const endAngle = entity.ccw ? endAngleRaw : startAngleRaw;
      return { kind: 'arc', center, r, startAngle, sweep: ccwSweep(startAngle, endAngle) };
    }
    case 'point':
      return null;
    default: {
      const exhaustive: never = entity;
      return exhaustive;
    }
  }
}

/** Whether `angleRad` lies on the arc (inclusive of endpoints, tolerant at the seams). */
export function angleOnArc(arc: ArcCurve, angleRad: number, epsRad = 1e-9): boolean {
  const offset = ccwSweep(arc.startAngle, angleRad);
  return offset <= arc.sweep + epsRad || offset >= 2 * Math.PI - epsRad;
}
