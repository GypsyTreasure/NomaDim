/**
 * Mesh ⨯ plane sectioning (#1): slice a body's triangle mesh with the active
 * sketch plane and return, as world-space segments, both (a) the CUT outline
 * where the plane passes through the solid and (b) the boundary OUTLINE of any
 * body face that lies ON the plane (e.g. the face you're sketching on). Used to
 * draw a DISPLAY-ONLY reference while sketching — never editable, never
 * persisted.
 *
 * Pure numeric geometry (no THREE, no DOM) so it unit-tests without a canvas
 * (R11 spirit). Works straight off the transferred typed arrays the viewport
 * already holds, so no kernel round-trip is needed.
 */

export type Triple = readonly [number, number, number];

/** Quantize a coordinate for edge-identity keys (~0.1 µm), robust to vertex duplication. */
function coordKey(x: number, y: number, z: number): string {
  return `${String(Math.round(x * 1e4))},${String(Math.round(y * 1e4))},${String(Math.round(z * 1e4))}`;
}

/**
 * Safety bound on emitted segments per slice. A cut only touches the band of
 * triangles the plane passes through, so real sections are small; this guards a
 * pathological mesh from flooding the line buffer (cf. ADR-0048's arc cap).
 */
export const MAX_SECTION_SEGMENTS = 20000;

/** Signed distance of point `p` from the plane (origin `o`, unit-ish normal `n`). */
function signedDistance(px: number, py: number, pz: number, o: Triple, n: Triple): number {
  return (px - o[0]) * n[0] + (py - o[1]) * n[1] + (pz - o[2]) * n[2];
}

/**
 * Returns the section of one indexed triangle mesh by the plane as a flat array
 * of world-space segment endpoints `[x0,y0,z0, x1,y1,z1, …]` (two points per
 * crossed triangle). Triangles that do not straddle the plane contribute
 * nothing; a triangle lying in the plane is skipped (all distances ~0) rather
 * than emitting noise.
 */
