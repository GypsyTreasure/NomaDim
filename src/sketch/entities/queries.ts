import {
  add,
  angleOf,
  clampToRange,
  cross,
  distance,
  dot,
  fromAngle,
  lengthSq,
  scale,
  sub,
  GEOM_EPS,
  type Vec2,
} from '../../core';
import { angleOnArc, type ArcCurve, type CircleCurve, type Curve } from './curves';

/** Pure geometric queries over evaluated curves — snap providers and profile
 * detection build on these. No DOM, no pixels (R11). */

export function closestPointOnCurve(curve: Curve, p: Vec2): Vec2 {
  switch (curve.kind) {
    case 'segment': {
      const ab = sub(curve.b, curve.a);
      const denom = lengthSq(ab);
      if (denom < GEOM_EPS) return curve.a;
      const t = clampToRange(dot(sub(p, curve.a), ab) / denom, 0, 1);
      return add(curve.a, scale(ab, t));
    }
    case 'circle':
      return pointAtAngle(curve, angleOf(sub(p, curve.center)));
    case 'arc': {
      const angle = angleOf(sub(p, curve.center));
      if (angleOnArc(curve, angle)) return pointAtAngle(curve, angle);
      const start = pointAtAngle(curve, curve.startAngle);
      const end = pointAtAngle(curve, curve.startAngle + curve.sweep);
      return distance(p, start) <= distance(p, end) ? start : end;
    }
    default: {
      const exhaustive: never = curve;
      return exhaustive;
    }
  }
}

function pointAtAngle(curve: CircleCurve | ArcCurve, angleRad: number): Vec2 {
  return add(curve.center, scale(fromAngle(angleRad), curve.r));
}

/** Curve midpoint — segment middle or arc mid-sweep; null for full circles. */
export function curveMidpoint(curve: Curve): Vec2 | null {
  switch (curve.kind) {
    case 'segment':
      return scale(add(curve.a, curve.b), 0.5);
    case 'arc':
      return pointAtAngle(curve, curve.startAngle + curve.sweep / 2);
    case 'circle':
      return null;
    default: {
      const exhaustive: never = curve;
      return exhaustive;
    }
  }
}

/** N/E/S/W quadrant points of circles, and of arcs where the quadrant lies on the sweep. */
export function quadrantPoints(curve: Curve): readonly Vec2[] {
  if (curve.kind === 'segment') return [];
  const quadrantAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const angles =
    curve.kind === 'circle'
      ? quadrantAngles
      : quadrantAngles.filter((angle) => angleOnArc(curve, angle));
  return angles.map((angle) => pointAtAngle(curve, angle));
}

// ---------------------------------------------------------------------------
// Intersections

function segmentParamRange(t: number, eps: number): boolean {
  return t >= -eps && t <= 1 + eps;
}

function segSegIntersections(
  a: Curve & { kind: 'segment' },
  b: Curve & { kind: 'segment' }
): Vec2[] {
  const r = sub(a.b, a.a);
  const s = sub(b.b, b.a);
  const denom = cross(r, s);
  if (Math.abs(denom) < GEOM_EPS) return []; // parallel/collinear: no point intersections
  const qp = sub(b.a, a.a);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  const eps = 1e-9;
  if (!segmentParamRange(t, eps) || !segmentParamRange(u, eps)) return [];
  return [add(a.a, scale(r, t))];
}

function segCircleIntersections(
  seg: Curve & { kind: 'segment' },
  circle: CircleCurve | ArcCurve
): Vec2[] {
  const d = sub(seg.b, seg.a);
  const f = sub(seg.a, circle.center);
  const a = lengthSq(d);
  if (a < GEOM_EPS) return [];
  const b = 2 * dot(f, d);
  const c = lengthSq(f) - circle.r * circle.r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const sqrtDisc = Math.sqrt(disc);
  const ts =
    disc < GEOM_EPS ? [-b / (2 * a)] : [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)];
  return ts
    .filter((t) => segmentParamRange(t, 1e-9))
    .map((t) => add(seg.a, scale(d, t)))
    .filter((p) => onArcIfArc(circle, p));
}

function circleCircleIntersections(a: CircleCurve | ArcCurve, b: CircleCurve | ArcCurve): Vec2[] {
  const d = distance(a.center, b.center);
  if (d < GEOM_EPS) return []; // concentric
  if (d > a.r + b.r + GEOM_EPS || d < Math.abs(a.r - b.r) - GEOM_EPS) return [];
  const along = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const hSq = a.r * a.r - along * along;
  const dir = scale(sub(b.center, a.center), 1 / d);
  const base = add(a.center, scale(dir, along));
  if (hSq < GEOM_EPS) {
    return [base].filter((p) => onArcIfArc(a, p) && onArcIfArc(b, p));
  }
  const h = Math.sqrt(hSq);
  const offset = scale({ x: -dir.y, y: dir.x }, h);
  return [add(base, offset), sub(base, offset)].filter((p) => onArcIfArc(a, p) && onArcIfArc(b, p));
}

function onArcIfArc(curve: CircleCurve | ArcCurve, p: Vec2): boolean {
  return curve.kind === 'circle' || angleOnArc(curve, angleOf(sub(p, curve.center)), 1e-6);
}

/** All point intersections between two curves (arc ranges respected). */
export function intersectCurves(a: Curve, b: Curve): readonly Vec2[] {
  if (a.kind === 'segment' && b.kind === 'segment') return segSegIntersections(a, b);
  if (a.kind === 'segment') return segCircleIntersections(a, b as CircleCurve | ArcCurve);
  if (b.kind === 'segment') return segCircleIntersections(b, a);
  return circleCircleIntersections(a, b);
}

// ---------------------------------------------------------------------------
// Sampling (containment tests in profile detection)

/** Polyline approximation. `chordTolMm` bounds arc chord deviation. */
export function sampleCurve(curve: Curve, chordTolMm: number): readonly Vec2[] {
  switch (curve.kind) {
    case 'segment':
      return [curve.a, curve.b];
    case 'circle':
      return sampleArcRange(curve, 0, 2 * Math.PI, chordTolMm, true);
    case 'arc':
      return sampleArcRange(curve, curve.startAngle, curve.sweep, chordTolMm, false);
    default: {
      const exhaustive: never = curve;
      return exhaustive;
    }
  }
}

function sampleArcRange(
  curve: CircleCurve | ArcCurve,
  startAngle: number,
  sweep: number,
  chordTolMm: number,
  closeLoop: boolean
): Vec2[] {
  const tol = Math.min(Math.max(chordTolMm, 1e-6), curve.r);
  const stepAngle = 2 * Math.acos(Math.max(-1, 1 - tol / curve.r));
  const steps = Math.max(closeLoop ? 8 : 2, Math.ceil(sweep / Math.max(stepAngle, 1e-6)));
  const points: Vec2[] = [];
  const last = closeLoop ? steps - 1 : steps;
  for (let i = 0; i <= last; i += 1) {
    points.push(pointAtAngle(curve, startAngle + (sweep * i) / steps));
  }
  return points;
}
