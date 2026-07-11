import { createId, KernelError, InternalError, type BodyId } from '../core';
import type { KernelRequest, KernelResponse, MeshQuality, MeshTransfer, ReqId } from './protocol';

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

interface PendingRequest {
  resolve: (response: KernelResponse) => void;
  reject: (error: Error) => void;
}

/**
 * Main-thread kernel client (ARCHITECTURE §3, §6): worker lifecycle,
 * request/response correlation over `kernel/protocol.ts`. The only file
 * this layer reaches into inside `kernel-worker/` is its entry point
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

  async init(): Promise<BodyId[]> {
    const response = await this.send({ id: this.nextId(), kind: 'init' });
    if (response.kind === 'ok' && response.result.of === 'init') {
      return response.result.bodyIds;
    }
    throw new InternalError('Unexpected response to "init" request');
  }

  async tessellate(bodyIds: BodyId[], quality: MeshQuality): Promise<MeshTransfer[]> {
    const response = await this.send({ id: this.nextId(), kind: 'tessellate', bodyIds, quality });
    if (response.kind === 'meshes') {
      return response.meshes;
    }
    throw new InternalError('Unexpected response to "tessellate" request');
  }

  async exportStl(request: StlExportRequest): Promise<StlExportResult> {
    const response = await this.send({ id: this.nextId(), kind: 'exportStl', ...request });
    if (response.kind === 'ok' && response.result.of === 'exportStl') {
      return { stl: response.result.stl, fileName: response.result.fileName };
    }
    throw new InternalError('Unexpected response to "exportStl" request');
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

  private send(request: KernelRequest): Promise<KernelResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private handleMessage(response: KernelResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    this.inFlightIds.delete(response.id);

    if (response.kind === 'error') {
      pending.reject(
        new KernelError(response.error.message, response.error.code, response.error.opId)
      );
    } else {
      pending.resolve(response);
    }
  }
}
