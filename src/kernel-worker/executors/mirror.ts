import type { MirrorOp } from '../../document';
import type { WorldPlane } from '../../kernel/protocol';
import { applyBooleanResult } from './booleanApply';
import { applyTrsf, mirrorPlaneTrsf, mirrorTrsf } from './transform';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Mirror executor (P1): reflects the source body across a world plane — an
 * origin plane, or a construction plane resolved to world (origin + normal) by
 * the plan resolver (#datum). The reflected shape is a fresh copy (source
 * preserved, §9); it is then either stored as a new body (NewBody) or fused
 * into the source (Join) via the shared `applyBooleanResult` tail — which also
 * heals an invalid face (ADR-0057).
 */
export function executeMirror(ctx: ExecCtx, op: MirrorOp, planeWorld?: WorldPlane): void {
  const { oc, bodies } = ctx;
  // Reflect each source (primary + extras, #3) across the same plane, then
  // Join it into that source or store it as its own new body.
  const instances = [
    { sourceBodyId: op.sourceBodyId, bodyId: op.bodyId },
    ...(op.extraInstances ?? []),
  ];
  for (const inst of instances) {
    const source = bodies.get(inst.sourceBodyId);
    if (!source) {
      throw new KernelExecError('SOURCE_MISSING', `Mirror source ${inst.sourceBodyId} missing`);
    }
    const trsf = planeWorld
      ? mirrorPlaneTrsf(oc, planeWorld.origin, planeWorld.normal)
      : mirrorTrsf(oc, op.plane);
    const reflected = applyTrsf(oc, source, trsf);
    trsf.delete();
    if (reflected.IsNull()) {
      reflected.delete();
      throw new KernelExecError('MIRROR_FAILED', `Mirror ${op.id} failed`);
    }
    applyBooleanResult(
      ctx,
      op.operation === 'Join' ? 'Join' : 'NewBody',
      inst.bodyId,
      op.operation === 'Join' ? [inst.sourceBodyId] : [],
      reflected
    );
  }
}
