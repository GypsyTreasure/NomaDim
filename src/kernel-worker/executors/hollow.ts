import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import { enumArg } from '../occtCompat';
import { KernelExecError } from './types';

/**
 * Shared hollowing helper (ADR-0064/#7). A fully-enclosed hollow can't be made
 * with `BRepOffsetAPI_MakeThickSolid` (it needs a face to remove), so we offset
 * the solid inward with `BRepOffsetAPI_MakeOffsetShape` and cut that inner solid
 * out of the original — an internal void, walls of `thicknessMm`. Used by Shell
 * (closed hollow) and by the thin-wall option on Extrude/Revolve (#7).
 */

/** Enum members not on the generated instance type (ADR-0011 gap). */
export interface HollowEnums {
  readonly BRepOffset_Mode: { readonly BRepOffset_Skin: unknown };
  readonly GeomAbs_JoinType: { readonly GeomAbs_Arc: unknown };
}

const TOO_THICK = 'The wall thickness may be too large for this body.';

/**
 * Closed hollow of `shape` at wall thickness `thicknessMm`. Returns an UNTRACKED
 * result shape (the caller heals + tracks it); does NOT delete `shape`. Throws
 * `HOLLOW_FAILED` if the inward offset collapses (walls too thick).
 */
export function closedHollow(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  thicknessMm: number
): TopoDS_Shape {
  const en = oc as unknown as HollowEnums;
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
      throw new KernelExecError('HOLLOW_FAILED', TOO_THICK);
    }
    const cut = new oc.BRepAlgoAPI_Cut_3(shape, inner, progress);
    const result = cut.IsDone() ? cut.Shape() : null;
    cut.delete();
    if (!result || result.IsNull()) {
      result?.delete();
      throw new KernelExecError('HOLLOW_FAILED', TOO_THICK);
    }
    return result;
  } finally {
    offset.delete();
    progress.delete();
    inner?.delete();
  }
}

/**
 * Thin-wall a freshly-built (untracked, caller-owned) tool solid to `wallMm`
 * before the boolean tail (#7). Returns the input unchanged when `wallMm` is 0
 * (solid, the default); otherwise CONSUMES the input solid and returns the
 * hollowed one. On failure the input is freed and the error re-thrown.
 */
export function applyThinWall(
  oc: OpenCascadeInstance,
  tool: TopoDS_Shape,
  wallMm: number
): TopoDS_Shape {
  if (!(wallMm > 0)) return tool;
  let thin: TopoDS_Shape;
  try {
    thin = closedHollow(oc, tool, wallMm);
  } catch (error) {
    tool.delete();
    throw error;
  }
  tool.delete();
  return thin;
}
