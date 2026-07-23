import type { OpenCascadeInstance, TopoDS_Shape, gp_Trsf } from 'opencascade.js';
import type { PatternOp } from '../../document';
import { applyBooleanResult } from './booleanApply';
import { applyTrsf, axisRotationTrsf, axisUnit, fuseAll, vectorTranslationTrsf } from './transform';
import { KernelExecError, type ExecCtx } from './types';

/** Per-instance placement transforms (position 0, the source, is excluded). */
function linearGridTrsfs(oc: OpenCascadeInstance, op: PatternOp): gp_Trsf[] {
  const d1 = { u: axisUnit(op.axis), count: op.count, spacing: op.spacingMm };
  const d2 = { u: axisUnit(op.axis2), count: Math.max(1, op.count2), spacing: op.spacingMm2 };
  const d3 = { u: axisUnit(op.axis3), count: Math.max(1, op.count3), spacing: op.spacingMm3 };
  const trsfs: gp_Trsf[] = [];
  for (let i = 0; i < d1.count; i += 1) {
    for (let j = 0; j < d2.count; j += 1) {
      for (let k = 0; k < d3.count; k += 1) {
        if (i === 0 && j === 0 && k === 0) continue; // the source's own cell
        const dx = d1.u[0] * d1.spacing * i + d2.u[0] * d2.spacing * j + d3.u[0] * d3.spacing * k;
        const dy = d1.u[1] * d1.spacing * i + d2.u[1] * d2.spacing * j + d3.u[1] * d3.spacing * k;
        const dz = d1.u[2] * d1.spacing * i + d2.u[2] * d2.spacing * j + d3.u[2] * d3.spacing * k;
        trsfs.push(vectorTranslationTrsf(oc, dx, dy, dz));
      }
    }
  }
  return trsfs;
}

/** Circular placement transforms: `angleDeg / (count - 1)` per step. */
function circularTrsfs(oc: OpenCascadeInstance, op: PatternOp): gp_Trsf[] {
  const steps = op.count - 1;
  const trsfs: gp_Trsf[] = [];
  for (let i = 1; i <= steps; i += 1) {
    trsfs.push(axisRotationTrsf(oc, op.axis, (op.angleDeg / steps) * i));
  }
  return trsfs;
}

/**
 * Pattern executor (P1, multi-axis grid #4): a linear or circular array of the
 * source body. A **linear** pattern arrays along up to three independent axes at
 * once (a box/grid); each empty grid cell but the source's own becomes an
 * instance. Circular arrays sweep `angleDeg` about `axis`. All instances are
 * fused into one shape, then stored as a new body (NewBody) or fused into the
 * source (Join) via `applyBooleanResult` (heals too). `angleDeg` is the total
 * sweep across all instances (360° gives a full ring meeting the source).
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

  const trsfs = op.kind === 'linear' ? linearGridTrsfs(oc, op) : circularTrsfs(oc, op);
  const instances: TopoDS_Shape[] = [];
  for (let idx = 0; idx < trsfs.length; idx += 1) {
    const trsf = trsfs[idx];
    if (!trsf) continue;
    const copy = applyTrsf(oc, source, trsf);
    trsf.delete();
    if (copy.IsNull()) {
      copy.delete();
      for (const s of instances) s.delete();
      for (let rest = idx + 1; rest < trsfs.length; rest += 1) trsfs[rest]?.delete();
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
