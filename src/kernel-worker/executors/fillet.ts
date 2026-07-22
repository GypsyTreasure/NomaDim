import type { FilletOp } from '../../document';
import { resolveEdges } from '../edgeFingerprint';
import { trackShapeAllocation } from '../handleCounter';
import { healInvalidSolid } from '../healShape';
import { enumArg } from '../occtCompat';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Fillet executor (F4): resolves the op's edge fingerprints against the live
 * target body, rounds them by a single radius, and replaces the body in the
 * map. An unresolvable fingerprint throws → the regen loop marks the op
 * `error` and renders the last good state (graceful, MASTER_DOCUMENT §4). The
 * prior body shape stays owned by its producing delta (§9).
 */
export function executeFillet(ctx: ExecCtx, op: FilletOp): void {
  const { oc, bodies } = ctx;
  const shape = bodies.get(op.bodyId);
  if (!shape) throw new KernelExecError('TARGET_MISSING', `Fillet target ${op.bodyId} missing`);
  if (op.edges.length === 0) {
    throw new KernelExecError('FILLET_FAILED', `Fillet ${op.id} has no edges`);
  }

  const edges = resolveEdges(oc, shape, op.edges);
  try {
    const maker = new oc.BRepFilletAPI_MakeFillet(
      shape,
      enumArg(oc.ChFi3d_FilletShape.ChFi3d_Rational)
    );
    for (const edge of edges) maker.Add_2(op.radiusMm, edge);
    const progress = new oc.Message_ProgressRange_1();
    maker.Build(progress);
    const done = maker.IsDone();
    const result = done ? maker.Shape() : null;
    maker.delete();
    progress.delete();
    if (!result || result.IsNull()) {
      result?.delete();
      throw new KernelExecError(
        'FILLET_FAILED',
        `Fillet ${op.id} failed — the radius may be too large for one of the selected edges`
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
