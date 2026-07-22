import type { ChamferOp } from '../../document';
import { resolveEdges } from '../edgeFingerprint';
import { trackShapeAllocation } from '../handleCounter';
import { healInvalidSolid } from '../healShape';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Chamfer executor (F4): equal-distance bevel of resolved edges. Mirrors the
 * fillet executor — resolve fingerprints, apply, replace the body; an
 * unresolvable fingerprint surfaces as the op's error state (§4).
 */
export function executeChamfer(ctx: ExecCtx, op: ChamferOp): void {
  const { oc, bodies } = ctx;
  const shape = bodies.get(op.bodyId);
  if (!shape) throw new KernelExecError('TARGET_MISSING', `Chamfer target ${op.bodyId} missing`);
  if (op.edges.length === 0) {
    throw new KernelExecError('CHAMFER_FAILED', `Chamfer ${op.id} has no edges`);
  }

  const edges = resolveEdges(oc, shape, op.edges);
  try {
    const maker = new oc.BRepFilletAPI_MakeChamfer(shape);
    for (const edge of edges) maker.Add_2(op.distanceMm, edge);
    const progress = new oc.Message_ProgressRange_1();
    maker.Build(progress);
    const done = maker.IsDone();
    const result = done ? maker.Shape() : null;
    maker.delete();
    progress.delete();
    if (!result || result.IsNull()) {
      result?.delete();
      throw new KernelExecError(
        'CHAMFER_FAILED',
        `Chamfer ${op.id} failed — the distance may be too large for one of the selected edges`
      );
    }
    // Heal an invalid face so it still meshes/exports (no see-through hole).
    const healed = healInvalidSolid(oc, result);
    trackShapeAllocation();
    bodies.set(op.bodyId, healed);
  } finally {
    for (const edge of edges) edge.delete();
  }
}
