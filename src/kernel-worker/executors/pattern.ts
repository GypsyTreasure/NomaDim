import type { TopoDS_Shape } from 'opencascade.js';
import type { PatternOp } from '../../document';
import { applyBooleanResult } from './booleanApply';
import { applyTrsf, axisRotationTrsf, axisTranslationTrsf, fuseAll } from './transform';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Pattern executor (P1): a linear or circular array of the source body. It
 * builds the `count - 1` extra instances (position 0 is the source itself),
 * fuses them into one shape, then either stores that as a new body (NewBody) or
 * fuses it into the source (Join) — reusing `applyBooleanResult` (heals too).
 * Circular spacing = `angleDeg / (count - 1)` per step, so `angleDeg` is the
 * total sweep across all instances (360° gives a full ring with the last step
 * meeting the source).
 */
export function executePattern(ctx: ExecCtx, op: PatternOp): void {
  const { oc, bodies } = ctx;
  const source = bodies.get(op.sourceBodyId);
  if (!source) {
    throw new KernelExecError('SOURCE_MISSING', `Pattern source ${op.sourceBodyId} missing`);
  }
  if (op.count < 2) {
    throw new KernelExecError('PATTERN_FAILED', 'Pattern needs a count of at least 2.');
  }

  const axis = op.axis; // OriginAxis is structurally a WorldAxisName ('X'|'Y'|'Z')
  const steps = op.count - 1;
  const instances: TopoDS_Shape[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const trsf =
      op.kind === 'linear'
        ? axisTranslationTrsf(oc, axis, op.spacingMm * i)
        : axisRotationTrsf(oc, axis, (op.angleDeg / steps) * i);
    const copy = applyTrsf(oc, source, trsf);
    trsf.delete();
    if (copy.IsNull()) {
      copy.delete();
      for (const s of instances) s.delete();
      throw new KernelExecError('PATTERN_FAILED', `Pattern ${op.id} failed`);
    }
    instances.push(copy);
  }

  const tool = fuseAll(oc, instances); // consumes every instance
  if (!tool) {
    throw new KernelExecError('PATTERN_FAILED', `Pattern ${op.id} failed`);
  }

  applyBooleanResult(
    ctx,
    op.operation === 'Join' ? 'Join' : 'NewBody',
    op.bodyId,
    op.operation === 'Join' ? op.sourceBodyId : null,
    tool
  );
}
