import type { TopoDS_Shape } from 'opencascade.js';
import type { BodyId } from '../../core';
import type { BooleanOperation } from '../../document';
import { trackShapeAllocation } from '../handleCounter';
import { healInvalidSolid } from '../healShape';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Shared tail of Extrude/Revolve (and later Combine): applies the tool
 * shape to the map per the op's boolean operation. The tool shape is
 * CONSUMED (deleted here unless it becomes the new body); the produced
 * shape is tracked — the delta cache owns it from now on.
 */
export function applyBooleanResult(
  ctx: ExecCtx,
  operation: BooleanOperation,
  bodyId: BodyId,
  targetBodyIds: readonly BodyId[],
  tool: TopoDS_Shape
): void {
  const { oc, bodies } = ctx;

  if (operation === 'NewBody') {
    // Heal an invalid face so the body still meshes/exports (no see-through
    // hole), matching the Fillet/Chamfer/Combine path (ADR-0057).
    const healed = healInvalidSolid(oc, tool);
    trackShapeAllocation();
    bodies.set(bodyId, healed);
    return;
  }

  if (targetBodyIds.length === 0) {
    tool.delete();
    throw new KernelExecError('TARGET_MISSING', 'Target body is not available');
  }

  // Apply the tool to EACH target in place (#3): Cut trims each, Intersect
  // clips each, Join fuses the tool into each. The tool shape is reused across
  // targets (the boolean makers read it, never mutate it) and freed once at the
  // end. Each previous target shape stays alive — owned by the delta of the op
  // that produced it (replay-from-k); the delta cache disposes it later.
  for (const targetBodyId of targetBodyIds) {
    const target = bodies.get(targetBodyId);
    if (!target) {
      tool.delete();
      throw new KernelExecError('TARGET_MISSING', 'Target body is not available');
    }
    const progress = new oc.Message_ProgressRange_1();
    const maker =
      operation === 'Join'
        ? new oc.BRepAlgoAPI_Fuse_3(target, tool, progress)
        : operation === 'Cut'
          ? new oc.BRepAlgoAPI_Cut_3(target, tool, progress)
          : new oc.BRepAlgoAPI_Common_3(target, tool, progress);
    const done = maker.IsDone();
    const result = done ? maker.Shape() : null;
    maker.delete();
    progress.delete();
    if (!result || result.IsNull()) {
      result?.delete();
      tool.delete();
      throw new KernelExecError(
        'BOOLEAN_FAILED',
        `The ${operation} operation failed — the bodies may not overlap.`
      );
    }
    const healed = healInvalidSolid(oc, result);
    trackShapeAllocation();
    bodies.set(targetBodyId, healed);
  }
  tool.delete();
}
