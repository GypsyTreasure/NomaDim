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
