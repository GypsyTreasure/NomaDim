import type { OpenCascadeInstance, TopoDS_Shape, gp_Ax1 } from 'opencascade.js';
import type { BodyId, ProfileId } from '../../core';
import type { PlanProfile } from '../../kernel/protocol';
import { trackShapeAllocation } from '../handleCounter';
import { buildProfileWireCompound, planeNormal } from '../profileFace';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Surface (zero-thickness) bodies (ADR-0072): sweeping a profile's WIRES —
 * rather than its face — yields an open shell instead of a solid, matching
 * Fusion's "as Surface". Always a new body (a surface can't take a boolean).
 * Shared by the Extrude and Revolve executors.
 */

/** Prism the profile wires into a zero-thickness shell. Returns an UNTRACKED
 * shape (the caller stores it) or throws. `shift` offsets the profile along the
 * plane normal first (symmetric/two-sides), then it sweeps `length`. */
export function prismShell(
  oc: OpenCascadeInstance,
  profile: PlanProfile,
  shift: number,
  length: number
): TopoDS_Shape {
  const n = planeNormal(profile.plane);
  let wires = buildProfileWireCompound(oc, profile);
  if (shift !== 0) {
    const trsf = new oc.gp_Trsf_1();
    const vec = new oc.gp_Vec_4(n[0] * shift, n[1] * shift, n[2] * shift);
    trsf.SetTranslation_1(vec);
    const transform = new oc.BRepBuilderAPI_Transform_2(wires, trsf, true);
    const moved = transform.Shape();
    transform.delete();
    vec.delete();
    trsf.delete();
    wires.delete();
    wires = moved;
  }
  const vec = new oc.gp_Vec_4(n[0] * length, n[1] * length, n[2] * length);
  const maker = new oc.BRepPrimAPI_MakePrism_1(wires, vec, false, true);
  const shell = maker.IsDone() ? maker.Shape() : null;
  maker.delete();
  vec.delete();
  wires.delete();
  if (!shell || shell.IsNull()) {
    shell?.delete();
    throw new KernelExecError('EXTRUDE_FAILED', `Profile ${profile.id}: surface prism failed`);
  }
  return shell;
}

/** Revolve the profile wires into a surface-of-revolution shell (UNTRACKED). */
export function revolShell(
  oc: OpenCascadeInstance,
  profile: PlanProfile,
  axis: gp_Ax1,
  angleRad: number,
  fullTurn: boolean
): TopoDS_Shape {
  const wires = buildProfileWireCompound(oc, profile);
  const maker = fullTurn
    ? new oc.BRepPrimAPI_MakeRevol_2(wires, axis, false)
    : new oc.BRepPrimAPI_MakeRevol_1(wires, axis, angleRad, false);
  const shell = maker.IsDone() ? maker.Shape() : null;
  maker.delete();
  wires.delete();
  if (!shell || shell.IsNull()) {
    shell?.delete();
    throw new KernelExecError('REVOLVE_FAILED', `Profile ${profile.id}: surface revolve failed`);
  }
  return shell;
}

/**
 * Sweep every selected profile into a shell and store the compound as a new
 * surface body (`bodyId`). The per-shell `sweep` throws on failure; on any
 * failure the compound is freed and the error re-thrown.
 */
export function storeSurfaceBody(
  ctx: ExecCtx,
  bodyId: BodyId,
  profileIds: readonly ProfileId[],
  sweep: (profile: PlanProfile) => TopoDS_Shape
): void {
  const { oc, bodies } = ctx;
  const compound = new oc.TopoDS_Compound();
  const builder = new oc.BRep_Builder();
  builder.MakeCompound(compound);
  try {
    let any = false;
    for (const profileId of profileIds) {
      const profile = ctx.profiles.get(profileId);
      if (!profile) {
        throw new KernelExecError(
          'PROFILE_NOT_FOUND',
          `Profile ${profileId} no longer exists in the sketch`
        );
      }
      const shell = sweep(profile);
      builder.Add(compound, shell);
      shell.delete(); // the compound retains the underlying shape
      any = true;
    }
    if (!any) throw new KernelExecError('NO_PROFILES', 'Surface selects no profiles');
  } catch (error) {
    compound.delete();
    builder.delete();
    throw error;
  }
  builder.delete();
  trackShapeAllocation();
  bodies.set(bodyId, compound);
}
