import type { ImportOp } from '../../document';
import { trackShapeAllocation } from '../handleCounter';
import { brepBase64ToShape } from '../stepio';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Import executor (roadmap P1): reconstructs the imported base body from the
 * op's embedded base64 BREP payload and stores it under its body id. A
 * parentless root — it consumes no bodies, so it always runs (the geometry
 * travels with the document).
 */
export function executeImport(ctx: ExecCtx, op: ImportOp): void {
  const { oc, bodies } = ctx;
  const shape = brepBase64ToShape(oc, op.brepBase64);
  if (shape.IsNull()) {
    shape.delete();
    throw new KernelExecError('IMPORT_FAILED', `Import ${op.id} produced no geometry`);
  }
  trackShapeAllocation();
  bodies.set(op.bodyId, shape);
}
