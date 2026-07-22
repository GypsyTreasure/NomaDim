import type {
  OpenCascadeInstance,
  TopoDS_Edge,
  TopoDS_Face,
  TopoDS_Shape,
  TopTools_IndexedDataMapOfShapeListOfShape,
} from 'opencascade.js';
import type { EdgeFingerprint } from '../document';
import type { EdgeTessellation } from '../kernel/protocol';
import { enumArg, int } from './occtCompat';
import { KernelExecError } from './executors/types';

/**
 * Persistent 3D edge references (ARCHITECTURE §8 line 160, MASTER_DOCUMENT
 * F4): a geometric fingerprint `{ midpoint, direction, adjFaceKinds, tol }`
 * computed from the body's edges at pick time and RE-RESOLVED against the
 * body at regen. Resolution matches by adjacent-face-kind signature +
 * direction alignment, then nearest midpoint within tolerance — a modest
 * upstream edit re-resolves, a large one (or a removed edge) fails and the
 * op enters error state (accepted v1 tradeoff). No topological naming in v1.
 */

/** Default pick tolerance (mm) captured into a fingerprint. */
export const DEFAULT_EDGE_MATCH_TOL_MM = 5;
/** Direction-alignment tolerance for a match (|cos θ| ≥ this). */
const DIRECTION_ALIGN_MIN = Math.cos((5 * Math.PI) / 180);
const EDGE_POLYLINE_SAMPLES = 24;

type Vec3 = readonly [number, number, number];

function surfaceKind(oc: OpenCascadeInstance, face: TopoDS_Face): string {
  const surf = new oc.BRepAdaptor_Surface_2(face, false);
  const type = int(surf.GetType());
  surf.delete();
  const tags: Record<number, string> = {
    [int(oc.GeomAbs_SurfaceType.GeomAbs_Plane)]: 'plane',
    [int(oc.GeomAbs_SurfaceType.GeomAbs_Cylinder)]: 'cylinder',
    [int(oc.GeomAbs_SurfaceType.GeomAbs_Cone)]: 'cone',
    [int(oc.GeomAbs_SurfaceType.GeomAbs_Sphere)]: 'sphere',
    [int(oc.GeomAbs_SurfaceType.GeomAbs_Torus)]: 'torus',
  };
  return tags[type] ?? 'freeform';
}

