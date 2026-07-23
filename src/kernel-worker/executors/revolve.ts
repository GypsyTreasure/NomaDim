import type { BRepAlgoAPI_Fuse, TopoDS_Shape, gp_Ax1 } from 'opencascade.js';
import { DEG_TO_RAD } from '../../core';
import type { RevolveOp } from '../../document';
import type { PlanProfile, WorldAxis } from '../../kernel/protocol';
import { buildProfileFace } from '../profileFace';
import { applyBooleanResult } from './booleanApply';
import { applyThinWall } from './hollow';
import { revolShell, storeSurfaceBody } from './surface';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Revolve executor (F3): profiles revolve about a same-sketch line (shipped
 * pre-resolved as a world-space axis in the plan, like profiles per R7) or
 * an origin axis. Angle sign selects the revolve sense via axis flip.
 */

function makeAxis(ctx: ExecCtx, axis: WorldAxis, flip: boolean): gp_Ax1 {
  const s = flip ? -1 : 1;
  const p = new ctx.oc.gp_Pnt_3(axis.origin[0], axis.origin[1], axis.origin[2]);
  const d = new ctx.oc.gp_Dir_4(
    axis.direction[0] * s,
    axis.direction[1] * s,
    axis.direction[2] * s
  );
  const ax1 = new ctx.oc.gp_Ax1_2(p, d);
  p.delete();
  d.delete();
  return ax1;
}

function revolveProfile(
  ctx: ExecCtx,
  profile: PlanProfile,
  axis: WorldAxis,
  angleDeg: number
): TopoDS_Shape {
  const face = buildProfileFace(ctx.oc, profile);
  const ax1 = makeAxis(ctx, axis, angleDeg < 0);
  const angleRad = Math.min(Math.abs(angleDeg), 360) * DEG_TO_RAD;
  const fullTurn = Math.abs(angleRad - 2 * Math.PI) < 1e-12;

  const maker = fullTurn
    ? new ctx.oc.BRepPrimAPI_MakeRevol_2(face, ax1, false)
    : new ctx.oc.BRepPrimAPI_MakeRevol_1(face, ax1, angleRad, false);
  const done = maker.IsDone();
  const solid = done ? maker.Shape() : null;
  maker.delete();
  ax1.delete();
  face.delete();
  if (!solid || solid.IsNull()) {
    solid?.delete();
    throw new KernelExecError('REVOLVE_FAILED', `Profile ${profile.id}: revolve failed`);
  }
  return solid;
}

export function executeRevolve(ctx: ExecCtx, op: RevolveOp, axis: WorldAxis | undefined): void {
  if (!axis) {
    throw new KernelExecError('AXIS_MISSING', 'Revolve axis could not be resolved');
  }

  // Surface (zero-thickness) revolve (ADR-0072): revolve the profile wires into
  // an open shell of revolution instead of a solid; always a new body.
  if (op.asSurface) {
    const ax1 = makeAxis(ctx, axis, op.angleDeg < 0);
    const angleRad = Math.min(Math.abs(op.angleDeg), 360) * DEG_TO_RAD;
    const fullTurn = Math.abs(angleRad - 2 * Math.PI) < 1e-12;
    try {
      storeSurfaceBody(ctx, op.bodyId, op.profileIds, (profile) =>
        revolShell(ctx.oc, profile, ax1, angleRad, fullTurn)
      );
    } finally {
      ax1.delete();
    }
    return;
  }

  let tool: TopoDS_Shape | null = null;
  for (const profileId of op.profileIds) {
    const profile = ctx.profiles.get(profileId);
    if (!profile) {
      tool?.delete();
      throw new KernelExecError(
        'PROFILE_NOT_FOUND',
        `Profile ${profileId} no longer exists in the sketch`
      );
    }
    const solid = revolveProfile(ctx, profile, axis, op.angleDeg);
    if (!tool) {
      tool = solid;
    } else {
      const progress = new ctx.oc.Message_ProgressRange_1();
      const fuse: BRepAlgoAPI_Fuse = new ctx.oc.BRepAlgoAPI_Fuse_3(tool, solid, progress);
      const fused: TopoDS_Shape | null = fuse.IsDone() ? fuse.Shape() : null;
      fuse.delete();
      progress.delete();
      tool.delete();
      solid.delete();
      if (!fused || fused.IsNull()) {
        fused?.delete();
        throw new KernelExecError('REVOLVE_FAILED', 'Fusing revolved profiles failed');
      }
      tool = fused;
    }
  }
  if (!tool) {
    throw new KernelExecError('NO_PROFILES', 'Revolve selects no profiles');
  }
  tool = applyThinWall(ctx.oc, tool, op.wallThicknessMm);
  applyBooleanResult(ctx, op.operation, op.bodyId, op.targetBodyId, tool);
}
