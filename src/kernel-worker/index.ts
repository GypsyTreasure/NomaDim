import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import type { BodyId } from '../core';
import { createId } from '../core';
import type { KernelRequest, KernelResponse, MeshTransfer } from '../kernel/protocol';
import { loadOcct } from './occt';
import { createHardcodedBox, disposeShape } from './box';
import { tessellateShape } from './tessellate';
import { exportShapeToStl } from './stl';
import { getLiveShapeCount } from './handleCounter';

/**
 * Worker entry point (ARCHITECTURE §3, §6). The ONLY layer permitted to
 * import opencascade.js. `new Worker(new URL('./index.ts', import.meta.url))`
 * is the sole thing `kernel/` is allowed to reach into here
 * (kernel-worker-entry-only rule).
 *
 * M1: a single hardcoded box stands in for the `BodyStateMap` that arrives
 * with real ops in M3 — this file proves the message-protocol/WASM/mesh
 * transfer/STL-export/live-handle-count pipeline end-to-end first.
 */

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<KernelRequest>) => void) | null;
}
declare const self: WorkerScope;

const bodies = new Map<BodyId, TopoDS_Shape>();
let occtInstance: OpenCascadeInstance | null = null;

function requireOcct(): OpenCascadeInstance {
  if (!occtInstance) {
    throw new Error('OCCT not initialized — send an "init" request first');
  }
  return occtInstance;
}

function respond(response: KernelResponse, transfer?: Transferable[]): void {
  self.postMessage(response, transfer ?? []);
}

async function handleRequest(request: KernelRequest): Promise<void> {
  try {
    switch (request.kind) {
      case 'init': {
        occtInstance = await loadOcct();
        const existingIds = new Set<string>(bodies.keys());
        const bodyId = createId<'BodyId'>(existingIds);
        bodies.set(bodyId, createHardcodedBox(occtInstance));
        respond({ id: request.id, kind: 'ok', result: { of: 'init', bodyIds: [bodyId] } });
        return;
      }
      case 'tessellate': {
        const oc = requireOcct();
        const meshes: MeshTransfer[] = [];
        for (const bodyId of request.bodyIds) {
          const shape = bodies.get(bodyId);
          if (shape) {
            meshes.push(tessellateShape(oc, bodyId, shape, request.quality));
          }
        }
        const transfer = meshes.flatMap((m) => [
          m.positions.buffer,
          m.normals.buffer,
          m.indices.buffer,
        ]);
        respond({ id: request.id, kind: 'meshes', meshes }, transfer);
        return;
      }
      case 'exportStl': {
        const oc = requireOcct();
        const bodyId = request.bodyIds.find((id) => bodies.has(id));
        const shape = bodyId ? bodies.get(bodyId) : undefined;
        if (!shape) {
          respond({
            id: request.id,
            kind: 'error',
            error: { code: 'NO_BODY', message: 'No matching body to export' },
          });
          return;
        }
        const stl = exportShapeToStl(oc, shape, {
          format: request.format,
          linearDeflectionMm: request.linearDeflectionMm,
          angularDeflectionDeg: request.angularDeflectionDeg,
        });
        respond(
          {
            id: request.id,
            kind: 'ok',
            result: { of: 'exportStl', stl, fileName: 'nomadim-export.stl' },
          },
          [stl]
        );
        return;
      }
      case 'dispose': {
        for (const bodyId of request.bodyIds) {
          const shape = bodies.get(bodyId);
          if (shape) {
            disposeShape(shape);
            bodies.delete(bodyId);
          }
        }
        respond({ id: request.id, kind: 'ok', result: { of: 'dispose' } });
        return;
      }
      case 'stats': {
        respond({
          id: request.id,
          kind: 'ok',
          result: { of: 'stats', liveHandleCount: getLiveShapeCount() },
        });
        return;
      }
    }
  } catch (error) {
    respond({
      id: request.id,
      kind: 'error',
      error: {
        code: 'KERNEL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

self.onmessage = (event) => {
  void handleRequest(event.data);
};
