import type { Brand, BodyId, OpId, ProfileId } from '../core';
import type { EdgeFingerprint, LoopGeometry, TimelineOp } from '../document';

/**
 * The ONLY main<->worker contract (ARCHITECTURE §6). Discriminated unions,
 * exhaustively switched on both sides.
 *
 * M3 adds 'regen' + RegenPlan and the 'progress'/'regenDone' responses.
 * Still deferred: 'meshStats' (F6 triangle-count preview) arrives with the
 * M6 STL dialog. 'init' no longer creates geometry — bodies exist only as
 * regen results. 'dispose' remains for explicit cleanup paths.
 */

export type ReqId = Brand<string, 'ReqId'>;

export interface MeshQuality {
  linearDeflectionMm: number;
  angularDeflectionDeg: number;
}

/** R5: crosses the boundary exclusively as Transferable typed arrays, never JSON geometry. */
export interface MeshTransfer {
  bodyId: BodyId;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface KernelErrorPayload {
  code: string;
  message: string;
  opId?: string;
}

// ---------------------------------------------------------------------------
// Regen plan (ARCHITECTURE §9, R7)

/** Sketch plane placement in world space (Z-up); normal = xAxis × yAxis. */
export interface PlanePlacement {
  readonly origin: readonly [number, number, number];
  readonly xAxis: readonly [number, number, number];
  readonly yAxis: readonly [number, number, number];
}

/**
 * A profile resolved on the MAIN thread (R7): the worker builds outer wire +
 * inner wires → face with holes, and never re-derives topology.
 */
export interface PlanProfile {
  readonly id: ProfileId;
  readonly plane: PlanePlacement;
  readonly outer: LoopGeometry;
  readonly inner: readonly LoopGeometry[];
}

/** World-space revolve axis, resolved on the main thread (same-sketch line → 3D). */
export interface WorldAxis {
  readonly origin: readonly [number, number, number];
  readonly direction: readonly [number, number, number];
}

/**
 * One evaluated timeline entry: the serialized op plus everything the
 * worker must not re-derive — pre-resolved profiles (R7) and, for Revolve,
 * the world-space axis. Ops beyond the rollback marker are not in the plan
 * at all (§9).
 */
export interface PlanOp {
  readonly op: TimelineOp;
  readonly profiles: readonly PlanProfile[];
  readonly axisWorld?: WorldAxis;
  /** True when a non-body input (the consumed sketch op) is suppressed → op skips (§9). */
  readonly inputsSuppressed?: boolean;
}

export interface RegenPlan {
  readonly ops: readonly PlanOp[];
}

/**
 * One tessellated body edge shipped to the main thread for picking (F4):
 * its resolve-at-regen fingerprint plus a flat world-space polyline
 * [x,y,z, x,y,z, …] for hover-highlight and raycast. R5: the polyline
 * crosses as a Transferable.
 */
export interface EdgeTessellation {
  readonly fingerprint: EdgeFingerprint;
  readonly polyline: Float32Array;
}

export interface BodyEdges {
  readonly bodyId: BodyId;
  readonly edges: readonly EdgeTessellation[];
}

export type OpRunStatus = 'ok' | 'suppressed' | 'skipped' | 'error';

export interface OpStatusReport {
  readonly opId: OpId;
  readonly status: OpRunStatus;
  readonly code?: string;
  readonly message?: string;
}

export type KernelRequest =
  | { id: ReqId; kind: 'init' }
  | { id: ReqId; kind: 'regen'; generation: number; fromIndex: number; plan: RegenPlan }
  | { id: ReqId; kind: 'bodyEdges'; bodyIds: BodyId[] }
  | { id: ReqId; kind: 'tessellate'; bodyIds: BodyId[]; quality: MeshQuality }
  | {
      id: ReqId;
      kind: 'exportStl';
      bodyIds: BodyId[];
      format: 'binary' | 'ascii';
      linearDeflectionMm: number;
      angularDeflectionDeg: number;
    }
  | { id: ReqId; kind: 'dispose'; bodyIds: BodyId[] }
  | { id: ReqId; kind: 'stats' };

export type KernelOkResult =
  | { of: 'init' }
  | { of: 'exportStl'; stl: ArrayBuffer; fileName: string }
  | { of: 'dispose' }
  | { of: 'stats'; liveHandleCount: number };

export type KernelResponse =
  | { id: ReqId; kind: 'ok'; result: KernelOkResult }
  | { id: ReqId; kind: 'meshes'; meshes: MeshTransfer[] }
  | { id: ReqId; kind: 'progress'; opIndex: number }
  | {
      id: ReqId;
      kind: 'regenDone';
      generation: number;
      statuses: readonly OpStatusReport[];
      /** Viewport-quality meshes of every live body (R5 Transferables). */
      meshes: MeshTransfer[];
      liveBodyIds: readonly BodyId[];
    }
  | { id: ReqId; kind: 'bodyEdges'; bodyEdges: BodyEdges[] }
  | { id: ReqId; kind: 'error'; error: KernelErrorPayload };
