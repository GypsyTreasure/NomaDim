import type { OpenCascadeInstance, TopoDS_Face, TopoDS_Shape } from 'opencascade.js';
import { VIEWPORT_ANGULAR_DEFLECTION_DEG, VIEWPORT_LINEAR_DEFLECTION_MM } from '../core';
import type { FacePlaneResult } from '../kernel/protocol';
import { triangulationOf } from './tessellate';
import { enumArg, int } from './occtCompat';

/**
 * Resolves the planar body face under a picked world point into a sketch
 * plane (F2 sketch-on-face). Works from the face triangulations (the same
 * data the viewport mesh comes from): the face whose triangles lie closest to
 * the pick wins; if it is planar (BRepAdaptor_Surface = GeomAbs_Plane) its
 * area-weighted centroid + outward normal define the plane, and an in-plane X
 * axis is chosen deterministically. Non-planar/greeble picks → null (the app
 * asks the user to pick a flat face). A `FaceFingerprint` (centroid/normal/
 * area) is returned for future regen-time re-resolution.
 */

type Vec3 = [number, number, number];

const EPS = 1e-9;

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A deterministic in-plane X axis: the world axis least aligned with the normal, projected. */
function inPlaneX(normal: Vec3): Vec3 {
  const axes: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  let ref: Vec3 = [1, 0, 0];
  let best = Infinity;
  for (const axis of axes) {
    const d = Math.abs(normal[0] * axis[0] + normal[1] * axis[1] + normal[2] * axis[2]);
    if (d < best) {
      best = d;
      ref = axis;
    }
  }
  const dot = normal[0] * ref[0] + normal[1] * ref[1] + normal[2] * ref[2];
  return normalize([ref[0] - normal[0] * dot, ref[1] - normal[1] * dot, ref[2] - normal[2] * dot]);
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
  minPickDist: number;
  planar: boolean;
}

export function resolveSketchFace(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  point: readonly [number, number, number]
): FacePlaneResult | null {
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
      const nbNodes = int(tri.NbNodes());
      const nodes: Vec3[] = [];
      const normals: Vec3[] = [];
      for (let i = 1; i <= nbNodes; i += 1) {
        const p = tri.Node(i).Transformed(transform);
        nodes.push([p.X(), p.Y(), p.Z()]);
        const n = tri.Normal_1(i).Transformed(transform);
        normals.push([n.X(), n.Y(), n.Z()]);
      }

      const acc: FaceAccum = {
        area: 0,
        centroid: [0, 0, 0],
        normalSum: [0, 0, 0],
        minPickDist: Infinity,
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
        const d = Math.hypot(cx[0] - point[0], cx[1] - point[1], cx[2] - point[2]);
        if (d < acc.minPickDist) acc.minPickDist = d;
      }

      if (acc.area > EPS && (best === null || acc.minPickDist < best.minPickDist)) {
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
  const xAxis = inPlaneX(normal);
  const yAxis = cross(normal, xAxis);
  return {
    origin: centroid,
    xAxis,
    yAxis,
    normal,
    fingerprint: { centroid, normal, areaMm2: best.area },
  };
}
