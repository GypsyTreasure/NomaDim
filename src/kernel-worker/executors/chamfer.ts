import type { OpenCascadeInstance, TopoDS_Edge, TopoDS_Shape } from 'opencascade.js';
import type { ChamferOp } from '../../document';
import { resolveEdges } from '../edgeFingerprint';
import { trackShapeAllocation } from '../handleCounter';
import { healInvalidSolid } from '../healShape';
import { KernelExecError, type ExecCtx } from './types';

/**
 * Chamfer executor (F4): equal-distance bevel of resolved edges. Mirrors the
 * fillet executor — resolve fingerprints, apply, replace the body; on failure
 * it retries edge-by-edge to name the exact offending edge(s) for the UI (#8).
 * An unresolvable fingerprint or a failed build surfaces as the op's error
 * state (§4).
 */

/** Attempts a chamfer of `edges` at `distance`; returns the result shape or null (never throws). */
function tryChamfer(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  edges: readonly TopoDS_Edge[],
  distance: number
): TopoDS_Shape | null {
  const maker = new oc.BRepFilletAPI_MakeChamfer(shape);
  const progress = new oc.Message_ProgressRange_1();
  let result: TopoDS_Shape | null = null;
  try {
    for (const edge of edges) maker.Add_2(distance, edge);
    maker.Build(progress);
    if (maker.IsDone()) {
      const shaped = maker.Shape();
      if (shaped.IsNull()) shaped.delete();
      else result = shaped;
    }
  } catch {
    result = null;
  } finally {
    maker.delete();
    progress.delete();
  }
  return result;
}

/** 1-based indices of the failing edges, phrased for a toast. */
function failureMessage(failedIndices: readonly number[]): string {
  if (failedIndices.length === 0) {
    return 'The distance may be too large for the selected edges.';
  }
  const labels = failedIndices.map((i) => `#${String(i + 1)}`).join(', ');
  return `The distance may be too large for edge ${labels}.`;
}

export function executeChamfer(ctx: ExecCtx, op: ChamferOp): void {
  const { oc, bodies } = ctx;
  const shape = bodies.get(op.bodyId);
  if (!shape) throw new KernelExecError('TARGET_MISSING', `Chamfer target ${op.bodyId} missing`);
  if (op.edges.length === 0) {
    throw new KernelExecError('CHAMFER_FAILED', 'Select at least one edge to chamfer.');
  }

  const edges = resolveEdges(oc, shape, op.edges);
  try {
    const result = tryChamfer(oc, shape, edges, op.distanceMm);
    if (!result) {
      const failed: number[] = [];
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        if (!edge) continue;
        const single = tryChamfer(oc, shape, [edge], op.distanceMm);
        if (single) single.delete();
        else failed.push(i);
      }
      throw new KernelExecError('CHAMFER_FAILED', failureMessage(failed), failed);
    }
    // Heal an invalid face so it still meshes/exports (no see-through hole).
    const healed = healInvalidSolid(oc, result);
    trackShapeAllocation();
    bodies.set(op.bodyId, healed);
  } finally {
    for (const edge of edges) edge.delete();
  }
}
