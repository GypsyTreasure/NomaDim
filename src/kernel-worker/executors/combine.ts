import type { TopoDS_Shape } from 'opencascade.js';
import type { CombineOp, CombineOperation } from '../../document';
import { trackShapeAllocation } from '../handleCounter';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Combine executor (F5): applies each tool body to the target with the op's
 * boolean, stores the result under the target's id, and removes the tools
 * from the map unless "Keep Tools". Original target/tool shapes stay owned by
 * their producing deltas (§9) — only intermediates created here are freed.
 */

function booleanShape(
  ctx: ExecCtx,
  operation: CombineOperation,
  a: TopoDS_Shape,
  b: TopoDS_Shape
): TopoDS_Shape {
  const { oc } = ctx;
  const progress = new oc.Message_ProgressRange_1();
  const maker =
    operation === 'Join'
      ? new oc.BRepAlgoAPI_Fuse_3(a, b, progress)
      : operation === 'Cut'
        ? new oc.BRepAlgoAPI_Cut_3(a, b, progress)
        : new oc.BRepAlgoAPI_Common_3(a, b, progress);
  const done = maker.IsDone();
  const result: TopoDS_Shape | null = done ? maker.Shape() : null;
  maker.delete();
  progress.delete();
  if (!result || result.IsNull()) {
    result?.delete();
    throw new KernelExecError('COMBINE_FAILED', `Combine ${operation} failed`);
  }
  return result;
}

export function executeCombine(ctx: ExecCtx, op: CombineOp): void {
  const { bodies } = ctx;
  const target = bodies.get(op.targetBodyId);
  if (!target)
    throw new KernelExecError('TARGET_MISSING', `Combine target ${op.targetBodyId} missing`);

  const toolShapes: TopoDS_Shape[] = [];
  for (const id of op.toolBodyIds) {
    const tool = bodies.get(id);
    if (!tool) throw new KernelExecError('TOOL_MISSING', `Combine tool ${id} missing`);
    toolShapes.push(tool);
  }

  let result = target;
  for (const tool of toolShapes) {
    const next = booleanShape(ctx, op.operation, result, tool);
    if (result !== target) result.delete(); // free the previous intermediate
    result = next;
  }

  trackShapeAllocation();
  bodies.set(op.targetBodyId, result);
  if (!op.keepTools) {
    for (const id of op.toolBodyIds) bodies.delete(id);
  }
}
