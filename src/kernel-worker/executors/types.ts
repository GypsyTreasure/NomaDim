import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import type { BodyId, ProfileId } from '../../core';
import type { PlanOp, PlanProfile } from '../../kernel/protocol';

/**
 * Executor contract (ARCHITECTURE §7/§9): `execute(ctx, planOp)` reads
 * input bodies from the BodyStateMap and writes results back — never
 * assume a linear single-body chain. Failures throw KernelExecError
 * (mapped to the op's error status by the regen loop); shapes written into
 * `ctx.bodies` are owned by the delta cache afterwards.
 */

export type BodyStateMap = Map<BodyId, TopoDS_Shape>;

export interface ExecCtx {
  readonly oc: OpenCascadeInstance;
  readonly bodies: BodyStateMap;
  /** Pre-resolved profiles for the CURRENT op, keyed by ProfileId (R7). */
  readonly profiles: ReadonlyMap<ProfileId, PlanProfile>;
}

export class KernelExecError extends Error {
  override readonly name = 'KernelExecError';
  constructor(
    readonly code: string,
    message: string,
    /**
     * For edge-based ops (Fillet/Chamfer): the indices — into the op's edge
     * list — of the edges that could not be built, so the UI can name and
     * highlight the offending edge(s) (#8). Empty/undefined when not applicable.
     */
    readonly failedEdgeIndices?: readonly number[]
  ) {
    super(message);
  }
}

export type OpExecutor = (ctx: ExecCtx, planOp: PlanOp) => void;
