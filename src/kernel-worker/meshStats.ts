import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import type { MeshQuality } from '../kernel/protocol';
import { triangulationOf } from './tessellate';
import { enumArg, int } from './occtCompat';

/**
 * Export mesh statistics for one shape (F6 STL dialog): triangle count at the
 * chosen deflection + a WATERTIGHT flag. Watertight is computed from the mesh
 * itself — every triangle edge shared by exactly two triangles — which is the
 * correct printability signal and, unlike `BRepCheck_Analyzer`, does NOT
 * false-alarm on a body healed (ADR-0057) into a clean mesh that still fails
 * strict B-rep validity. Ephemeral OCCT temporaries are deleted within this
 * synchronous pass (not part of the R8 live-handle count).
 */

const MESH_QUANT = 1e4; // 0.1 µm grid for welding shared triangle vertices

export interface ShapeMeshStat {
  readonly triangleCount: number;
  readonly watertight: boolean;
}

export function shapeMeshStat(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  quality: MeshQuality
): ShapeMeshStat {
  const angularRad = (quality.angularDeflectionDeg * Math.PI) / 180;
  const q = (v: number): number => Math.round(v * MESH_QUANT);
  new oc.BRepMesh_IncrementalMesh_2(shape, quality.linearDeflectionMm, false, angularRad, false);

  let triangleCount = 0;
  const edgeUse = new Map<string, number>();
  const bumpEdge = (a: string, b: string): void => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
  };

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
      const tri = triHandle.get();
      const transform = location.Transformation();
      const nbNodes = int(tri.NbNodes());
      const keys: string[] = [];
      for (let i = 1; i <= nbNodes; i += 1) {
        const p = tri.Node(i).Transformed(transform);
        keys[i] = `${String(q(p.X()))},${String(q(p.Y()))},${String(q(p.Z()))}`;
      }
      const nbTri = int(tri.NbTriangles());
      triangleCount += nbTri;
      for (let i = 1; i <= nbTri; i += 1) {
        const t = tri.Triangle(i);
        const a = keys[int(t.Value(1))] ?? '';
        const b = keys[int(t.Value(2))] ?? '';
        const c = keys[int(t.Value(3))] ?? '';
        bumpEdge(a, b);
        bumpEdge(b, c);
        bumpEdge(c, a);
      }
    }
    triHandle.delete();
    location.delete();
    explorer.Next();
  }
  explorer.delete();

  let watertight = edgeUse.size > 0;
  for (const count of edgeUse.values()) {
    if (count !== 2) {
      watertight = false;
      break;
    }
  }
  return { triangleCount, watertight };
}
