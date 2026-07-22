import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import type { BodyId, ProfileId } from '../../src/core';
import { VIEWPORT_ANGULAR_DEFLECTION_DEG, VIEWPORT_LINEAR_DEFLECTION_MM } from '../../src/core';
import type { ExtrudeOp } from '../../src/document';
import type { PlanePlacement, PlanProfile } from '../../src/kernel/protocol';
import { executeExtrude } from '../../src/kernel-worker/executors/extrude';
import { tessellateShape } from '../../src/kernel-worker/tessellate';
import { ShapeCache, diffDelta, snapshotRefs } from '../../src/kernel-worker/bodyState';
import { getLiveShapeCount, trackShapeDisposal } from '../../src/kernel-worker/handleCounter';
import type { BodyStateMap, ExecCtx } from '../../src/kernel-worker/executors/types';

/**
 * F3 live ghost preview handle safety: a preview runs an op against a COPY of
 * the live body map and frees every shape it creates, so the R8 live-handle
 * count is unchanged afterward. This mirrors the worker's `previewOp` (which
 * can't be imported standalone — it closes over the module body map).
 */

let oc: OpenCascadeInstance;
beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

const XY: PlanePlacement = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] };
const bid = (id: string): BodyId => id as BodyId;
const pid = (id: string): ProfileId => id as ProfileId;

function rectProfile(id: string, size: number): PlanProfile {
  return {
    id: pid(id),
    plane: XY,
    outer: [
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: size, y: 0 } },
      { kind: 'line', a: { x: size, y: 0 }, b: { x: size, y: size } },
      { kind: 'line', a: { x: size, y: size }, b: { x: 0, y: size } },
      { kind: 'line', a: { x: 0, y: size }, b: { x: 0, y: 0 } },
    ],
    inner: [],
  };
}

function extrudeOp(bodyId: string, height: number): { op: ExtrudeOp; profile: PlanProfile } {
  const profile = rectProfile(`p-${bodyId}`, 20);
  return {
    profile,
    op: {
      type: 'Extrude',
      id: `ex-${bodyId}` as ExtrudeOp['id'],
      name: 'Extrude',
      suppressed: false,
      sketchId: 's1' as ExtrudeOp['sketchId'],
      profileIds: [profile.id],
      distanceMm: height,
      direction: 'one-side',
      distance2Mm: 0,
      operation: 'NewBody',
      targetBodyId: null,
      bodyId: bid(bodyId),
    },
  };
}

function ctxFor(bodies: BodyStateMap, profiles: PlanProfile[]): ExecCtx {
  return { oc, bodies, profiles: new Map(profiles.map((p) => [p.id, p])) };
}

describe('preview handle safety', () => {
  it('previewing a new extrude leaves the live-handle count unchanged', () => {
    // Seed one real body owned by the cache.
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    const seed = extrudeOp('B', 10);
    executeExtrude(ctxFor(bodies, [seed.profile]), seed.op);
    cache.record(0, diffDelta(new Map(), bodies), { opId: 'seed' as never, status: 'ok' });

    const baseline = getLiveShapeCount();

    // Preview a *second* new extrude against a throwaway copy (as previewOp does).
    const draft = extrudeOp('preview-body', 15);
    const previewBodies: BodyStateMap = new Map(bodies);
    const before = snapshotRefs(previewBodies);
    executeExtrude(ctxFor(previewBodies, [draft.profile]), draft.op);
    const changed = diffDelta(before, previewBodies).changed;
    // Tessellate the changed bodies (the preview result the UI would render).
    let triangleCount = 0;
    for (const [id, shape] of changed) {
      const mesh = tessellateShape(oc, id, shape, {
        linearDeflectionMm: VIEWPORT_LINEAR_DEFLECTION_MM,
        angularDeflectionDeg: VIEWPORT_ANGULAR_DEFLECTION_DEG,
      });
      triangleCount += mesh.indices.length / 3;
    }
    for (const shape of changed.values()) {
      shape.delete();
      trackShapeDisposal();
    }

    expect(triangleCount).toBeGreaterThan(0); // a real ghost was produced
    expect(getLiveShapeCount()).toBe(baseline); // …and fully cleaned up

    cache.freeFrom(0);
  });
});

afterAll(() => {
  expect(getLiveShapeCount()).toBe(0);
});