export function sliceMesh(
  positions: Float32Array,
  indices: Uint32Array,
  origin: Triple,
  normal: Triple
): number[] {
  const out: number[] = [];
  const eps = 1e-7;
  const triCount = Math.floor(indices.length / 3);

  // Coplanar-face edges, tallied by endpoint-pair key: an edge shared by two
  // coplanar triangles (count 2) is interior; a count of 1 is the face
  // boundary — that perimeter is the on-surface outline (#1).
  const coEdges = new Map<
    string,
    { n: number; c: readonly [number, number, number, number, number, number] }
  >();
  const addCoEdge = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number
  ): void => {
    const k0 = coordKey(x0, y0, z0);
    const k1 = coordKey(x1, y1, z1);
    const key = k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`;
    const e = coEdges.get(key);
    if (e) e.n += 1;
    else coEdges.set(key, { n: 1, c: [x0, y0, z0, x1, y1, z1] });
  };

  for (let t = 0; t < triCount; t += 1) {
    if (out.length >= MAX_SECTION_SEGMENTS * 6) break;
    const ia = indices[t * 3] ?? 0;
    const ib = indices[t * 3 + 1] ?? 0;
    const ic = indices[t * 3 + 2] ?? 0;
    // Vertex coordinates.
    const ax = positions[ia * 3] ?? 0;
    const ay = positions[ia * 3 + 1] ?? 0;
    const az = positions[ia * 3 + 2] ?? 0;
    const bx = positions[ib * 3] ?? 0;
    const by = positions[ib * 3 + 1] ?? 0;
    const bz = positions[ib * 3 + 2] ?? 0;
    const cx = positions[ic * 3] ?? 0;
    const cy = positions[ic * 3 + 1] ?? 0;
    const cz = positions[ic * 3 + 2] ?? 0;

    const da = signedDistance(ax, ay, az, origin, normal);
    const db = signedDistance(bx, by, bz, origin, normal);
    const dc = signedDistance(cx, cy, cz, origin, normal);

    // Entirely on one side (all strictly +, or all strictly −): no crossing.
    if ((da > eps && db > eps && dc > eps) || (da < -eps && db < -eps && dc < -eps)) {
      continue;
    }
    // Coplanar triangle (a face lying ON the plane): tally its edges so the
    // face's boundary — not its filled interior — is emitted afterward (#1).
    if (Math.abs(da) <= eps && Math.abs(db) <= eps && Math.abs(dc) <= eps) {
      addCoEdge(ax, ay, az, bx, by, bz);
      addCoEdge(bx, by, bz, cx, cy, cz);
      addCoEdge(cx, cy, cz, ax, ay, az);
      continue;
    }

    // Gather zero-crossing points on the three edges. A strict-sign split
    // (one side `< 0`, the other `>= 0`) yields exactly two points for a clean
    // cut and avoids double-counting a vertex that sits on the plane.
    const pts: number[] = [];
    const edge = (
      d0: number,
      x0: number,
      y0: number,
      z0: number,
      d1: number,
      x1: number,
      y1: number,
      z1: number
    ): void => {
      const s0 = d0 < 0;
      const s1 = d1 < 0;
      if (s0 === s1) return;
      const denom = d0 - d1;
      const tt = Math.abs(denom) < eps ? 0.5 : d0 / denom;
      pts.push(x0 + (x1 - x0) * tt, y0 + (y1 - y0) * tt, z0 + (z1 - z0) * tt);
    };
    edge(da, ax, ay, az, db, bx, by, bz);
    edge(db, bx, by, bz, dc, cx, cy, cz);
    edge(dc, cx, cy, cz, da, ax, ay, az);

    // A clean crossing yields exactly two points (6 coords) → one segment.
    if (pts.length >= 6) {
      for (let k = 0; k < 6; k += 1) out.push(pts[k] ?? 0);
    }
  }

  // Emit the boundary of every coplanar face (edges used by a single coplanar
  // triangle) — the outline of geometry that lies on the plane's surface (#1).
  for (const e of coEdges.values()) {
    if (out.length >= MAX_SECTION_SEGMENTS * 6) break;
    if (e.n === 1) out.push(e.c[0], e.c[1], e.c[2], e.c[3], e.c[4], e.c[5]);
  }

  return out;
}

/** A coplanar triangle's world-space corner coordinates. */
type Tri = readonly [number, number, number, number, number, number, number, number, number];

/**
 * True when point P lies within triangle ABC (all assumed coplanar). Uses the
 * sign of the three edge-cross-products projected on the triangle normal, with a
 * small tolerance so a pick landing on an edge/vertex still counts.
 */
function pointInTri(px: number, py: number, pz: number, t: Tri): boolean {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
  // Triangle normal = (B-A)×(C-A).
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  // Signed sub-triangle areas (edge × P-edge) dotted with the normal.
  const edge = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number => {
    const e0x = x1 - x0;
    const e0y = y1 - y0;
    const e0z = z1 - z0;
    const e1x = px - x0;
    const e1y = py - y0;
    const e1z = pz - z0;
    const cxx = e0y * e1z - e0z * e1y;
    const cyy = e0z * e1x - e0x * e1z;
    const czz = e0x * e1y - e0y * e1x;
    return cxx * nx + cyy * ny + czz * nz;
  };
  const w0 = edge(ax, ay, az, bx, by, bz);
  const w1 = edge(bx, by, bz, cx, cy, cz);
  const w2 = edge(cx, cy, cz, ax, ay, az);
  const tol = -1e-6 * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) + 1);
  return (w0 >= tol && w1 >= tol && w2 >= tol) || (w0 <= -tol && w1 <= -tol && w2 <= -tol);
}

/**
 * Boundary outline of the ONE mesh face under a face-pick cursor (#10). Returns
 * world-space segment endpoints `[x0,y0,z0,x1,y1,z1,…]`: every edge used by
 * exactly one triangle of the connected coplanar region containing the pick
 * point `origin`. Pure numeric; `positions`/`indices` are the transferred body
 * mesh (already world-space, identity transform).
 *
 * Coplanarity alone is not enough: a body can have several distinct faces lying
 * on the same infinite plane (a step, a slot, the opposite side of a thin wall),
 * and gathering every on-plane triangle would splice a stray triangle from the
 * original surface into the picked face's outline. So we seed at the triangle
 * under the cursor and flood-fill only across SHARED edges, yielding the single
 * contiguous face the user actually pointed at.
 */
export function coplanarFaceOutline(
  positions: Float32Array,
  indices: Uint32Array,
  origin: Triple,
  normal: Triple
): number[] {
  const eps = 1e-4; // mm — a mesh vertex "on" the picked plane
  const triCount = Math.floor(indices.length / 3);

  // 1) Collect the on-plane triangles and index them by their (undirected) edge
  //    keys so we can walk from a triangle to its coplanar neighbours.
  const tris: Tri[] = [];
  const triEdgeKeys: [string, string, string][] = [];
  const edgeToTris = new Map<string, number[]>();
  const edgeKey = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number
  ): string => {
    const k0 = coordKey(x0, y0, z0);
    const k1 = coordKey(x1, y1, z1);
    return k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`;
  };
  for (let t = 0; t < triCount; t += 1) {
    const ia = indices[t * 3] ?? 0;
    const ib = indices[t * 3 + 1] ?? 0;
    const ic = indices[t * 3 + 2] ?? 0;
    const ax = positions[ia * 3] ?? 0;
    const ay = positions[ia * 3 + 1] ?? 0;
    const az = positions[ia * 3 + 2] ?? 0;
    const bx = positions[ib * 3] ?? 0;
    const by = positions[ib * 3 + 1] ?? 0;
    const bz = positions[ib * 3 + 2] ?? 0;
    const cx = positions[ic * 3] ?? 0;
    const cy = positions[ic * 3 + 1] ?? 0;
    const cz = positions[ic * 3 + 2] ?? 0;
    if (
      Math.abs(signedDistance(ax, ay, az, origin, normal)) > eps ||
      Math.abs(signedDistance(bx, by, bz, origin, normal)) > eps ||
      Math.abs(signedDistance(cx, cy, cz, origin, normal)) > eps
    ) {
      continue;
    }
    const id = tris.length;
    tris.push([ax, ay, az, bx, by, bz, cx, cy, cz]);
    const e0 = edgeKey(ax, ay, az, bx, by, bz);
    const e1 = edgeKey(bx, by, bz, cx, cy, cz);
    const e2 = edgeKey(cx, cy, cz, ax, ay, az);
    triEdgeKeys.push([e0, e1, e2]);
    for (const k of [e0, e1, e2]) {
      const l = edgeToTris.get(k);
      if (l) l.push(id);
      else edgeToTris.set(k, [id]);
    }
  }
  if (tris.length === 0) return [];

  // 2) Seed at the triangle under the cursor: the one containing the pick point,
  //    else the nearest by centroid (robust to eps at edges/corners).
  let seed = -1;
  for (const [i, t] of tris.entries()) {
    if (pointInTri(origin[0], origin[1], origin[2], t)) {
      seed = i;
      break;
    }
  }
  if (seed === -1) {
    let best = Infinity;
    for (const [i, t] of tris.entries()) {
      const cxm = (t[0] + t[3] + t[6]) / 3;
      const cym = (t[1] + t[4] + t[7]) / 3;
      const czm = (t[2] + t[5] + t[8]) / 3;
      const d = (cxm - origin[0]) ** 2 + (cym - origin[1]) ** 2 + (czm - origin[2]) ** 2;
      if (d < best) {
        best = d;
        seed = i;
      }
    }
  }

  // 3) Flood-fill from the seed across shared edges → the connected face only.
  const connected = new Set<number>([seed]);
  const stack = [seed];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === undefined) break;
    for (const k of triEdgeKeys[cur] ?? []) {
      for (const nb of edgeToTris.get(k) ?? []) {
        if (!connected.has(nb)) {
          connected.add(nb);
          stack.push(nb);
        }
      }
    }
  }

  // 4) Emit the boundary of the connected region: edges used by exactly one of
  //    its triangles (shared interior edges are used twice and dropped).
  const edges = new Map<
    string,
    { n: number; c: readonly [number, number, number, number, number, number] }
  >();
  const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
    const key = edgeKey(x0, y0, z0, x1, y1, z1);
    const e = edges.get(key);
    if (e) e.n += 1;
    else edges.set(key, { n: 1, c: [x0, y0, z0, x1, y1, z1] });
  };
  for (const [id, t] of tris.entries()) {
    if (!connected.has(id)) continue;
    add(t[0], t[1], t[2], t[3], t[4], t[5]);
    add(t[3], t[4], t[5], t[6], t[7], t[8]);
    add(t[6], t[7], t[8], t[0], t[1], t[2]);
  }
  const out: number[] = [];
  for (const e of edges.values()) {
    if (e.n === 1) out.push(e.c[0], e.c[1], e.c[2], e.c[3], e.c[4], e.c[5]);
  }
  return out;
}