/** Sign-normalizes a direction so an edge and its reverse share a fingerprint. */
function normalizeDirection(x: number, y: number, z: number): Vec3 {
  const len = Math.hypot(x, y, z) || 1;
  let nx = x / len;
  let ny = y / len;
  let nz = z / len;
  // Deterministic sign: largest-magnitude component made positive.
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  const lead = ax >= ay && ax >= az ? nx : ay >= az ? ny : nz;
  if (lead < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  return [nx, ny, nz];
}

function adjacentFaceKinds(
  oc: OpenCascadeInstance,
  edgeFaces: TopTools_IndexedDataMapOfShapeListOfShape,
  index: number
): string[] {
  const list = edgeFaces.FindFromIndex(index);
  const size = int(list.Size());
  const kinds: string[] = [];
  if (size >= 1) {
    const face = oc.TopoDS.Face_1(list.First_1());
    kinds.push(surfaceKind(oc, face));
    face.delete();
  }
  if (size >= 2) {
    const face = oc.TopoDS.Face_1(list.Last_1());
    kinds.push(surfaceKind(oc, face));
    face.delete();
  }
  return kinds.sort();
}

interface EdgeGeometry {
  readonly midpoint: Vec3;
  readonly direction: Vec3;
}

/** Midpoint + unit tangent of an edge at its mid-parameter. */
function edgeGeometry(oc: OpenCascadeInstance, edge: TopoDS_Edge): EdgeGeometry {
  const curve = new oc.BRepAdaptor_Curve_2(edge);
  const f = curve.FirstParameter();
  const l = curve.LastParameter();
  const mid = (f + l) / 2;
  const pnt = new oc.gp_Pnt_1();
  const vec = new oc.gp_Vec_1();
  curve.D1(mid, pnt, vec);
  const midpoint: Vec3 = [pnt.X(), pnt.Y(), pnt.Z()];
  const direction = normalizeDirection(vec.X(), vec.Y(), vec.Z());
  pnt.delete();
  vec.delete();
  curve.delete();
  return { midpoint, direction };
}

/** Samples an edge into a flat world-space polyline for picking/rendering. */
function edgePolyline(oc: OpenCascadeInstance, edge: TopoDS_Edge): Float32Array {
  const curve = new oc.BRepAdaptor_Curve_2(edge);
  const f = curve.FirstParameter();
  const l = curve.LastParameter();
  const out = new Float32Array((EDGE_POLYLINE_SAMPLES + 1) * 3);
  for (let k = 0; k <= EDGE_POLYLINE_SAMPLES; k += 1) {
    const u = f + ((l - f) * k) / EDGE_POLYLINE_SAMPLES;
    const p = curve.Value(u);
    out[k * 3] = p.X();
    out[k * 3 + 1] = p.Y();
    out[k * 3 + 2] = p.Z();
  }
  curve.delete();
  return out;
}

/** Builds the edge→faces ancestor map for a shape (caller deletes it). */
function edgeFaceMap(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape
): TopTools_IndexedDataMapOfShapeListOfShape {
  const map = new oc.TopTools_IndexedDataMapOfShapeListOfShape_1();
  oc.TopExp.MapShapesAndAncestors(
    shape,
    enumArg(oc.TopAbs_ShapeEnum.TopAbs_EDGE),
    enumArg(oc.TopAbs_ShapeEnum.TopAbs_FACE),
    map
  );
  return map;
}

/** Tessellates every edge of a body into pickable polylines + fingerprints (F4). */
export function tessellateBodyEdges(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape
): EdgeTessellation[] {
  const map = edgeFaceMap(oc, shape);
  const count = int(map.Extent());
  const out: EdgeTessellation[] = [];
  for (let i = 1; i <= count; i += 1) {
    const edge = oc.TopoDS.Edge_1(map.FindKey(i));
    const { midpoint, direction } = edgeGeometry(oc, edge);
    const polyline = edgePolyline(oc, edge);
    edge.delete();
    out.push({
      fingerprint: {
        midpoint,
        direction,
        adjFaceKinds: adjacentFaceKinds(oc, map, i),
        tolMm: DEFAULT_EDGE_MATCH_TOL_MM,
      },
      polyline,
    });
  }
  map.delete();
  return out;
}

function kindsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

/**
 * Resolves each fingerprint to a live TopoDS_Edge on `shape` (caller deletes
 * the returned edges). Throws when any fingerprint is unresolvable — the
 * executor turns that into the op's error state (graceful, MASTER_DOCUMENT
 * §4). Matches are scoped to edges with the same adjacent-face-kind signature
 * and aligned direction, then the nearest midpoint within tolerance wins.
 */
export function resolveEdges(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  fingerprints: readonly EdgeFingerprint[]
): TopoDS_Edge[] {
  const map = edgeFaceMap(oc, shape);
  const count = int(map.Extent());

  // Precompute candidate geometry once.
  const candidates: { index: number; geom: EdgeGeometry; kinds: string[] }[] = [];
  for (let i = 1; i <= count; i += 1) {
    const edge = oc.TopoDS.Edge_1(map.FindKey(i));
    candidates.push({
      index: i,
      geom: edgeGeometry(oc, edge),
      kinds: adjacentFaceKinds(oc, map, i),
    });
    edge.delete();
  }

  const resolved: TopoDS_Edge[] = [];
  // Each live edge resolves at most one fingerprint. Two nearby fingerprints of
  // the same face-kind signature (common on complex bodies — parallel fillet
  // edges, boolean seams) would otherwise both grab the single nearest edge,
  // silently dropping the other and double-adding one edge to the maker (an
  // OCCT failure). Claiming edges greedily by nearest-unused avoids both.
  const claimed = new Set<number>();
  try {
    for (const fp of fingerprints) {
      let bestIndex = -1;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const cand of candidates) {
        if (claimed.has(cand.index)) continue;
        if (!kindsEqual(cand.kinds, fp.adjFaceKinds)) continue;
        const dot =
          cand.geom.direction[0] * fp.direction[0] +
          cand.geom.direction[1] * fp.direction[1] +
          cand.geom.direction[2] * fp.direction[2];
        if (Math.abs(dot) < DIRECTION_ALIGN_MIN) continue;
        const dist = Math.hypot(
          cand.geom.midpoint[0] - fp.midpoint[0],
          cand.geom.midpoint[1] - fp.midpoint[1],
          cand.geom.midpoint[2] - fp.midpoint[2]
        );
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = cand.index;
        }
      }
      if (bestIndex < 0 || bestDist > fp.tolMm) {
        throw new KernelExecError(
          'EDGE_UNRESOLVED',
          'An edge could not be located on the current body — re-pick it.'
        );
      }
      claimed.add(bestIndex);
      resolved.push(oc.TopoDS.Edge_1(map.FindKey(bestIndex)));
    }
  } catch (error) {
    for (const edge of resolved) edge.delete();
    map.delete();
    throw error;
  }
  map.delete();
  return resolved;
}
