import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import type { BodyId } from '../core';
import { VIEWPORT_ANGULAR_DEFLECTION_DEG, VIEWPORT_LINEAR_DEFLECTION_MM } from '../core';
import { OP_DEFINITIONS } from '../document';
import type {
  BodyEdges,
  KernelRequest,
  KernelResponse,
  MeshQuality,
  MeshStat,
  MeshTransfer,
  OpStatusReport,
  PlanOp,
  RegenPlan,
  ReqId,
} from '../kernel/protocol';
import { loadOcct } from './occt';
import { tessellateShape } from './tessellate';
import { shapeMeshStat } from './meshStats';
import { readStepToBrepBase64, writeStepBytes } from './stepio';
import { tessellateBodyEdges } from './edgeFingerprint';
import { resolveSketchFace } from './faceResolve';
import { exportShapeToStl } from './stl';
import { getLiveShapeCount, trackShapeDisposal } from './handleCounter';
import { ShapeCache, diffDelta, emptyDelta, snapshotRefs } from './bodyState';
import { OP_EXECUTORS } from './executors/registry';
import { KernelExecError, type BodyStateMap } from './executors/types';

/**
 * Worker entry point (ARCHITECTURE §3, §6, §9). The ONLY layer permitted to
 * import opencascade.js; `kernel/` reaches in solely to instantiate the
 * Worker from this file. Holds the BodyStateMap + per-op delta cache and
 * runs the regeneration loop with suppression/skip semantics, generation
 * cancellation (R6), and Transferable mesh responses (R5).
 */

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<KernelRequest>) => void) | null;
}
declare const self: WorkerScope;

let occtInstance: OpenCascadeInstance | null = null;
let bodies: BodyStateMap = new Map();
const cache = new ShapeCache();
/** Highest generation seen — bumped synchronously in onmessage (R6). */
let latestGeneration = 0;

function respond(response: KernelResponse, transfer?: Transferable[]): void {
  self.postMessage(response, transfer ?? []);
}

async function ensureOcct(): Promise<OpenCascadeInstance> {
  occtInstance ??= await loadOcct();
  return occtInstance;
}

/** Macrotask yield: lets queued messages (newer regens) land between ops. */
function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function tessellateLiveBodies(oc: OpenCascadeInstance): MeshTransfer[] {
  const meshes: MeshTransfer[] = [];
  for (const [bodyId, shape] of bodies) {
    meshes.push(
      tessellateShape(oc, bodyId, shape, {
        linearDeflectionMm: VIEWPORT_LINEAR_DEFLECTION_MM,
        angularDeflectionDeg: VIEWPORT_ANGULAR_DEFLECTION_DEG,
      })
    );
  }
  return meshes;
}

/** On-demand edge tessellation (F4/F10) — kept OUT of regen for 100-body perf. */
function edgesFor(oc: OpenCascadeInstance, bodyIds: readonly BodyId[]): BodyEdges[] {
  const bodyEdges: BodyEdges[] = [];
  for (const bodyId of bodyIds) {
    const shape = bodies.get(bodyId);
    if (shape) bodyEdges.push({ bodyId, edges: tessellateBodyEdges(oc, shape) });
  }
  return bodyEdges;
}

