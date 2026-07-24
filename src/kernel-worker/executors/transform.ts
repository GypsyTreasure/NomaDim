import type { OpenCascadeInstance, TopoDS_Shape, gp_Trsf } from 'opencascade.js';

/**
 * Shared rigid-transform helpers for the transform ops (Mirror, Pattern,
 * CopyBody). Each builds a `gp_Trsf` (the caller `.delete()`s it) with all
 * intermediate gp temporaries freed inside. `applyTrsf` produces an independent
 * copy of a shape (BRepBuilderAPI_Transform, copy = true), matching CopyBody's
 * source-preserving semantics (§9).
 */

const DEG = Math.PI / 180;

export type WorldAxisName = 'X' | 'Y' | 'Z';
export type PlaneName = 'XY' | 'XZ' | 'YZ';

function dir(
  oc: OpenCascadeInstance,
  axis: WorldAxisName
): InstanceType<OpenCascadeInstance['gp_Dir_4']> {
  const [x, y, z] = axis === 'X' ? [1, 0, 0] : axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
  return new oc.gp_Dir_4(x, y, z);
}

/** Mirror about a world origin plane (the plane whose normal is the odd axis). */
export function mirrorTrsf(oc: OpenCascadeInstance, plane: PlaneName): gp_Trsf {
  const normal: WorldAxisName = plane === 'XY' ? 'Z' : plane === 'XZ' ? 'Y' : 'X';
  return mirrorPlaneTrsf(oc, [0, 0, 0], axisUnit(normal));
}

/** Mirror about an arbitrary world plane (point + normal) — construction planes. */
export function mirrorPlaneTrsf(
  oc: OpenCascadeInstance,
  origin: readonly [number, number, number],
  normal: readonly [number, number, number]
): gp_Trsf {
  const o = new oc.gp_Pnt_3(origin[0], origin[1], origin[2]);
  const n = new oc.gp_Dir_4(normal[0], normal[1], normal[2]);
  const ax2 = new oc.gp_Ax2_3(o, n); // its plane (⊥ main dir) is the mirror plane
  const trsf = new oc.gp_Trsf_1();
  trsf.SetMirror_3(ax2);
  ax2.delete();
  n.delete();
  o.delete();
  return trsf;
}

/** Rotation (Euler XYZ degrees, about the world origin) then translation. */
export function rigidTrsf(
  oc: OpenCascadeInstance,
  translate: readonly [number, number, number],
  rotateDeg: readonly [number, number, number]
): gp_Trsf {
  const origin = new oc.gp_Pnt_3(0, 0, 0);
  const trsf = new oc.gp_Trsf_1(); // identity → becomes Rz·Ry·Rx (Rx applied first)
  const axes: WorldAxisName[] = ['Z', 'Y', 'X'];
  const angles = [rotateDeg[2], rotateDeg[1], rotateDeg[0]];
  axes.forEach((axis, i) => {
    const ang = angles[i] ?? 0;
    if (ang === 0) return;
    const d = dir(oc, axis);
    const ax1 = new oc.gp_Ax1_2(origin, d);
    const r = new oc.gp_Trsf_1();
    r.SetRotation_1(ax1, ang * DEG);
    trsf.Multiply(r); // trsf = trsf · r
    r.delete();
    ax1.delete();
    d.delete();
  });
  if (translate[0] !== 0 || translate[1] !== 0 || translate[2] !== 0) {
    const vec = new oc.gp_Vec_4(translate[0], translate[1], translate[2]);
    const tt = new oc.gp_Trsf_1();
    tt.SetTranslation_1(vec);
    trsf.PreMultiply(tt); // trsf = Translate · Rotate (rotate first, then translate)
    tt.delete();
    vec.delete();
  }
  origin.delete();
  return trsf;
}

/** Rotation about a world axis through the origin (for circular patterns). */
export function axisRotationTrsf(
  oc: OpenCascadeInstance,
  axis: WorldAxisName,
  angleDeg: number
): gp_Trsf {
  const origin = new oc.gp_Pnt_3(0, 0, 0);
  const d = dir(oc, axis);
  const ax1 = new oc.gp_Ax1_2(origin, d);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetRotation_1(ax1, angleDeg * DEG);
  ax1.delete();
  d.delete();
  origin.delete();
  return trsf;
}

/** Translation by an arbitrary world vector (mm). */
export function vectorTranslationTrsf(
  oc: OpenCascadeInstance,
  dx: number,
  dy: number,
  dz: number
): gp_Trsf {
  const vec = new oc.gp_Vec_4(dx, dy, dz);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetTranslation_1(vec);
  vec.delete();
  return trsf;
}

/** Translation along a world axis (for linear patterns). */
export function axisTranslationTrsf(
  oc: OpenCascadeInstance,
  axis: WorldAxisName,
  distanceMm: number
): gp_Trsf {
  const [x, y, z] =
    axis === 'X' ? [distanceMm, 0, 0] : axis === 'Y' ? [0, distanceMm, 0] : [0, 0, distanceMm];
  return vectorTranslationTrsf(oc, x, y, z);
}

/** World unit vector for an axis name. */
export function axisUnit(axis: WorldAxisName): readonly [number, number, number] {
  return axis === 'X' ? [1, 0, 0] : axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
}

/** Independent transformed copy of `shape` (source preserved). Caller owns it. */
export function applyTrsf(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  trsf: gp_Trsf
): TopoDS_Shape {
  const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  const result = transform.Shape();
  transform.delete();
  return result;
}

/**
 * Fuses a list of transient instance shapes into one, CONSUMING every input
 * (they are throwaway copies made for this fuse — never a stored body). Returns
 * a fresh unowned shape, or null if a fuse degenerates (freeing everything).
 * The returned shape is not handle-tracked — the caller tracks it when stored.
 */
export function fuseAll(
  oc: OpenCascadeInstance,
  shapes: readonly TopoDS_Shape[]
): TopoDS_Shape | null {
  const first = shapes[0];
  if (!first) return null;
  let acc: TopoDS_Shape = first;
  for (let i = 1; i < shapes.length; i += 1) {
    const shape = shapes[i];
    if (!shape) continue;
    const progress = new oc.Message_ProgressRange_1();
    const maker = new oc.BRepAlgoAPI_Fuse_3(acc, shape, progress);
    const next = maker.IsDone() ? maker.Shape() : null;
    maker.delete();
    progress.delete();
    acc.delete(); // consume both operands
    shape.delete();
    if (!next || next.IsNull()) {
      next?.delete();
      for (let j = i + 1; j < shapes.length; j += 1) shapes[j]?.delete(); // free the rest
      return null;
    }
    acc = next;
  }
  return acc;
}
