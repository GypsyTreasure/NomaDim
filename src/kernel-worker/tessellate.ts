import type {
  OpenCascadeInstance,
  TopoDS_Shape,
  TopoDS_Face,
  TopLoc_Location,
  Handle_Poly_Triangulation,
} from 'opencascade.js';
import type { BodyId } from '../core';
import type { MeshQuality, MeshTransfer } from '../kernel/protocol';
import { enumArg, enumMember, int } from './occtCompat';

/**
 * opencascade.js@2.0.0-beta's generated types reference a `Poly_MeshPurpose`
 * type in `BRep_Tool.Triangulation`'s signature without ever declaring or
 * exporting it (upstream generation gap — see ADR-0011). Runtime accepts a
 * plain number (0 = default mesh purpose, confirmed empirically against the
 * WASM binary). Cast through `unknown`, not `any`, and isolated to this one
 * call site.
 */
type TriangulationOf = (
  face: TopoDS_Face,
  location: TopLoc_Location,
  meshPurpose: number
) => Handle_Poly_Triangulation;

export function triangulationOf(
  oc: OpenCascadeInstance,
  face: TopoDS_Face,
  location: TopLoc_Location
): Handle_Poly_Triangulation {
  return (oc.BRep_Tool.Triangulation as unknown as TriangulationOf)(face, location, 0);
}

/**
 * BRepMesh_IncrementalMesh + per-face triangulation extraction into
 * Transferable typed arrays (ARCHITECTURE §6 R5). Applies each face's
 * TopLoc_Location transform to nodes/normals and flips triangle winding for
 * reversed faces, matching standard OCCT tessellation practice.
 */
export function tessellateShape(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  shape: TopoDS_Shape,
  quality: MeshQuality
): MeshTransfer {
  const angularDeflectionRad = (quality.angularDeflectionDeg * Math.PI) / 180;
  const mesh = new oc.BRepMesh_IncrementalMesh_2(
    shape,
    quality.linearDeflectionMm,
    false,
    angularDeflectionRad,
    false
  );

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    enumArg(oc.TopAbs_ShapeEnum.TopAbs_FACE),
    enumArg(oc.TopAbs_ShapeEnum.TopAbs_SHAPE)
  );
  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triHandle = triangulationOf(oc, face, location);

    if (!triHandle.IsNull()) {
      const triangulation = triHandle.get();
      triangulation.ComputeNormals();
      const transform = location.Transformation();
      const isReversed =
        enumMember(face.Orientation_1()).value ===
        enumMember(oc.TopAbs_Orientation.TopAbs_REVERSED).value;

      const nbNodes = int(triangulation.NbNodes());
      for (let i = 1; i <= nbNodes; i += 1) {
        const point = triangulation.Node(i).Transformed(transform);
        positions.push(point.X(), point.Y(), point.Z());
        const normal = triangulation.Normal_1(i).Transformed(transform);
        normals.push(normal.X(), normal.Y(), normal.Z());
      }

      const nbTriangles = int(triangulation.NbTriangles());
      for (let i = 1; i <= nbTriangles; i += 1) {
        const triangle = triangulation.Triangle(i);
        const n1 = int(triangle.Value(1)) - 1 + vertexOffset;
        const n2 = int(triangle.Value(2)) - 1 + vertexOffset;
        const n3 = int(triangle.Value(3)) - 1 + vertexOffset;
        if (isReversed) {
          indices.push(n1, n3, n2);
        } else {
          indices.push(n1, n2, n3);
        }
      }
      vertexOffset += nbNodes;
    }

    triHandle.delete();
    location.delete();
    explorer.Next();
  }
  explorer.delete();
  mesh.delete();

  return {
    bodyId,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}
