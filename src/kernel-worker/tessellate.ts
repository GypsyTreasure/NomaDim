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
 * TopLoc_Location transform to nodes/normals and, for a REVERSED face, both
 * flips triangle winding AND negates the normal so it points outward.
 *
 * `Poly_Triangulation::ComputeNormals` returns normals following the
 * underlying surface's natural (FORWARD) orientation — it does not account for
 * the face's orientation within the shell. A REVERSED face therefore has its
 * material on the opposite side, so its outward normal is the negation of the
 * stored one. Booleans, fillets and chamfers routinely emit REVERSED faces
 * (empirically 3 of 7 on a single-edge filleted box); without the negation
 * those faces are lit from the inside (dark / see-through — "fake walls") and,
 * in the double-sided Intersect view, the interior shades as a solid wall.
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

  // A body with no enclosed TopoDS_Solid is a zero-thickness surface (ADR-0072)
  // — flag it so the viewport renders it double-sided (never culled edge-on).
  const solidExp = new oc.TopExp_Explorer_2(
    shape,
    enumArg(oc.TopAbs_ShapeEnum.TopAbs_SOLID),
    enumArg(oc.TopAbs_ShapeEnum.TopAbs_SHAPE)
  );
  const open = !solidExp.More();
  solidExp.delete();

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

      const normalSign = isReversed ? -1 : 1;
      const nbNodes = int(triangulation.NbNodes());
      for (let i = 1; i <= nbNodes; i += 1) {
        const point = triangulation.Node(i).Transformed(transform);
        positions.push(point.X(), point.Y(), point.Z());
        const normal = triangulation.Normal_1(i).Transformed(transform);
        // Reversed face → its outward normal is the negation of the stored
        // (surface-natural) one; keep it consistent with the flipped winding.
        normals.push(normalSign * normal.X(), normalSign * normal.Y(), normalSign * normal.Z());
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
    open,
  };
}
