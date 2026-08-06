import type { EntityId, Vec2 } from '../core';
import type { Curve, EvaluatedEntity } from './entities/curves';

/**
 * AutoCAD-style marquee (box) selection (#6). Two modes decided by the drag
 * direction at the call site: **window** (`crossing=false`, dragged left→right)
 * selects only entities lying WHOLLY inside the box; **crossing**
 * (`crossing=true`, dragged right→left) selects anything the box even touches.
 * Pure geometry over the evaluated curves — DOM-free and unit-tested (R11).
 */

const CIRCLE_SAMPLES = 48;

interface Rect {
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
}

function rectOf(a: Vec2, b: Vec2): Rect {
  return {
    xmin: Math.min(a.x, b.x),
    xmax: Math.max(a.x, b.x),
    ymin: Math.min(a.y, b.y),
    ymax: Math.max(a.y, b.y),
  };
}

function inRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.xmin && p.x <= r.xmax && p.y >= r.ymin && p.y <= r.ymax;
}

/** A dense polyline for any curve kind, so window/crossing tests are uniform. */
function curvePolyline(curve: Curve): Vec2[] {
  switch (curve.kind) {
    case 'segment':
      return [curve.a, curve.b];
    case 'spline':
      return [...curve.samples];
    case 'circle': {
      const pts: Vec2[] = [];
      for (let i = 0; i <= CIRCLE_SAMPLES; i += 1) {
        const t = (i / CIRCLE_SAMPLES) * Math.PI * 2;
        pts.push({
          x: curve.center.x + curve.r * Math.cos(t),
          y: curve.center.y + curve.r * Math.sin(t),
        });
      }
      return pts;
    }
    case 'arc': {
      const pts: Vec2[] = [];
      const steps = Math.max(2, Math.ceil((curve.sweep / (Math.PI * 2)) * CIRCLE_SAMPLES));
      for (let i = 0; i <= steps; i += 1) {
        const t = curve.startAngle + (curve.sweep * i) / steps;
        pts.push({
          x: curve.center.x + curve.r * Math.cos(t),
          y: curve.center.y + curve.r * Math.sin(t),
        });
      }
      return pts;
    }
    default: {
      const never: never = curve;
      return never;
    }
  }
}

/** Do segments p1p2 and p3p4 cross (proper or touching)? */
function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d = (a: Vec2, b: Vec2, c: Vec2): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

/** Does a polyline segment touch the rect (endpoint inside, or crosses an edge)? */
function segmentTouchesRect(a: Vec2, b: Vec2, r: Rect): boolean {
  if (inRect(a, r) || inRect(b, r)) return true;
  const c1 = { x: r.xmin, y: r.ymin };
  const c2 = { x: r.xmax, y: r.ymin };
  const c3 = { x: r.xmax, y: r.ymax };
  const c4 = { x: r.xmin, y: r.ymax };
  return (
    segmentsCross(a, b, c1, c2) ||
    segmentsCross(a, b, c2, c3) ||
    segmentsCross(a, b, c3, c4) ||
    segmentsCross(a, b, c4, c1)
  );
}

/** Entity ids selected by a marquee from `a` to `b`. */
export function entitiesInMarquee(
  evaluated: readonly EvaluatedEntity[],
  a: Vec2,
  b: Vec2,
  crossing: boolean
): EntityId[] {
  const r = rectOf(a, b);
  const out: EntityId[] = [];
  for (const ev of evaluated) {
    const pts = curvePolyline(ev.curve);
    if (pts.length === 0) continue;
    if (crossing) {
      let hit = pts.some((p) => inRect(p, r));
      let prev: Vec2 | null = null;
      for (const cur of pts) {
        if (hit) break;
        if (prev) hit = segmentTouchesRect(prev, cur, r);
        prev = cur;
      }
      if (hit) out.push(ev.entityId);
    } else if (pts.every((p) => inRect(p, r))) {
      out.push(ev.entityId);
    }
  }
  return out;
}
