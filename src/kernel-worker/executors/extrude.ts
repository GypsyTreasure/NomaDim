import type { BRepAlgoAPI_Fuse, TopoDS_Shape } from 'opencascade.js';
import type { ExtrudeOp } from '../../document';
import type { PlanProfile } from '../../kernel/protocol';
import { buildProfileFace, planeNormal } from '../profileFace';
import { applyBooleanResult } from './booleanApply';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Extrude executor (F3): each selected profile becomes a prism along the
 * sketch-plane normal; multiple prisms fuse into one tool shape, then the
 * boolean operation applies it to the map. Directions:
 *   one-side:  face → +n·d           (negative d flips)
 *   symmetric: face shifted −n·d/2, prism n·d
 *   two-sides: face shifted −n·d2, prism n·(d+d2)
 */

function prismForProfile(ctx: ExecCtx, op: ExtrudeOp, profile: PlanProfile): TopoDS_Shape {
  const { oc } = ctx;
  const n = planeNormal(profile.plane);

  const [shift, length] =
    op.direction === 'one-side'
      ? [0, op.distanceMm]
      : op.direction === 'symmetric'
        ? [-op.distanceMm / 2, op.distanceMm]
        : [-op.distance2Mm, op.distanceMm + op.distance2Mm];

  let face: TopoDS_Shape = buildProfileFace(ctx.oc, profile);
  if (shift !== 0) {
    const trsf = new oc.gp_Trsf_1();
    const vec = new oc.gp_Vec_4(n[0] * shift, n[1] * shift, n[2] * shift);
    trsf.SetTranslation_1(vec);
    const transform = new oc.BRepBuilderAPI_Transform_2(face, trsf, true);
    const moved = transform.Shape();
    transform.delete();
    vec.delete();
    trsf.delete();
    face.delete();
    face = moved;
  }

  const vec = new oc.gp_Vec_4(n[0] * length, n[1] * length, n[2] * length);
  const maker = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true);
  const done = maker.IsDone();
  const prism = done ? maker.Shape() : null;
  maker.delete();
  vec.delete();
  face.delete();
  if (!prism || prism.IsNull()) {
    prism?.delete();
    throw new KernelExecError('EXTRUDE_FAILED', `Profile ${profile.id}: prism failed`);
  }
  return prism;
}

export function executeExtrude(ctx: ExecCtx, op: ExtrudeOp): void {
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
    const prism = prismForProfile(ctx, op, profile);
    if (!tool) {
      tool = prism;
    } else {
      const progress = new ctx.oc.Message_ProgressRange_1();
      const fuse: BRepAlgoAPI_Fuse = new ctx.oc.BRepAlgoAPI_Fuse_3(tool, prism, progress);
      const fused: TopoDS_Shape | null = fuse.IsDone() ? fuse.Shape() : null;
      fuse.delete();
      progress.delete();
      tool.delete();
      prism.delete();
      if (!fused || fused.IsNull()) {
        fused?.delete();
        throw new KernelExecError('EXTRUDE_FAILED', 'Fusing profile prisms failed');
      }
      tool = fused;
    }
  }
  if (!tool) {
    throw new KernelExecError('NO_PROFILES', 'Extrude selects no profiles');
  }
  applyBooleanResult(ctx, op.operation, op.bodyId, op.targetBodyId, tool);
}
