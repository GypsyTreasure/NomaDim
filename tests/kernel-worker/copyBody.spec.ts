import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import type { BodyId, ProfileId } from '../../src/core';
import type { CopyBodyOp, ExtrudeOp } from '../../src/document';
import type { PlanePlacement, PlanProfile } from '../../src/kernel/protocol';
import { executeExtrude } from '../../src/kernel-worker/executors/extrude';
import { executeCopyBody } from '../../src/kernel-worker/executors/copyBody';
import type { BodyStateMap, ExecCtx } from '../../src/kernel-worker/executors/types';
import { ShapeCache, diffDelta } from '../../src/kernel-worker/bodyState';
import { getLiveShapeCount } from '../../src/kernel-worker/handleCounter';

/**
 * M5 CopyBody golden (F9): the copy preserves the source volume and the
 * translation moves its centroid — the parametric+positional copy the timeline
 * replays. Real OCCT WASM in Node, handle counter to zero (R8).
 */

let oc: OpenCascadeInstance;
const XY: PlanePlacement = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] };
const bid = (id: string): BodyId => id as BodyId;

function box(id: string, size: number): PlanProfile {
  return {
    id: id as ProfileId,
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

function ctxFor(bodies: BodyStateMap, profiles: PlanProfile[]): ExecCtx {
  return { oc, bodies, profiles: new Map(profiles.map((p) => [p.id, p])) };
}

function volumeOf(shape: TopoDS_Shape): number {
  const g = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, g, false, false, false);
  const v = g.Mass();
  g.delete();
  return v;
}

function centroidX(shape: TopoDS_Shape): number {
  const g = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, g, false, false, false);
  const c = g.CentreOfMass();
  const x = c.X();
  c.delete();
  g.delete();
  return x;
}

beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

describe('copy body executor', () => {
  function makeAndCopy(translate: readonly [number, number, number]): {
    cache: ShapeCache;
    bodies: BodyStateMap;
  } {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();

    let before: BodyStateMap = new Map(bodies);
    const profile = box('p', 20);
    executeExtrude(ctxFor(bodies, [profile]), {
      type: 'Extrude',
      id: 'ex' as ExtrudeOp['id'],
      name: 'Extrude',
      suppressed: false,
      sketchId: 's1' as ExtrudeOp['sketchId'],
      profileIds: [profile.id],
      distanceMm: 20,
      direction: 'one-side',
      distance2Mm: 0,
      operation: 'NewBody',
      targetBodyId: null,
      wallThicknessMm: 0,
      asSurface: false,
      bodyId: bid('A'),
    });
    cache.record(0, diffDelta(before, bodies), { opId: 'o0' as never, status: 'ok' });

    before = new Map(bodies);
    const op: CopyBodyOp = {
      type: 'CopyBody',
      id: 'cp' as CopyBodyOp['id'],
      name: 'Copy',
      suppressed: false,
      rotate: [0, 0, 0],
      sourceBodyId: bid('A'),
      translate,
      bodyId: bid('C'),
    };
    executeCopyBody(ctxFor(bodies, []), op);
    cache.record(1, diffDelta(before, bodies), { opId: 'o1' as never, status: 'ok' });
    return { cache, bodies };
  }

  it('copies a body preserving its volume', () => {
    const { cache, bodies } = makeAndCopy([0, 0, 0]);
    const copy = bodies.get(bid('C'));
    expect(copy).toBeDefined();
    if (copy) expect(volumeOf(copy)).toBeCloseTo(8000, 3); // 20^3
    expect(bodies.has(bid('A'))).toBe(true); // source retained
    cache.freeFrom(0);
  });

  it('translates the copy (centroid shifts by the offset)', () => {
    const { cache, bodies } = makeAndCopy([50, 0, 0]);
    const source = bodies.get(bid('A'));
    const copy = bodies.get(bid('C'));
    if (source && copy) {
      expect(volumeOf(copy)).toBeCloseTo(8000, 3);
      expect(centroidX(copy) - centroidX(source)).toBeCloseTo(50, 3);
    }
    cache.freeFrom(0);
  });
});

afterAll(() => {
  expect(getLiveShapeCount()).toBe(0);
});
