import type { OpenCascadeInstance, TopoDS_Face, TopoDS_Shape } from 'opencascade.js';
import { VIEWPORT_ANGULAR_DEFLECTION_DEG, VIEWPORT_LINEAR_DEFLECTION_MM } from '../core';
import type { FacePlaneResult } from '../kernel/protocol';
import { triangulationOf } from './tessellate';
import { enumArg, enumMember, int } from './occtCompat';

/**
 * Resolves the planar body face under a picked world point into a sketch
 * plane (F2 sketch-on-face). Works from the face triangulations (the same
 * data the viewport mesh comes from): the face is scored by how close the pick
 * lies to its actual triangle SURFACE (point-to-triangle distance, not the old
 * triangle-centroid distance — which mis-picked a small adjacent face over the
 * large face actually clicked, #2) plus agreement with the picked ray normal,
 * which disambiguates the two faces meeting at a shared edge. If the winning
 * face is planar (BRepAdaptor_Surface = GeomAbs_Plane) its area-weighted
 * centroid + outward normal define the plane, and the in-plane axes are oriented
 * Fusion-style (screen-up follows world +Z, #5). Non-planar/greeble picks → null
 * (the app asks the user to
 * pick a flat face). A `FaceFingerprint` (centroid/normal/area) is returned for
 * future regen-time re-resolution.
 */

type Vec3 = [number, number, number];

const EPS = 1e-9;
/**
 * How strongly matching the picked ray normal outranks raw surface proximity
 * (mm). At a shared edge both faces sit ~0 mm from the pick, so the face whose
 * outward normal agrees with the ray (align ≈ +1) must win over the one seen
 * edge-on (align ≈ 0) or the back face (align ≈ −1). 2 mm dominates any
 * realistic near-tie without overriding a clearly-closer face.
 */
const NORMAL_WEIGHT_MM = 2;

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Squared distance from point p to triangle abc (Ericson, Real-Time Collision
 * Detection §5.1.5) — the closest point may be on a vertex, an edge, or the
 * interior, so a big triangle the pick sits inside scores ~0 (unlike centroid
 * distance).
 */
function pointTriangleDistSq(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const q: Vec3 = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
    return dot(sub(p, q), sub(p, q));
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const q: Vec3 = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
    return dot(sub(p, q), sub(p, q));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const q: Vec3 = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
    return dot(sub(p, q), sub(p, q));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const q: Vec3 = [
    a[0] + ab[0] * v + ac[0] * w,
    a[1] + ab[1] * v + ac[1] * w,
    a[2] + ab[2] * v + ac[2] * w,
  ];
  return dot(sub(p, q), sub(p, q));
}

/**
 * In-plane axes oriented like Fusion 360 (#5): screen-up (the sketch Y axis)
 * follows world **+Z** projected onto the face, so a wall sketch stands upright;
 * for a near-horizontal face (normal ≈ ±Z, where +Z projects to nothing) it
 * falls back to world **+Y** as up. X = Y × normal keeps (x, y, normal)
 * right-handed (normal = x × y), matching the plane convention elsewhere.
 */
function fusionAxes(normal: Vec3): { xAxis: Vec3; yAxis: Vec3 } {
  const worldUp: Vec3 = [0, 0, 1];
  const upRef: Vec3 = Math.abs(dot(normal, worldUp)) > 0.999 ? [0, 1, 0] : worldUp;
  const proj = dot(upRef, normal);
  const yAxis = normalize([
    upRef[0] - normal[0] * proj,
    upRef[1] - normal[1] * proj,
    upRef[2] - normal[2] * proj,
  ]);
  const xAxis = normalize(cross(yAxis, normal));
  return { xAxis, yAxis };
}

function isPlanar(oc: OpenCascadeInstance, face: TopoDS_Face): boolean {
  const surf = new oc.BRepAdaptor_Surface_2(face, false);
  const planar = int(surf.GetType()) === int(oc.GeomAbs_SurfaceType.GeomAbs_Plane);
  surf.delete();
  return planar;
}

interface FaceAccum {
  area: number;
  centroid: Vec3; // area-weighted (not yet divided)
  normalSum: Vec3; // area-weighted node-normal sum
  minSurfDist: number; // min point-to-triangle distance
  planar: boolean;
}

