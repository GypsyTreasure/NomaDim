import { createId, KernelError, InternalError, type BodyId } from '../core';
import type {
  BodyEdges,
  FacePlaneResult,
  KernelRequest,
  KernelResponse,
  MeshQuality,
  MeshStat,
  MeshTransfer,
  OpStatusReport,
  PlanOp,
  RegenPlan,
  ReqId,
} from './protocol';

export interface StlExportRequest {
  bodyIds: BodyId[];
  format: 'binary' | 'ascii';
  linearDeflectionMm: number;
  angularDeflectionDeg: number;
}

export interface StlExportResult {
  stl: ArrayBuffer;
  fileName: string;
}

export interface RegenResult {
  readonly generation: number;
  readonly statuses: readonly OpStatusReport[];
  readonly meshes: MeshTransfer[];
  readonly liveBodyIds: readonly BodyId[];
}

interface PendingRequest {
  resolve: (response: KernelResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (opIndex: number) => void;
}

/** Regens superseded by a newer generation settle with this marker (benign). */
export class StaleRegenError extends Error {
  override readonly name = 'StaleRegenError';
}

/**
 * Main-thread kernel client (ARCHITECTURE §3, §6): worker lifecycle,
 * request/response correlation, progress fan-out. The only file this layer
 * reaches into inside `kernel-worker/` is its entry point
 * (kernel-worker-entry-only rule).
 */
export class KernelClient {
  private readonly worker: Worker;
  private readonly pending = new Map<ReqId, PendingRequest>();
  private readonly inFlightIds = new Set<string>();

  constructor() {
    this.worker = new Worker(new URL('../kernel-worker/index.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<KernelResponse>) => {
      this.handleMessage(event.data);
    };
  }

  async init(): Promise<void> {
    const response = await this.send({ id: this.nextId(), kind: 'init' });
    if (response.kind === 'ok' && response.result.of === 'init') return;
    throw new InternalError('Unexpected response to "init" request');
  }

  /** Runs a regen; progress ticks surface per executed op (R6-aware). */
  async regen(
    generation: number,
    fromIndex: number,
    plan: RegenPlan,
    onProgress?: (opIndex: number) => void
  ): Promise<RegenResult> {
    const response = await this.send(
      { id: this.nextId(), kind: 'regen', generation, fromIndex, plan },
      onProgress
    );
    if (response.kind === 'regenDone') {
      return {
        generation: response.generation,
        statuses: response.statuses,
        meshes: response.meshes,
        liveBodyIds: response.liveBodyIds,
      };
    }
    throw new InternalError('Unexpected response to "regen" request');
  }

  /** On-demand pickable edges for the given bodies (F4/F10) — kept off regen. */
  async bodyEdges(bodyIds: BodyId[]): Promise<BodyEdges[]> {
    const response = await this.send({ id: this.nextId(), kind: 'bodyEdges', bodyIds });
    if (response.kind === 'bodyEdges') {
      return response.bodyEdges;
    }
    throw new InternalError('Unexpected response to "bodyEdges" request');
  }

  /** Resolves the planar face under a picked world point → a sketch plane (F2 on-face). */
  async resolveFace(
    bodyId: BodyId,
    point: readonly [number, number, number]
  ): Promise<FacePlaneResult | null> {
    const response = await this.send({ id: this.nextId(), kind: 'resolveFace', bodyId, point });
    if (response.kind === 'faceResolved') {
      return response.face;
    }
    throw new InternalError('Unexpected response to "resolveFace" request');
  }

  async tessellate(bodyIds: BodyId[], quality: MeshQuality): Promise<MeshTransfer[]> {
    const response = await this.send({ id: this.nextId(), kind: 'tessellate', bodyIds, quality });
    if (response.kind === 'meshes') {
      return response.meshes;
    }
    throw new InternalError('Unexpected response to "tessellate" request');
  }

  /** F6 STL dialog: per-body triangle count at `quality` + validity flags. */
  async meshStats(bodyIds: BodyId[], quality: MeshQuality): Promise<MeshStat[]> {
    const response = await this.send({ id: this.nextId(), kind: 'meshStats', bodyIds, quality });
    if (response.kind === 'meshStats') {
      return response.stats;
    }
    throw new InternalError('Unexpected response to "meshStats" request');
  }

  /** Parse a STEP file to a solid, returned as a base64 BREP payload the Import
   * op embeds in the document (roadmap P1). */
  async importStep(bytes: ArrayBuffer): Promise<string> {
    const response = await this.send({ id: this.nextId(), kind: 'importStep', bytes });
    if (response.kind === 'imported') {
      return response.brepBase64;
    }
    throw new InternalError('Unexpected response to "importStep" request');
  }

  async exportStl(request: StlExportRequest): Promise<StlExportResult> {
    const response = await this.send({ id: this.nextId(), kind: 'exportStl', ...request });
    if (response.kind === 'ok' && response.result.of === 'exportStl') {
      return { stl: response.result.stl, fileName: response.result.fileName };
    }
    throw new InternalError('Unexpected response to "exportStl" request');
  }

  /** Export the given bodies to a single STEP file (roadmap P1). */
  async exportStep(bodyIds: BodyId[]): Promise<{ data: ArrayBuffer; fileName: string }> {
    const response = await this.send({ id: this.nextId(), kind: 'exportStep', bodyIds });
    if (response.kind === 'ok' && response.result.of === 'exportStep') {
      return { data: response.result.step, fileName: response.result.fileName };
    }
    throw new InternalError('Unexpected response to "exportStep" request');
  }

  /** F3 live ghost preview: meshes of the bodies a prospective op would change
   * (empty if it would fail). Never mutates the persistent BodyStateMap. */
  async preview(planOp: PlanOp): Promise<MeshTransfer[]> {
    const response = await this.send({ id: this.nextId(), kind: 'preview', planOp });
    if (response.kind === 'preview') {
      return response.meshes;
    }
    throw new InternalError('Unexpected response to "preview" request');
  }

  async disposeBodies(bodyIds: BodyId[]): Promise<void> {
    const response = await this.send({ id: this.nextId(), kind: 'dispose', bodyIds });
    if (response.kind === 'ok' && response.result.of === 'dispose') {
      return;
    }
    throw new InternalError('Unexpected response to "dispose" request');
  }

  async stats(): Promise<number> {
    const response = await this.send({ id: this.nextId(), kind: 'stats' });
    if (response.kind === 'ok' && response.result.of === 'stats') {
      return response.result.liveHandleCount;
    }
    throw new InternalError('Unexpected response to "stats" request');
  }

  terminate(): void {
    this.worker.terminate();
    for (const { reject } of this.pending.values()) {
      reject(new InternalError('KernelClient terminated with requests in flight'));
    }
    this.pending.clear();
    this.inFlightIds.clear();
  }

  private nextId(): ReqId {
    const id = createId<'ReqId'>(this.inFlightIds);
    this.inFlightIds.add(id);
    return id;
  }

  private send(
    request: KernelRequest,
    onProgress?: (opIndex: number) => void
  ): Promise<KernelResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject, onProgress });
      this.worker.postMessage(request);
    });
  }

  private handleMessage(response: KernelResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;

    if (response.kind === 'progress') {
      pending.onProgress?.(response.opIndex);
      return; // request still in flight
    }

    this.pending.delete(response.id);
    this.inFlightIds.delete(response.id);

    if (response.kind === 'error') {
      pending.reject(
        response.error.code === 'STALE_GENERATION'
          ? new StaleRegenError(response.error.message)
          : new KernelError(response.error.message, response.error.code, response.error.opId)
      );
    } else {
      pending.resolve(response);
    }
  }
}
