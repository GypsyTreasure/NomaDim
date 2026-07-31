import { distance, vec2, type Vec2 } from '../../../core';
import type { ImportPrimitive } from '../../../sketch';
import type { GeometryPlan } from './geometryPlan';

/**
 * Turns neutral imported primitives (ADR-0076) into sketch geometry on a
 * GeometryPlan as REAL (extrudable) entities — so an imported DXF/SVG is a
 * normal sketch you can Finish → Extrude directly, snappable at every vertex
 * and selectable per shape (ADR-0089). Shared vertices merge by coordinate
 * (GeometryPlan), so a polyline imports as a connected chain.
 *
 * Dense polylines (curves tessellated to hundreds/thousands of points, common
 * in real DXF profiles) are simplified with Ramer–Douglas–Peucker before import
 * so they become a handful of segments instead of thousands — this keeps the
 * sketch interactive (snap/overlay are O(entities)) without visibly changing
 * the shape (ADR-0089).
 */

/** Max deviation (mm) a simplified polyline vertex may drift from the original. */
const SIMPLIFY_TOLERANCE_MM = 0.05;

/** Perpendicular distance from `p` to the segment a–b. */
function perpDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Ramer–Douglas–Peucker polyline simplification (iterative, no recursion depth risk). */
export function simplifyPolyline(points: readonly Vec2[], tol: number): Vec2[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [start, end] = range;
    const a = points[start];
    const b = points[end];
    if (!a || !b) continue;
    let maxDist = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i += 1) {
      const p = points[i];
      if (!p) continue;
      const d = perpDistance(p, a, b);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > tol && idx !== -1) {
      keep[idx] = true;
      stack.push([start, idx], [idx, end]);
    }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (keep[i] && p) out.push(vec2(p.x, p.y));
  }
  return out;
}

export function addImportedPrimitives(
  plan: GeometryPlan,
  primitives: readonly ImportPrimitive[]
): void {
  const REAL = false; // import as normal (extrudable) sketch geometry (#3)
  for (const prim of primitives) {
    switch (prim.kind) {
      case 'line':
        plan.addLine({ p: prim.a }, { p: prim.b }, REAL);
        break;
      case 'circle':
        if (prim.r > 0) plan.addCircle({ p: prim.center }, prim.r, REAL);
        break;
      case 'arc':
        plan.addArc({ p: prim.center }, { p: prim.start }, { p: prim.end }, prim.ccw, REAL);
        break;
      case 'polyline': {
        const pts = simplifyPolyline(prim.points, SIMPLIFY_TOLERANCE_MM);
        if (pts.length === 1 && pts[0]) {
          plan.addPointEntity({ p: pts[0] }, REAL);
          break;
        }
        for (let i = 0; i + 1 < pts.length; i += 1) {
          const a = pts[i];
          const b = pts[i + 1];
          if (a && b) plan.addLine({ p: a }, { p: b }, REAL);
        }
        const firstPt = pts[0];
        const lastPt = pts[pts.length - 1];
        if (prim.closed && pts.length > 2 && firstPt && lastPt) {
          plan.addLine({ p: lastPt }, { p: firstPt }, REAL);
        }
        break;
      }
      default: {
        const exhaustive: never = prim;
        return exhaustive;
      }
    }
  }
}