async function handleRegen(
  id: ReqId,
  generation: number,
  fromIndex: number,
  plan: RegenPlan
): Promise<void> {
  const oc = await ensureOcct();

  // An aborted prior regen may have left fewer valid deltas than the
  // scheduler assumes — clamp to the cache's contiguous prefix (R6 note in
  // bodyState.ts), then free stale deltas and restore state after k-1 (§9).
  const start = Math.min(fromIndex, cache.length);
  cache.freeFrom(start);
  bodies = cache.restoreTo(start);

  for (let i = start; i < plan.ops.length; i += 1) {
    if (generation < latestGeneration) {
      respond({ id, kind: 'error', error: { code: 'STALE_GENERATION', message: 'superseded' } });
      return;
    }
    const planOp = plan.ops[i];
    if (!planOp) continue;
    const op = planOp.op;

    if (op.suppressed) {
      // Body-producing op: its bodyId simply never enters the map.
      // Body-modifying op: target keeps prior state. Both = empty delta (§9).
      cache.record(i, emptyDelta(), { opId: op.id, status: 'suppressed' });
      continue;
    }
    const deps = OP_DEFINITIONS[op.type].dependencies(op);
    if (planOp.inputsSuppressed || deps.consumesBodies.some((b) => !bodies.has(b))) {
      cache.record(i, emptyDelta(), { opId: op.id, status: 'skipped' });
      continue;
    }

    const before = snapshotRefs(bodies);
    try {
      OP_EXECUTORS[op.type](
        {
          oc,
          bodies,
          profiles: new Map(planOp.profiles.map((p) => [p.id, p])),
        },
        planOp
      );
      cache.record(i, diffDelta(before, bodies), { opId: op.id, status: 'ok' });
    } catch (error) {
      // Failed op: its target keeps its last good state (restored). Later ops
      // are NOT force-skipped — they run on that state and are skipped only if a
      // body they consume is genuinely absent (the check above). So one bad
      // feature (e.g. a chamfer whose distance is too large) no longer nukes the
      // rest of the timeline; independent downstream features still compute (§9).
      bodies = cache.restoreTo(i);
      cache.record(i, emptyDelta(), {
        opId: op.id,
        status: 'error',
        code: error instanceof KernelExecError ? error.code : 'KERNEL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    respond({ id, kind: 'progress', opIndex: i });
    await yieldToMessages();
  }

  if (generation < latestGeneration) {
    respond({ id, kind: 'error', error: { code: 'STALE_GENERATION', message: 'superseded' } });
    return;
  }

  // Full status array from the cache — survives aborted generations.
  const statuses: OpStatusReport[] = [];
  for (let i = 0; i < plan.ops.length; i += 1) {
    const status = cache.statusAt(i);
    if (status) statuses.push(status);
  }

  const meshes = tessellateLiveBodies(oc);
  const transfer = meshes.flatMap((m) => [m.positions.buffer, m.normals.buffer, m.indices.buffer]);
  respond(
    {
      id,
      kind: 'regenDone',
      generation,
      statuses,
      meshes,
      liveBodyIds: [...bodies.keys()],
    },
    transfer
  );
}

/**
 * F3 live ghost preview: run a prospective op against a throwaway COPY of the
 * live body map and tessellate whichever bodies it changed, WITHOUT recording
 * anything in the persistent cache. Every shape the executor creates here is
 * freed before returning (it is owned by nothing else), so the R8 handle count
 * is unchanged. A failing op (bad params, too-large radius) yields no preview.
 */
function previewOp(oc: OpenCascadeInstance, planOp: PlanOp): MeshTransfer[] {
  const previewBodies: BodyStateMap = new Map(bodies);
  const before = snapshotRefs(previewBodies);
  const meshes: MeshTransfer[] = [];
  try {
    OP_EXECUTORS[planOp.op.type](
      { oc, bodies: previewBodies, profiles: new Map(planOp.profiles.map((p) => [p.id, p])) },
      planOp
    );
    const changed = diffDelta(before, previewBodies).changed;
    for (const [bodyId, shape] of changed) {
      meshes.push(
        tessellateShape(oc, bodyId, shape, {
          linearDeflectionMm: VIEWPORT_LINEAR_DEFLECTION_MM,
          angularDeflectionDeg: VIEWPORT_ANGULAR_DEFLECTION_DEG,
        })
      );
    }
    // Free the shapes the preview op created — the persistent cache never owns
    // them. The prior shapes it may have replaced stay owned by `bodies`.
    for (const shape of changed.values()) {
      shape.delete();
      trackShapeDisposal();
    }
  } catch {
    // No preview for an op that would error — the toast/red-chip path covers
    // the real attempt. Free any shapes that reached the copy before the throw
    // so the handle count stays balanced (they are owned by nothing else).
    for (const shape of diffDelta(before, previewBodies).changed.values()) {
      shape.delete();
      trackShapeDisposal();
    }
    return [];
  }
  return meshes;
}

/**
 * F6 STL dialog: per-body triangle count + watertightness at the chosen export
 * deflection, so the dialog shows a live count and warns about a body that would
 * export a non-manifold (unprintable) mesh. Per-shape computation is the pure,
 * unit-tested `shapeMeshStat`.
 */
function meshStatsFor(
  oc: OpenCascadeInstance,
  bodyIds: readonly BodyId[],
  quality: MeshQuality
): MeshStat[] {
  const out: MeshStat[] = [];
  for (const bodyId of bodyIds) {
    const shape = bodies.get(bodyId);
    if (!shape) continue;
    const stat = shapeMeshStat(oc, shape, quality);
    out.push({ bodyId, triangleCount: stat.triangleCount, valid: stat.watertight });
  }
  return out;
}

function collectShapes(bodyIds: readonly BodyId[]): TopoDS_Shape[] {
  const shapes: TopoDS_Shape[] = [];
  for (const bodyId of bodyIds) {
    const shape = bodies.get(bodyId);
    if (shape) shapes.push(shape);
  }
  return shapes;
}

async function handleRequest(request: KernelRequest): Promise<void> {
  try {
    switch (request.kind) {
      case 'init': {
        await ensureOcct();
        respond({ id: request.id, kind: 'ok', result: { of: 'init' } });
        return;
      }
      case 'regen': {
        await handleRegen(request.id, request.generation, request.fromIndex, request.plan);
        return;
      }
      case 'bodyEdges': {
        const oc = await ensureOcct();
        const bodyEdges = edgesFor(oc, request.bodyIds);
        const transfer = bodyEdges.flatMap((b) => b.edges.map((e) => e.polyline.buffer));
        respond({ id: request.id, kind: 'bodyEdges', bodyEdges }, transfer);
        return;
      }
      case 'resolveFace': {
        const oc = await ensureOcct();
        const shape = bodies.get(request.bodyId);
        const face = shape ? resolveSketchFace(oc, shape, request.point) : null;
        respond({ id: request.id, kind: 'faceResolved', face });
        return;
      }
      case 'tessellate': {
        const oc = await ensureOcct();
        const meshes: MeshTransfer[] = [];
        for (const bodyId of request.bodyIds) {
          const shape = bodies.get(bodyId);
          if (shape) meshes.push(tessellateShape(oc, bodyId, shape, request.quality));
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
        const oc = await ensureOcct();
        const shapes = collectShapes(request.bodyIds);
        if (shapes.length === 0) {
          respond({
            id: request.id,
            kind: 'error',
            error: { code: 'NO_BODY', message: 'No bodies to export' },
          });
          return;
        }
        const stl = exportBodiesToStl(oc, shapes, request);
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
      case 'meshStats': {
        const oc = await ensureOcct();
        respond({
          id: request.id,
          kind: 'meshStats',
          stats: meshStatsFor(oc, request.bodyIds, request.quality),
        });
        return;
      }
      case 'importStep': {
        const oc = await ensureOcct();
        const brepBase64 = readStepToBrepBase64(oc, request.bytes);
        respond({ id: request.id, kind: 'imported', brepBase64 });
        return;
      }
      case 'exportStep': {
        const oc = await ensureOcct();
        const shapes = collectShapes(request.bodyIds);
        if (shapes.length === 0) {
          respond({
            id: request.id,
            kind: 'error',
            error: { code: 'NO_BODY', message: 'No bodies to export' },
          });
          return;
        }
        const step = writeStepBytes(oc, shapes);
        respond(
          {
            id: request.id,
            kind: 'ok',
            result: { of: 'exportStep', step, fileName: 'nomadim-export.step' },
          },
          [step]
        );
        return;
      }
      case 'preview': {
        const oc = await ensureOcct();
        const meshes = previewOp(oc, request.planOp);
        const transfer = meshes.flatMap((m) => [
          m.positions.buffer,
          m.normals.buffer,
          m.indices.buffer,
        ]);
        respond({ id: request.id, kind: 'preview', meshes }, transfer);
        return;
      }
      case 'dispose': {
        // Live-map removal only — cached delta shapes stay owned by the cache.
        for (const bodyId of request.bodyIds) bodies.delete(bodyId);
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

function exportBodiesToStl(
  oc: OpenCascadeInstance,
  shapes: readonly TopoDS_Shape[],
  request: Extract<KernelRequest, { kind: 'exportStl' }>
): ArrayBuffer {
  const options = {
    format: request.format,
    linearDeflectionMm: request.linearDeflectionMm,
    angularDeflectionDeg: request.angularDeflectionDeg,
  };
  const first = shapes[0];
  if (shapes.length === 1 && first) {
    return exportShapeToStl(oc, first, options);
  }
  const compound = new oc.TopoDS_Compound();
  const builder = new oc.BRep_Builder();
  builder.MakeCompound(compound);
  for (const shape of shapes) builder.Add(compound, shape);
  const stl = exportShapeToStl(oc, compound, options);
  builder.delete();
  compound.delete();
  return stl;
}

// Serialize handlers; regen generation is bumped synchronously on arrival (R6).
let pending: Promise<void> = Promise.resolve();
self.onmessage = (event) => {
  const request = event.data;
  if (request.kind === 'regen') {
    latestGeneration = Math.max(latestGeneration, request.generation);
  }
  pending = pending.then(() => handleRequest(request));
};
