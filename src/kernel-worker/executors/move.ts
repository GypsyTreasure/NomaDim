import type { MoveOp } from '../../document';
import { trackShapeAllocation } from '../handleCounter';
import { applyTrsf, rigidTrsf } from './transform';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Move executor (#3): applies a rigid transform (Euler XYZ rotation about the
 * world origin, then translation) to the body IN PLACE — same body id, no
 * copy (contrast CopyBody). `BRepBuilderAPI_Transform` with copy=true builds an
 * independent moved shape; the prior shape stays owned by its producing delta
 * (§9), so only the map reference is replaced here.
 */
export function executeMove(ctx: ExecCtx, op: MoveOp): void {
  const { oc, bodies } = ctx;
  // One shared transform, applied to each selected body in place (#3). The prior
  // shape of each stays owned by its producing delta (§9); only the map
  // reference is replaced. The transform is rebuilt per body (BRepBuilderAPI
  // consumes it) and freed each time.
  for (const bodyId of op.bodyIds) {
    const shape = bodies.get(bodyId);
    if (!shape) {
      throw new KernelExecError('TARGET_MISSING', `Move target ${bodyId} missing`);
    }
    const trsf = rigidTrsf(oc, op.translate, op.rotate);
    const result = applyTrsf(oc, shape, trsf);
    trsf.delete();
    if (result.IsNull()) {
      result.delete();
      throw new KernelExecError('MOVE_FAILED', `Move ${op.id} failed`);
    }
    trackShapeAllocation();
    bodies.set(bodyId, result);
  }
}
