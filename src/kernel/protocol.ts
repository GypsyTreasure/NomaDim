import type { Brand, BodyId } from '../core';

/**
 * The ONLY main<->worker contract (ARCHITECTURE §6). Discriminated unions,
 * exhaustively switched on both sides.
 *
 * M1 scope: init / tessellate / exportStl / dispose / stats — enough to
 * prove the worker pipeline (hardcoded box -> tessellate -> render -> STL
 * download -> live-handle counter back to baseline). Deferred, arriving with
 * the milestone that gives them a real payload to carry:
 *   - 'regen' + RegenPlan: M3, with document/ops and services/RegenScheduler.
 *   - 'progress': M3, per-op progress during a multi-op regen loop.
 *   - 'meshStats' (F6 triangle-count preview, counts only/no buffers): M6.
 *   - 'dispose' is M1's stand-in for regen's cache-invalidation disposal
 *     (ARCHITECTURE §9 "free cached deltas") — it stays useful afterwards
 *     for explicit body deletion / Combine's consumed-tool-body cleanup.
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

export type KernelRequest =
  | { id: ReqId; kind: 'init' }
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
  | { of: 'init'; bodyIds: BodyId[] }
  | { of: 'exportStl'; stl: ArrayBuffer; fileName: string }
  | { of: 'dispose' }
  | { of: 'stats'; liveHandleCount: number };

export type KernelResponse =
  | { id: ReqId; kind: 'ok'; result: KernelOkResult }
  | { id: ReqId; kind: 'meshes'; meshes: MeshTransfer[] }
  | { id: ReqId; kind: 'error'; error: KernelErrorPayload };
