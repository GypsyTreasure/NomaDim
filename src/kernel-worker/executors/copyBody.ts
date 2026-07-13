import type { CopyBodyOp } from '../../document';
import { trackShapeAllocation } from '../handleCounter';
import { KernelExecError, type ExecCtx } from './types';

/**
 * CopyBody executor (F9): duplicates the source body AS IT STANDS in the map
 * at this op's position (parametric + positional) and stores the copy under a
 * new body id, optionally translated. `BRepBuilderAPI_Transform` with
 * copy=true produces an independent shape; the source stays owned by its
 * producing delta (§9).
 */
export function executeCopyBody(ctx: ExecCtx, op: CopyBodyOp): void {
  const { oc, bodies } = ctx;
  const source = bodies.get(op.sourceBodyId);
  if (!source) {
    throw new KernelExecError('SOURCE_MISSING', `CopyBody source ${op.sourceBodyId} missing`);
  }

  const trsf = new oc.gp_Trsf_1();
  const vec = new oc.gp_Vec_4(op.translate[0], op.translate[1], op.translate[2]);
  trsf.SetTranslation_1(vec);
  const transform = new oc.BRepBuilderAPI_Transform_2(source, trsf, true);
  const result = transform.Shape();
  transform.delete();
  vec.delete();
  trsf.delete();

  if (result.IsNull()) {
    result.delete();
    throw new KernelExecError('COPY_FAILED', `CopyBody ${op.id} failed`);
  }
  trackShapeAllocation();
  bodies.set(op.bodyId, result);
}
