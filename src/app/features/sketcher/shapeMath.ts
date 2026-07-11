import {
  add,
  angleOf,
  distance,
  fromAngle,
  normalize,
  scale,
  sub,
  vec2,
  DEG_TO_RAD,
  GEOM_EPS,
  type Vec2,
} from '../../../core';

/** Pure construction math shared by the sketch tools. */

/** Rectangle corners from two opposite corners, in CCW commit order. */
export function rectangleCorners(c1: Vec2, c2: Vec2): [Vec2, Vec2, Vec2, Vec2] | null {
  if (Math.abs(c2.x - c1.x) < GEOM_EPS || Math.abs(c2.y - c1.y) < GEOM_EPS) return null;
  return [c1, vec2(c2.x, c1.y), c2, vec2(c1.x, c2.y)];
}

/** Regular polygon vertices, inscribed in a circle of `diameter`, first vertex at `startAngle`. */
export function polygonVertices(
  center: Vec2,
  sides: number,
  diameter: number,
  startAngleRad: number
): Vec2[] | null {
  if (sides < 3 || !(diameter > 0)) return null;
  const r = diameter / 2;
  const out: Vec2[] = [];
  for (let i = 0; i < sides; i += 1) {
    out.push(add(center, scale(fromAngle(startAngleRad + (2 * Math.PI * i) / sides), r)));
  }
  return out;
}

/** Circumcenter of three points; null when collinear. */
export function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < GEOM_EPS) return null;
  const aa = a.x * a.x + a.y * a.y;
  const bb = b.x * b.x + b.y * b.y;
  const cc = c.x * c.x + c.y * c.y;
  return vec2(
    (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d,
    (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d
  );
}

/** Whether the arc from `start` to `end` passing through `via` runs CCW about `center`. */
export function arcIsCcw(center: Vec2, start: Vec2, via: Vec2, end: Vec2): boolean {
  // Sweep CCW from start; `via` must fall inside the CCW sweep to pick CCW.
  const a0 = angleOf(sub(start, center));
  const aV = (((angleOf(sub(via, center)) - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const aE = (((angleOf(sub(end, center)) - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return aV <= aE;
}

/**
 * Line endpoint from anchor + typed/cursor inputs (MASTER_DOCUMENT F2):
 * absolute angle is to the sketch +X axis; the relative angle (chained
 * segments) measures from the previous segment's direction and applies
 * only when no absolute angle was typed. Untyped values fall back to the
 * cursor. Returns null for degenerate lengths.
 */
export function lineEndFrom(
  anchor: Vec2,
  cursor: Vec2,
  length: number | null,
  angleAbsDeg: number | null,
  angleRelDeg: number | null,
  prevDirection: Vec2 | null
): Vec2 | null {
  let angleRad: number;
  if (angleAbsDeg !== null) {
    angleRad = angleAbsDeg * DEG_TO_RAD;
  } else if (angleRelDeg !== null && prevDirection) {
    angleRad = angleOf(prevDirection) + angleRelDeg * DEG_TO_RAD;
  } else {
    const dir = sub(cursor, anchor);
    angleRad = Math.abs(dir.x) < GEOM_EPS && Math.abs(dir.y) < GEOM_EPS ? 0 : angleOf(dir);
  }
  const len = length ?? distance(cursor, anchor);
  if (!(len > GEOM_EPS)) return null;
  return add(anchor, scale(fromAngle(angleRad), len));
}

export function directionBetween(a: Vec2, b: Vec2): Vec2 | null {
  const d = sub(b, a);
  return Math.abs(d.x) < GEOM_EPS && Math.abs(d.y) < GEOM_EPS ? null : normalize(d);
}
