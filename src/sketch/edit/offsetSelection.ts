import {
  add,
  createId,
  distance,
  normalize,
  scale,
  sub,
  vec2,
  type EntityId,
  type PointId,
  type Vec2,
} from '../../core';
import { pointMap, type Sketch, type SketchEntity, type SketchPoint } from '../../document';
import type { SketchGeometryDelta } from '../sketchTransform';

/**
 * Multi-entity Offset (AutoCAD parity). Offsets a whole SELECTION at once by a
 * typed distance and side:
 *  - connected line chains (a rectangle loop, a polyline) are offset as a unit —
 *    each segment is offset, then adjacent offset lines are intersected to form
 *    clean mitred corners, so a loop offsets to a proper parallel loop (welded
 *    shared corners), not disjoint segments;
 *  - circles and arcs offset concentrically (r ± distance);
 *  - a lone line offsets perpendicular.
 * Solver-free; returns plain new points + entities for `AddSketchGeometry`.
 *
 * `side`: 'a' grows a closed loop / offsets a line to its left / enlarges a
 * circle; 'b' is the opposite. For a closed loop the normal is oriented so 'a'
 * is consistently OUTWARD regardless of the loop's winding.
 */

const EPS = 1e-9;

export type OffsetSide = 'a' | 'b';

function leftPerp(d: Vec2): Vec2 {
  return { x: -d.y, y: d.x };
}
/** 2D cross product z-component. */
function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}
/** Intersection of infinite lines (p1 along d1) and (p2 along d2); null if parallel. */
function lineIntersect(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = cross(d1, d2);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(sub(p2, p1), d2) / denom;
  return add(p1, scale(d1, t));
}

function existingIds(sketch: Sketch): Set<string> {
  const ids = new Set<string>();
  for (const p of sketch.points) ids.add(p.id);
  for (const e of sketch.entities) ids.add(e.id);
  for (const d of sketch.dimensions) ids.add(d.id);
  return ids;
}

/** Order a set of selected line entities sharing endpoints into vertex chains. */
interface Chain {
  readonly vertices: Vec2[];
  readonly closed: boolean;
  readonly construction: boolean;
}

