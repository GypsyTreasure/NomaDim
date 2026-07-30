import type { OpenCascadeInstance, TopoDS_Edge, TopoDS_Shape } from 'opencascade.js';
import type { FilletOp } from '../../document';
import { resolveEdges } from '../edgeFingerprint';
import { trackShapeAllocation } from '../handleCounter';
import { healInvalidSolid } from '../healShape';
import { enumArg } from '../occtCompat';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Fillet executor (F4): resolves the op's edge fingerprints against the live
 * target body, rounds them by a single radius, and replaces the body in the
 * map. When the round fails, the op is retried edge-by-edge to name the exact
 * offending edge(s) so the UI can highlight them (#8). An unresolvable
 * fingerprint or a failed build throws → the regen loop marks the op `error`
 * and renders the last good state (graceful, MASTER_DOCUMENT §4).
 */

/** Attempts a fillet of `edges` at `radius`; returns the result shape or null (never throws). */
function tryFillet(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  edges: readonly TopoDS_Edge[],
  radius: number
): TopoDS_Shape | null {
  const maker = new oc.BRepFilletAPI_MakeFillet(
    shape,
    enumArg(oc.ChFi3d_FilletShape.ChFi3d_Rational)
  );
  const progress = new oc.Message_ProgressRange_1();
  let result: TopoDS_Shape | null = null;
  try {
    for (const edge of edges) maker.Add_2(radius, edge);
    maker.Build(progress);
    if (maker.IsDone()) {
      const shaped = maker.Shape();
      if (shaped.IsNull()) shaped.delete();
      else result = shaped;
    }
  } catch {
    result = null; // OCCT can throw on a degenerate round — treat as "failed"
  } finally {
    maker.delete();
    progress.delete();
  }
  return result;
}

/** 1-based indices of the failing edges, phrased for a toast. */
function failureMessage(failedIndices: readonly number[]): string {
  if (failedIndices.length === 0) {
    return 'The radius may be too large for the selected edges.';
  }
  const labels = failedIndices.map((i) => `#${String(i + 1)}`).join(', ');
  return `The radius may be too large for edge ${labels}.`;
}

export function executeFillet(ctx: ExecCtx, op: FilletOp): void {
  const { oc, bodies } = ctx;
  const shape = bodies.get(op.bodyId);
  if (!shape) throw new KernelExecError('TARGET_MISSING', `Fillet target ${op.bodyId} missing`);
  if (op.edges.length === 0) {
    throw new KernelExecError('FILLET_FAILED', 'Select at least one edge to fillet.');
  }

  const edges = resolveEdges(oc, shape, op.edges);
  try {
    const result = tryFillet(oc, shape, edges, op.radiusMm);
    if (!result) {
      // Retry each edge alone to pinpoint the culprit(s) for the UI (#8).
      const failed: number[] = [];
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        if (!edge) continue;
        const single = tryFillet(oc, shape, [edge], op.radiusMm);
        if (single) single.delete();
        else failed.push(i);
      }
      throw new KernelExecError('FILLET_FAILED', failureMessage(failed), failed);
    }
    // Heal an invalid face so it still meshes/exports (no see-through hole).
    const healed = healInvalidSolid(oc, result);
    trackShapeAllocation();
    bodies.set(op.bodyId, healed);
  } finally {
    for (const edge of edges) edge.delete();
  }
}
