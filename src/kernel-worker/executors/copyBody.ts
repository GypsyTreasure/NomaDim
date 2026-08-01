import type { CopyBodyOp } from '../../document';
import { trackShapeAllocation } from '../handleCounter';
import { applyTrsf, rigidTrsf } from './transform';
import { KernelExecError, type ExecCtx } from './types';

/**
 * CopyBody executor (F9): duplicates the source body AS IT STANDS in the map
 * at this op's position (parametric + positional) and stores an independent
 * copy under a new body id, rotated (Euler XYZ about the origin) then
 * translated. `BRepBuilderAPI_Transform` with copy=true keeps the source
 * (owned by its producing delta, §9) untouched.
 */
export function executeCopyBody(ctx: ExecCtx, op: CopyBodyOp): void {
  const { oc, bodies } = ctx;
  // Copy each (source → produced) pair with the same transform (#3): the primary
  // plus any extra instances. Each source stays owned by its producing delta.
  const instances = [
    { sourceBodyId: op.sourceBodyId, bodyId: op.bodyId },
    ...(op.extraInstances ?? []),
  ];
  for (const inst of instances) {
    const source = bodies.get(inst.sourceBodyId);
    if (!source) {
      throw new KernelExecError('SOURCE_MISSING', `CopyBody source ${inst.sourceBodyId} missing`);
    }
    const trsf = rigidTrsf(oc, op.translate, op.rotate);
    const result = applyTrsf(oc, source, trsf);
    trsf.delete();
    if (result.IsNull()) {
      result.delete();
      throw new KernelExecError('COPY_FAILED', `CopyBody ${op.id} failed`);
    }
    trackShapeAllocation();
    bodies.set(inst.bodyId, result);
  }
}
