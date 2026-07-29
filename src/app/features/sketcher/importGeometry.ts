import type { ImportPrimitive } from '../../../sketch';
import type { GeometryPlan } from './geometryPlan';

/**
 * Turns neutral imported primitives (ADR-0076) into sketch geometry on a
 * GeometryPlan, as CONSTRUCTION (reference) entities — visible, snappable at
 * every vertex, selectable/deletable per shape, and toggle-able to real
 * geometry with X. Shared vertices merge by coordinate (GeometryPlan), so a
 * polyline imports as a connected chain of points.
 */
export function addImportedPrimitives(
  plan: GeometryPlan,
  primitives: readonly ImportPrimitive[]
): void {
  const CONSTRUCTION = true;
  for (const prim of primitives) {
    switch (prim.kind) {
      case 'line':
        plan.addLine({ p: prim.a }, { p: prim.b }, CONSTRUCTION);
        break;
      case 'circle':
        if (prim.r > 0) plan.addCircle({ p: prim.center }, prim.r, CONSTRUCTION);
        break;
      case 'arc':
        plan.addArc({ p: prim.center }, { p: prim.start }, { p: prim.end }, prim.ccw, CONSTRUCTION);
        break;
      case 'polyline': {
        const pts = prim.points;
        if (pts.length === 1 && pts[0]) {
          plan.addPointEntity({ p: pts[0] }, CONSTRUCTION);
          break;
        }
        for (let i = 0; i + 1 < pts.length; i += 1) {
          const a = pts[i];
          const b = pts[i + 1];
          if (a && b) plan.addLine({ p: a }, { p: b }, CONSTRUCTION);
        }
        const firstPt = pts[0];
        const lastPt = pts[pts.length - 1];
        if (prim.closed && pts.length > 2 && firstPt && lastPt) {
          plan.addLine({ p: lastPt }, { p: firstPt }, CONSTRUCTION);
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
