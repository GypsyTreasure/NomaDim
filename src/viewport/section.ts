/**
 * Mesh ⨯ plane sectioning (#2): slice a body's triangle mesh with the active
 * sketch plane and return the cut outline as world-space segments. Used to draw
 * a DISPLAY-ONLY cross-section of existing bodies while sketching — a visual
 * guide to draw against, never editable geometry and never persisted.
 *
 * Pure numeric geometry (no THREE, no DOM) so it unit-tests without a canvas
 * (R11 spirit). Works straight off the transferred typed arrays the viewport
 * already holds, so no kernel round-trip is needed.
 */

export type Triple = readonly [number, number, number];

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
    // Coplanar-ish triangle: skip (would smear a filled band, not an outline).
    if (Math.abs(da) <= eps && Math.abs(db) <= eps && Math.abs(dc) <= eps) {
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

  return out;
}
