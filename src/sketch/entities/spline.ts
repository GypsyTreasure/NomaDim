import { add, scale, sub, type Vec2 } from '../../core';

/**
 * Fit-point spline sampling (F2 Spline tool, AutoCAD parity): a smooth curve
 * that PASSES THROUGH its fit points, tessellated to a polyline the rest of the
 * solver-free pipeline consumes (snap, selection, profile loops, kernel edges).
 *
 * Uses a centripetal Catmull–Rom interpolation — passes through every fit point,
 * no cusps/self-intersections from bunched points, and is purely local (no
 * solver). Open splines duplicate the end tangents; closed splines wrap.
 */

/** Sub-segments generated per span between consecutive fit points. */
export const SPLINE_SAMPLES_PER_SPAN = 16;

const ALPHA = 0.5; // centripetal parametrization

function tj(ti: number, pi: Vec2, pj: Vec2): number {
  const d = Math.hypot(pj.x - pi.x, pj.y - pi.y);
  return ti + Math.pow(d, ALPHA);
}

/** Catmull–Rom point for parameter t in [t1,t2], control points p0..p3. */
function crPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  // Guard against coincident control points (zero-length spans).
  if (t1 === t0 || t2 === t1 || t3 === t2) {
    const u = (t - t1) / (t2 - t1 || 1);
    return add(p1, scale(sub(p2, p1), Math.max(0, Math.min(1, u))));
  }
  const a1 = add(scale(p0, (t1 - t) / (t1 - t0)), scale(p1, (t - t0) / (t1 - t0)));
  const a2 = add(scale(p1, (t2 - t) / (t2 - t1)), scale(p2, (t - t1) / (t2 - t1)));
  const a3 = add(scale(p2, (t3 - t) / (t3 - t2)), scale(p3, (t - t2) / (t3 - t2)));
  const b1 = add(scale(a1, (t2 - t) / (t2 - t0)), scale(a2, (t - t0) / (t2 - t0)));
  const b2 = add(scale(a2, (t3 - t) / (t3 - t1)), scale(a3, (t - t1) / (t3 - t1)));
  return add(scale(b1, (t2 - t) / (t2 - t1)), scale(b2, (t - t1) / (t2 - t1)));
}

/**
 * Samples a fit-point spline into a polyline (includes every fit point). Fewer
 * than 2 points → the points themselves; 2 points → a straight segment.
 */
export function sampleSpline(
  fit: readonly Vec2[],
  closed: boolean,
  perSpan = SPLINE_SAMPLES_PER_SPAN
): Vec2[] {
  const first = fit[0];
  const second = fit[1];
  if (!first || !second) return fit.map((p) => ({ x: p.x, y: p.y }));
  if (fit.length === 2 && !closed) return [first, second];

  const pts = closed ? [...fit, first] : [...fit];
  const n = pts.length;
  const out: Vec2[] = [pts[0] ?? first];
  for (let i = 0; i < n - 1; i += 1) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    if (!p1 || !p2) continue;
    const p0 =
      i === 0 ? (closed ? (fit[fit.length - 1] ?? p1) : add(p1, sub(p1, p2))) : (pts[i - 1] ?? p1);
    const p3 =
      i + 2 < n ? (pts[i + 2] ?? p2) : closed ? (fit[1 % fit.length] ?? p2) : add(p2, sub(p2, p1));
    const t1 = tj(0, p0, p1);
    const t2 = tj(t1, p1, p2);
    for (let s = 1; s <= perSpan; s += 1) {
      const t = t1 + ((t2 - t1) * s) / perSpan;
      out.push(crPoint(p0, p1, p2, p3, t));
    }
  }
  return out;
}
