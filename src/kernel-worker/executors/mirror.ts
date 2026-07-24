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
  const source = bodies.get(op.sourceBodyId);
  if (!source) {
    throw new KernelExecError('SOURCE_MISSING', `Mirror source ${op.sourceBodyId} missing`);
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

  // Join → fuse into the source id; NewBody → the reflection is its own body.
  applyBooleanResult(
    ctx,
    op.operation === 'Join' ? 'Join' : 'NewBody',
    op.bodyId,
    op.operation === 'Join' ? op.sourceBodyId : null,
    reflected
  );
}