export function resolveSketchFace(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  point: readonly [number, number, number],
  pickNormal?: readonly [number, number, number] | null
): FacePlaneResult | null {
  const pn: Vec3 | null =
    pickNormal && Math.hypot(pickNormal[0], pickNormal[1], pickNormal[2]) > EPS
      ? normalize([pickNormal[0], pickNormal[1], pickNormal[2]])
      : null;
  const p: Vec3 = [point[0], point[1], point[2]];
  const mesh = new oc.BRepMesh_IncrementalMesh_2(
    shape,
    VIEWPORT_LINEAR_DEFLECTION_MM,
    false,
    (VIEWPORT_ANGULAR_DEFLECTION_DEG * Math.PI) / 180,
    false
  );

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    enumArg(oc.TopAbs_ShapeEnum.TopAbs_FACE),
    enumArg(oc.TopAbs_ShapeEnum.TopAbs_SHAPE)
  );

  let best: FaceAccum | null = null;

  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triHandle = triangulationOf(oc, face, location);

    if (!triHandle.IsNull()) {
      const tri = triHandle.get();
      tri.ComputeNormals();
      const transform = location.Transformation();
      // Poly_Triangulation normals follow the surface's natural orientation, not
      // the face's orientation in the solid — so a REVERSED face yields INWARD
      // normals. Flip to the true outward normal (same as the tessellator) so
      // the pick-normal disambiguation (#2) and the sketch orientation (#5) both
      // use a consistent outward direction.
      const normalSign =
        enumMember(face.Orientation_1()).value ===
        enumMember(oc.TopAbs_Orientation.TopAbs_REVERSED).value
          ? -1
          : 1;
      const nbNodes = int(tri.NbNodes());
      const nodes: Vec3[] = [];
      const normals: Vec3[] = [];
      for (let i = 1; i <= nbNodes; i += 1) {
        const p = tri.Node(i).Transformed(transform);
        nodes.push([p.X(), p.Y(), p.Z()]);
        const n = tri.Normal_1(i).Transformed(transform);
        normals.push([n.X() * normalSign, n.Y() * normalSign, n.Z() * normalSign]);
      }

      const acc: FaceAccum = {
        area: 0,
        centroid: [0, 0, 0],
        normalSum: [0, 0, 0],
        minSurfDist: Infinity,
        planar: isPlanar(oc, face),
      };
      const nbTri = int(tri.NbTriangles());
      for (let i = 1; i <= nbTri; i += 1) {
        const t = tri.Triangle(i);
        const a = nodes[int(t.Value(1)) - 1];
        const b = nodes[int(t.Value(2)) - 1];
        const c = nodes[int(t.Value(3)) - 1];
        if (!a || !b || !c) continue;
        const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const nx = cross(ab, ac);
        const area = 0.5 * Math.hypot(nx[0], nx[1], nx[2]);
        const cx: Vec3 = [
          (a[0] + b[0] + c[0]) / 3,
          (a[1] + b[1] + c[1]) / 3,
          (a[2] + b[2] + c[2]) / 3,
        ];
        acc.area += area;
        acc.centroid[0] += cx[0] * area;
        acc.centroid[1] += cx[1] * area;
        acc.centroid[2] += cx[2] * area;
        const nn = normals[int(t.Value(1)) - 1] ?? [0, 0, 0];
        acc.normalSum[0] += nn[0] * area;
        acc.normalSum[1] += nn[1] * area;
        acc.normalSum[2] += nn[2] * area;
        // Distance to the triangle SURFACE (not its centroid): the face the ray
        // actually hit scores ~0 even where its triangles are large (#2).
        const dSq = pointTriangleDistSq(p, a, b, c);
        if (dSq < acc.minSurfDist) acc.minSurfDist = dSq;
      }
      acc.minSurfDist = Math.sqrt(acc.minSurfDist);

      // Score: surface proximity, minus a bonus for a face whose outward normal
      // agrees with the picked ray — so at a shared edge the front face wins
      // over the edge-on/back face (#2). Lower is better.
      const scoreOf = (f: FaceAccum): number => {
        if (!pn) return f.minSurfDist;
        const fn = normalize(f.normalSum);
        return f.minSurfDist - NORMAL_WEIGHT_MM * dot(fn, pn);
      };
      if (acc.area > EPS && (best === null || scoreOf(acc) < scoreOf(best))) {
        best = acc;
      }
    }

    triHandle.delete();
    location.delete();
    face.delete();
    explorer.Next();
  }
  explorer.delete();
  mesh.delete();

  if (!best?.planar) return null;

  const centroid: Vec3 = [
    best.centroid[0] / best.area,
    best.centroid[1] / best.area,
    best.centroid[2] / best.area,
  ];
  const normal = normalize(best.normalSum);
  const { xAxis, yAxis } = fusionAxes(normal);
  return {
    origin: centroid,
    xAxis,
    yAxis,
    normal,
    fingerprint: { centroid, normal, areaMm2: best.area },
  };
}