/** Even-odd ray-cast point-in-polygon in sketch (u,v) coordinates. */
function pointInLoop(
  px: number,
  py: number,
  poly: readonly { readonly x: number; readonly y: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * True when the sketch-plane point (px,py) lies in a profile region: inside its
 * outer loop and outside every hole (#11 click-to-pick). Pure arithmetic so it
 * unit-tests without a canvas.
 */
export function pointInArea(
  px: number,
  py: number,
  outer: readonly { readonly x: number; readonly y: number }[],
  holes: readonly (readonly { readonly x: number; readonly y: number }[])[]
): boolean {
  if (!pointInLoop(px, py, outer)) return false;
  for (const hole of holes) {
    if (pointInLoop(px, py, hole)) return false;
  }
  return true;
}

/** Plane basis as plain triples (origin + in-plane U/V axes + normal). */
export interface PlaneBasisLite {
  readonly origin: Triple;
  readonly uAxis: Triple;
  readonly vAxis: Triple;
  readonly normal: Triple;
}

/**
 * The section's vertices projected into sketch-plane (u, v) coordinates — the
 * snap targets for the Intersect outline (#5). Pure arithmetic (dot products),
 * so it stays THREE-free and callable from the app layer's snap query.
 */
export function sectionPlanePoints(
  positions: Float32Array,
  indices: Uint32Array,
  basis: PlaneBasisLite
): { readonly x: number; readonly y: number }[] {
  const world = sliceMesh(positions, indices, basis.origin, basis.normal);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 2 < world.length; i += 3) {
    const dx = (world[i] ?? 0) - basis.origin[0];
    const dy = (world[i + 1] ?? 0) - basis.origin[1];
    const dz = (world[i + 2] ?? 0) - basis.origin[2];
    pts.push({
      x: dx * basis.uAxis[0] + dy * basis.uAxis[1] + dz * basis.uAxis[2],
      y: dx * basis.vAxis[0] + dy * basis.vAxis[1] + dz * basis.vAxis[2],
    });
  }
  return pts;
}

/** A section as sketch-plane (u, v) segment pairs — the same cut as
 * `sectionPlanePoints`, but kept as ordered endpoint PAIRS so callers can weld
 * them into loops (fill the cut face #3) or project them to real lines (#2). */
export function sectionPlaneSegments(
  positions: Float32Array,
  indices: Uint32Array,
  basis: PlaneBasisLite
): (readonly [SectionPt, SectionPt])[] {
  const world = sliceMesh(positions, indices, basis.origin, basis.normal);
  const project = (i: number): SectionPt => {
    const dx = (world[i] ?? 0) - basis.origin[0];
    const dy = (world[i + 1] ?? 0) - basis.origin[1];
    const dz = (world[i + 2] ?? 0) - basis.origin[2];
    return {
      x: dx * basis.uAxis[0] + dy * basis.uAxis[1] + dz * basis.uAxis[2],
      y: dx * basis.vAxis[0] + dy * basis.vAxis[1] + dz * basis.vAxis[2],
    };
  };
  const segs: (readonly [SectionPt, SectionPt])[] = [];
  for (let i = 0; i + 5 < world.length; i += 6) segs.push([project(i), project(i + 3)]);
  return segs;
}

export interface SectionPt {
  readonly x: number;
  readonly y: number;
}

/**
 * Weld section segments (shared endpoints) into ordered loops, so the cut face
 * can be FILLED (a clipped solid reads as solid, not a hollow shell — #3). Each
 * cut vertex on a closed solid has degree 2, so a greedy chain walk recovers the
 * boundary loops; open chains (a face-boundary outline) are returned too but
 * only loops with ≥ 3 points are emitted. Pure — unit-testable without a canvas.
 */
export function assembleSectionLoops(
  segments: readonly (readonly [SectionPt, SectionPt])[]
): SectionPt[][] {
  const Q = 1e3; // weld tolerance ~1e-3 mm (section endpoints from shared edges match closely)
  const key = (p: SectionPt): string =>
    `${String(Math.round(p.x * Q))}:${String(Math.round(p.y * Q))}`;
  const adj = new Map<string, { toKey: string; seg: number; from: SectionPt; to: SectionPt }[]>();
  const push = (
    k: string,
    e: { toKey: string; seg: number; from: SectionPt; to: SectionPt }
  ): void => {
    const bucket = adj.get(k);
    if (bucket) bucket.push(e);
    else adj.set(k, [e]);
  };
  segments.forEach((s, i) => {
    const [a, b] = s;
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return;
    push(ka, { toKey: kb, seg: i, from: a, to: b });
    push(kb, { toKey: ka, seg: i, from: b, to: a });
  });
  const used = new Set<number>();
  const loops: SectionPt[][] = [];
  for (let i = 0; i < segments.length; i += 1) {
    if (used.has(i)) continue;
    const startSeg = segments[i];
    if (!startSeg) continue;
    const startKey = key(startSeg[0]);
    let curKey = startKey;
    const loop: SectionPt[] = [];
    let guard = 0;
    while (guard <= segments.length) {
      guard += 1;
      const edges = adj.get(curKey);
      const next = edges?.find((e) => !used.has(e.seg));
      if (!next) break;
      used.add(next.seg);
      loop.push(next.from);
      curKey = next.toKey;
      if (curKey === startKey) break; // closed
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
