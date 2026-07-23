import type { OpenCascadeInstance, TopoDS_Face, TopoDS_Shape } from 'opencascade.js';
import type { ShellFace, ShellOp } from '../../document';
import { VIEWPORT_ANGULAR_DEFLECTION_DEG, VIEWPORT_LINEAR_DEFLECTION_MM } from '../../core';
import { trackShapeAllocation } from '../handleCounter';
import { healInvalidSolid } from '../healShape';
import { triangulationOf } from '../tessellate';
import { enumArg, enumMember, int } from '../occtCompat';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Shell executor (P2, ADR-0064): hollows the target body to a wall thickness
 * with `BRepOffsetAPI_MakeThickSolid` (negative offset = inward), optionally
 * removing one face so the hollow is open. The open face is chosen by outward
 * world direction (Top/Bottom/…) — no viewport face-pick UI in v1. Modifies the
 * body in place (like Fillet); the prior shape stays owned by its delta (§9).
 */

type Vec3 = readonly [number, number, number];

const OPEN_DIR: Record<Exclude<ShellFace, 'none'>, Vec3> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

/** Enum members not on the generated instance type (ADR-0011 gap). */
interface ShellEnums {
  readonly BRepOffset_Mode: { readonly BRepOffset_Skin: unknown };
  readonly GeomAbs_JoinType: { readonly GeomAbs_Arc: unknown };
}

/** The planar face whose OUTWARD normal is most aligned with `dir` (caller
 * deletes it). Null if nothing faces that way. */
function faceFacing(oc: OpenCascadeInstance, shape: TopoDS_Shape, dir: Vec3): TopoDS_Face | null {
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
  let best: TopoDS_Face | null = null;
  let bestScore = 0.5; // require a clear alignment
  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triHandle = triangulationOf(oc, face, location);
    let score = -1;
    if (!triHandle.IsNull()) {
      const tri = triHandle.get();
      tri.ComputeNormals();
      const transform = location.Transformation();
      const reversed =
        enumMember(face.Orientation_1()).value ===
        enumMember(oc.TopAbs_Orientation.TopAbs_REVERSED).value;
      const sign = reversed ? -1 : 1;
      const nb = int(tri.NbNodes());
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 1; i <= nb; i += 1) {
        const n = tri.Normal_1(i).Transformed(transform);
        nx += sign * n.X();
        ny += sign * n.Y();
        nz += sign * n.Z();
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      score = (nx / len) * dir[0] + (ny / len) * dir[1] + (nz / len) * dir[2];
    }
    triHandle.delete();
    location.delete();
    if (score > bestScore) {
      bestScore = score;
      best?.delete();
      best = face;
    } else {
      face.delete();
    }
    explorer.Next();
  }
  explorer.delete();
  mesh.delete();
  return best;
}

const THICK_FAILED = 'The wall thickness may be too large for this body.';

/**
 * Open shell: `MakeThickSolidByJoin` removes the chosen face and offsets the
 * rest inward, leaving an open cavity. Returns an UNTRACKED result shape (the
 * caller heals + tracks it) or throws SHELL_FAILED.
 */
function openShell(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  thicknessMm: number,
  openFace: TopoDS_Face
): TopoDS_Shape {
  const en = oc as unknown as ShellEnums;
  const closingFaces = new oc.TopTools_ListOfShape_1();
  closingFaces.Append_1(openFace);
  const maker = new oc.BRepOffsetAPI_MakeThickSolid();
  const progress = new oc.Message_ProgressRange_1();
  try {
    maker.MakeThickSolidByJoin(
      shape,
      closingFaces,
      -thicknessMm,
      1e-3,
      enumArg(en.BRepOffset_Mode.BRepOffset_Skin),
      false,
      false,
      enumArg(en.GeomAbs_JoinType.GeomAbs_Arc),
      false,
      progress
    );
    const result = maker.IsDone() ? maker.Shape() : null;
    if (!result || result.IsNull()) {
      result?.delete();
      throw new KernelExecError('SHELL_FAILED', THICK_FAILED);
    }
    return result;
  } finally {
    maker.delete();
    progress.delete();
    closingFaces.delete();
  }
}

/**
 * Closed hollow: `MakeThickSolidByJoin` needs a face to remove, so a fully
 * enclosed hollow is built instead by offsetting the solid inward
 * (`MakeOffsetShape`) and cutting that inner solid out of the original — an
 * internal void with no opening. Returns an UNTRACKED result (caller heals +
 * tracks) or throws SHELL_FAILED.
 */
function closedHollow(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  thicknessMm: number
): TopoDS_Shape {
  const en = oc as unknown as ShellEnums;
  const offset = new oc.BRepOffsetAPI_MakeOffsetShape();
  const progress = new oc.Message_ProgressRange_1();
  let inner: TopoDS_Shape | null = null;
  try {
    offset.PerformByJoin(
      shape,
      -thicknessMm,
      1e-3,
      enumArg(en.BRepOffset_Mode.BRepOffset_Skin),
      false,
      false,
      enumArg(en.GeomAbs_JoinType.GeomAbs_Arc),
      false,
      progress
    );
    inner = offset.IsDone() ? offset.Shape() : null;
    if (!inner || inner.IsNull()) {
      inner?.delete();
      throw new KernelExecError('SHELL_FAILED', THICK_FAILED);
    }
    const cut = new oc.BRepAlgoAPI_Cut_3(shape, inner, progress);
    const result = cut.IsDone() ? cut.Shape() : null;
    cut.delete();
    if (!result || result.IsNull()) {
      result?.delete();
      throw new KernelExecError('SHELL_FAILED', THICK_FAILED);
    }
    return result;
  } finally {
    offset.delete();
    progress.delete();
    inner?.delete();
  }
}

export function executeShell(ctx: ExecCtx, op: ShellOp): void {
  const { oc, bodies } = ctx;
  const shape = bodies.get(op.bodyId);
  if (!shape) throw new KernelExecError('TARGET_MISSING', `Shell target ${op.bodyId} missing`);
  if (!(op.thicknessMm > 0)) {
    throw new KernelExecError('SHELL_FAILED', 'Shell needs a positive wall thickness.');
  }

  let openFace: TopoDS_Face | null = null;
  if (op.openFace !== 'none') {
    openFace = faceFacing(oc, shape, OPEN_DIR[op.openFace]);
    if (!openFace) {
      throw new KernelExecError('SHELL_FAILED', `No ${op.openFace} face to open.`);
    }
  }

  try {
    const result = openFace
      ? openShell(oc, shape, op.thicknessMm, openFace)
      : closedHollow(oc, shape, op.thicknessMm);
    // The previous shape stays owned by its delta (§9); only the map ref moves.
    const healed = healInvalidSolid(oc, result);
    trackShapeAllocation();
    bodies.set(op.bodyId, healed);
  } finally {
    openFace?.delete();
  }
}