function buildLineChains(
  lines: readonly { a: Vec2; b: Vec2; ka: string; kb: string; construction: boolean }[]
): Chain[] {
  // Adjacency by endpoint key → segment indices.
  const adj = new Map<string, number[]>();
  const push = (k: string, i: number): void => {
    const l = adj.get(k);
    if (l) l.push(i);
    else adj.set(k, [i]);
  };
  lines.forEach((l, i) => {
    push(l.ka, i);
    push(l.kb, i);
  });
  const used = new Set<number>();
  const pointOf = new Map<string, Vec2>();
  for (const l of lines) {
    pointOf.set(l.ka, l.a);
    pointOf.set(l.kb, l.b);
  }
  const chains: Chain[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (used.has(i)) continue;
    // Walk backward to a chain start (an endpoint of degree 1) if open.
    const construction = lines[i]?.construction ?? false;
    // Collect this connected component's segments.
    const comp: number[] = [];
    const stack = [i];
    const seen = new Set<number>([i]);
    while (stack.length) {
      const s = stack.pop();
      if (s === undefined) break;
      comp.push(s);
      const seg = lines[s];
      if (!seg) continue;
      for (const k of [seg.ka, seg.kb]) {
        for (const n of adj.get(k) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
    }
    for (const s of comp) used.add(s);

    // Order the component into a vertex path by walking endpoints.
    const degree = new Map<string, number>();
    for (const s of comp) {
      const seg = lines[s];
      if (!seg) continue;
      degree.set(seg.ka, (degree.get(seg.ka) ?? 0) + 1);
      degree.set(seg.kb, (degree.get(seg.kb) ?? 0) + 1);
    }
    let startKey: string | null = null;
    for (const [k, d] of degree) if (d === 1) startKey = startKey ?? k;
    const closed = startKey === null;
    if (startKey === null) {
      const first = lines[comp[0] ?? 0];
      startKey = first ? first.ka : null;
    }
    if (startKey === null) continue;

    const localUsed = new Set<number>();
    const vertices: Vec2[] = [];
    let curKey = startKey;
    const startVec = pointOf.get(curKey);
    if (startVec) vertices.push(startVec);
    let guard = 0;
    while (guard <= comp.length) {
      guard += 1;
      const next = comp.find((s) => {
        if (localUsed.has(s)) return false;
        const seg = lines[s];
        return seg ? seg.ka === curKey || seg.kb === curKey : false;
      });
      if (next === undefined) break;
      localUsed.add(next);
      const seg = lines[next];
      if (!seg) break;
      const otherKey = seg.ka === curKey ? seg.kb : seg.ka;
      const v = pointOf.get(otherKey);
      if (v) vertices.push(v);
      curKey = otherKey;
      if (closed && curKey === startKey) {
        vertices.pop(); // drop the duplicate closing vertex; wrap is implied
        break;
      }
    }
    if (vertices.length >= 2) chains.push({ vertices, closed, construction });
  }
  return chains;
}

/** Signed area (>0 = CCW) of a closed polygon. */
function signedArea(v: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < v.length; i += 1) {
    const p = v[i];
    const q = v[(i + 1) % v.length];
    if (p && q) a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Offset a selection by `distance` on `side`. Returns null if nothing
 * offsettable was found. Coordinates are exact; corners of line chains are
 * mitred by intersecting adjacent offset lines.
 */
export function offsetSelection(
  sketch: Sketch,
  entityIds: readonly EntityId[],
  distanceMm: number,
  side: OffsetSide
): SketchGeometryDelta | null {
  if (!(distanceMm > 0)) return null;
  const wanted = new Set(entityIds);
  const targets = sketch.entities.filter((e) => wanted.has(e.id));
  if (targets.length === 0) return null;
  const pts = pointMap(sketch);
  const at = (id: PointId): Vec2 => {
    const p = pts.get(id);
    return vec2(p?.x ?? 0, p?.y ?? 0);
  };
  const key = (p: Vec2): string =>
    `${String(Math.round(p.x * 1e4))}:${String(Math.round(p.y * 1e4))}`;

  const taken = existingIds(sketch);
  const outPoints: SketchPoint[] = [];
  const outEntities: SketchEntity[] = [];
  const mkPoint = (p: Vec2): PointId => {
    const id = createId<'PointId'>(taken);
    taken.add(id);
    outPoints.push({ id, x: p.x, y: p.y });
    return id;
  };
  const mkId = (): EntityId => {
    const id = createId<'EntityId'>(taken);
    taken.add(id);
    return id;
  };

  const lineInputs: { a: Vec2; b: Vec2; ka: string; kb: string; construction: boolean }[] = [];
  for (const e of targets) {
    if (e.type === 'line') {
      const a = at(e.start);
      const b = at(e.end);
      lineInputs.push({ a, b, ka: key(a), kb: key(b), construction: e.construction });
    } else if (e.type === 'circle') {
      const c = at(e.center);
      const r2 = side === 'a' ? e.r + distanceMm : e.r - distanceMm;
      if (r2 > EPS) {
        outEntities.push({
          type: 'circle',
          id: mkId(),
          center: mkPoint(c),
          r: r2,
          construction: e.construction,
        });
      }
    } else if (e.type === 'arc') {
      const c = at(e.center);
      const s = at(e.start);
      const en = at(e.end);
      const r = distance(c, s);
      const r2 = side === 'a' ? r + distanceMm : r - distanceMm;
      if (r > EPS && r2 > EPS) {
        const scaleTo = (p: Vec2): Vec2 => add(c, scale(sub(p, c), r2 / r));
        outEntities.push({
          type: 'arc',
          id: mkId(),
          center: mkPoint(c),
          start: mkPoint(scaleTo(s)),
          end: mkPoint(scaleTo(en)),
          ccw: e.ccw,
          construction: e.construction,
        });
      }
    }
    // points/splines: no offset.
  }

  for (const chain of buildLineChains(lineInputs)) {
    const v = chain.vertices;
    const n = v.length;
    if (n < 2) continue;
    // Consistent normal: for a closed loop orient so 'a' is OUTWARD; for an open
    // chain 'a' is the left of travel.
    let sign = side === 'a' ? 1 : -1;
    if (chain.closed) {
      // For a closed loop, 'a' is OUTWARD. The left normal points INWARD on a
      // CCW loop, so invert; a CW loop (negative area) inverts back.
      sign = -sign;
      if (signedArea(v) < 0) sign = -sign;
    }
    const d = distanceMm * sign;

    // Per-edge offset line: base point (first vertex of the edge) + normal*d, dir.
    const edgeCount = chain.closed ? n : n - 1;
    const edgeBase: Vec2[] = [];
    const edgeDir: Vec2[] = [];
    for (let i = 0; i < edgeCount; i += 1) {
      const p = v[i];
      const q = v[(i + 1) % n];
      if (!p || !q) continue;
      const dir = normalize(sub(q, p));
      const nrm = leftPerp(dir);
      edgeBase.push(add(p, scale(nrm, d)));
      edgeDir.push(dir);
    }
    // New vertex at each original vertex = intersection of the two adjacent
    // offset edges (mitre). Open-chain endpoints use the single edge's offset.
    const newV: Vec2[] = [];
    for (let i = 0; i < n; i += 1) {
      const prevE = chain.closed ? (i - 1 + edgeCount) % edgeCount : i - 1;
      const curE = chain.closed ? i % edgeCount : i;
      const hasPrev = prevE >= 0 && prevE < edgeBase.length;
      const hasCur = curE >= 0 && curE < edgeBase.length && (chain.closed || i < n - 1);
      if (hasPrev && hasCur) {
        const bp = edgeBase[prevE];
        const dp = edgeDir[prevE];
        const bc = edgeBase[curE];
        const dc = edgeDir[curE];
        const corner = bp && dp && bc && dc ? lineIntersect(bp, dp, bc, dc) : null;
        const vv = v[i];
        newV.push(corner ?? (bc && vv ? bc : (vv ?? vec2(0, 0))));
      } else if (hasCur) {
        const bc = edgeBase[curE];
        newV.push(bc ?? v[i] ?? vec2(0, 0));
      } else if (hasPrev) {
        // last vertex of an open chain: project along the previous edge.
        const bp = edgeBase[prevE];
        const dp = edgeDir[prevE];
        const vv = v[i];
        newV.push(
          bp && dp && vv ? add(bp, scale(dp, distance(v[i - 1] ?? vv, vv))) : (vv ?? vec2(0, 0))
        );
      }
    }
    // Weld the offset vertices into shared points and emit connected lines.
    const ids = newV.map(mkPoint);
    const segs = chain.closed ? ids.length : ids.length - 1;
    for (let i = 0; i < segs; i += 1) {
      const s = ids[i];
      const en = ids[(i + 1) % ids.length];
      if (s && en) {
        outEntities.push({
          type: 'line',
          id: mkId(),
          start: s,
          end: en,
          construction: chain.construction,
        });
      }
    }
  }

  if (outEntities.length === 0) return null;
  return { points: outPoints, entities: outEntities };
}
