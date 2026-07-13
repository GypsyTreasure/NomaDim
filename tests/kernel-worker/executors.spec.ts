import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import type { BodyId, ProfileId } from '../../src/core';
import type { ExtrudeOp, RevolveOp } from '../../src/document';
import type { PlanePlacement, PlanProfile, WorldAxis } from '../../src/kernel/protocol';
import { executeExtrude } from '../../src/kernel-worker/executors/extrude';
import { executeRevolve } from '../../src/kernel-worker/executors/revolve';
import type { BodyStateMap, ExecCtx } from '../../src/kernel-worker/executors/types';
import { ShapeCache, diffDelta, snapshotRefs } from '../../src/kernel-worker/bodyState';
import { getLiveShapeCount } from '../../src/kernel-worker/handleCounter';

/**
 * M3 kernel golden tests (ARCHITECTURE §14, §9): the Extrude/Revolve
 * executors and the delta cache run against real OCCT WASM in Node — the
 * same pure functions the worker calls. Volumes are the correctness proof
 * (plate-with-hole = outer − hole; all four booleans); the handle counter
 * proves R8 (every shape freed on invalidation).
 */

let oc: OpenCascadeInstance;

const XY: PlanePlacement = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] };
const pid = (id: string): ProfileId => id as ProfileId;
const bid = (id: string): BodyId => id as BodyId;

function rectProfile(id: string, x0: number, y0: number, x1: number, y1: number): PlanProfile {
  return {
    id: pid(id),
    plane: XY,
    outer: [
      { kind: 'line', a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
      { kind: 'line', a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
      { kind: 'line', a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
      { kind: 'line', a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
    ],
    inner: [],
  };
}

function plateWithHole(id: string): PlanProfile {
  return {
    ...rectProfile(id, 0, 0, 40, 40),
    inner: [[{ kind: 'circle', center: { x: 20, y: 20 }, r: 5 }]],
  };
}

function extrude(overrides: Partial<ExtrudeOp>): ExtrudeOp {
  return {
    type: 'Extrude',
    id: 'op' as ExtrudeOp['id'],
    name: 'Extrude',
    suppressed: false,
    sketchId: 's1' as ExtrudeOp['sketchId'],
    profileIds: [],
    distanceMm: 10,
    direction: 'one-side',
    distance2Mm: 0,
    operation: 'NewBody',
    targetBodyId: null,
    bodyId: bid('B'),
    ...overrides,
  };
}

function ctxFor(bodies: BodyStateMap, profiles: PlanProfile[]): ExecCtx {
  return { oc, bodies, profiles: new Map(profiles.map((p) => [p.id, p])) };
}

function volumeOf(shape: TopoDS_Shape): number {
  const gprops = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, gprops, false, false, false);
  const volume = gprops.Mass();
  gprops.delete();
  return volume;
}

/** Frees a body map through the delta cache (R8 — every shape .delete()d). */
function freeBodies(bodies: BodyStateMap): void {
  const cache = new ShapeCache();
  cache.record(0, diffDelta(new Map(), bodies), { opId: 'x' as never, status: 'ok' });
  cache.freeFrom(0);
}

beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

describe('extrude executor', () => {
  it('extrudes a rectangle into a box of the expected volume', () => {
    const bodies: BodyStateMap = new Map();
    const profile = rectProfile('p', 0, 0, 20, 10);
    executeExtrude(ctxFor(bodies, [profile]), extrude({ profileIds: [profile.id], distanceMm: 5 }));

    const shape = bodies.get(bid('B'));
    expect(shape).toBeDefined();
    if (shape) expect(volumeOf(shape)).toBeCloseTo(1000, 3); // 20*10*5
    freeBodies(bodies);
  });

  it('extrudes a plate with a hole as outer minus inner', () => {
    const bodies: BodyStateMap = new Map();
    const profile = plateWithHole('p');
    executeExtrude(ctxFor(bodies, [profile]), extrude({ profileIds: [profile.id], distanceMm: 2 }));

    const shape = bodies.get(bid('B'));
    expect(shape).toBeDefined();
    // (40*40 - pi*5^2) * 2
    if (shape) expect(volumeOf(shape)).toBeCloseTo((1600 - Math.PI * 25) * 2, 1);
    freeBodies(bodies);
  });

  it('symmetric direction straddles the plane (same total volume)', () => {
    const bodies: BodyStateMap = new Map();
    const profile = rectProfile('p', 0, 0, 10, 10);
    executeExtrude(
      ctxFor(bodies, [profile]),
      extrude({ profileIds: [profile.id], distanceMm: 6, direction: 'symmetric' })
    );
    const shape = bodies.get(bid('B'));
    if (shape) expect(volumeOf(shape)).toBeCloseTo(600, 3); // 10*10*6
    freeBodies(bodies);
  });
});

describe('boolean operations (all four)', () => {
  // A = 20x20 x10 = 4000 at z 0..10; B = 10x10 x20 at z 0..20, footprint inside A.
  const profA = rectProfile('a', 0, 0, 20, 20);
  const profB = rectProfile('b', 0, 0, 10, 10);
  const okStatus = { opId: 'o' as never, status: 'ok' as const };

  /**
   * Runs op0 (NewBody A) then op1 (boolean B → A) through a delta cache, so
   * the superseded target shape stays owned by op0's delta exactly as in the
   * worker — freeFrom(0) then reclaims BOTH shapes (no test-only leak).
   */
  function runSequence(operation: ExtrudeOp['operation'] | null): {
    cache: ShapeCache;
    bodies: BodyStateMap;
  } {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();

    let before = snapshotRefs(bodies);
    executeExtrude(
      ctxFor(bodies, [profA]),
      extrude({ profileIds: [profA.id], distanceMm: 10, bodyId: bid('A') })
    );
    cache.record(0, diffDelta(before, bodies), okStatus);

    if (operation) {
      before = snapshotRefs(bodies);
      executeExtrude(
        ctxFor(bodies, [profB]),
        extrude({
          profileIds: [profB.id],
          distanceMm: 20,
          operation,
          targetBodyId: bid('A'),
          bodyId: bid('B'),
        })
      );
      cache.record(1, diffDelta(before, bodies), okStatus);
    }
    return { cache, bodies };
  }

  function checkVolume(operation: ExtrudeOp['operation'] | null, expected: number): void {
    const { cache, bodies } = runSequence(operation);
    const a = bodies.get(bid('A'));
    expect(a).toBeDefined();
    if (a) expect(volumeOf(a)).toBeCloseTo(expected, 2);
    cache.freeFrom(0);
  }

  it('NewBody creates an independent solid (4000)', () => {
    checkVolume(null, 4000);
  });

  it('Join fuses target and tool (5000)', () => {
    checkVolume('Join', 5000);
  });

  it('Cut removes the tool from the target (3000)', () => {
    checkVolume('Cut', 3000);
  });

  it('Intersect keeps only the overlap (1000)', () => {
    checkVolume('Intersect', 1000);
  });
});

describe('revolve executor', () => {
  it('revolves a rectangle 360° into a washer of the expected volume', () => {
    const bodies: BodyStateMap = new Map();
    // Rect x:[10,15], y:[0,4] revolved about world Y → Ri=10, Ro=15, h=4.
    const profile = rectProfile('r', 10, 0, 15, 4);
    const axis: WorldAxis = { origin: [0, 0, 0], direction: [0, 1, 0] };
    const op: RevolveOp = {
      type: 'Revolve',
      id: 'op' as RevolveOp['id'],
      name: 'Revolve',
      suppressed: false,
      sketchId: 's1' as RevolveOp['sketchId'],
      profileIds: [profile.id],
      axis: { kind: 'origin', axis: 'Y' },
      angleDeg: 360,
      operation: 'NewBody',
      targetBodyId: null,
      bodyId: bid('R'),
    };
    executeRevolve(ctxFor(bodies, [profile]), op, axis);

    const shape = bodies.get(bid('R'));
    expect(shape).toBeDefined();
    if (shape) expect(volumeOf(shape)).toBeCloseTo(Math.PI * (225 - 100) * 4, 0);
    freeBodies(bodies);
  });
});

describe('delta cache (ARCHITECTURE §9, R8)', () => {
  it('restores the map from folded deltas and frees every shape on invalidation', () => {
    const baseline = getLiveShapeCount();

    // Two ops: op0 makes body A, op1 replaces A with a bigger box.
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();

    const p0 = rectProfile('c0', 0, 0, 10, 10);
    let before = snapshotRefs(bodies);
    executeExtrude(
      ctxFor(bodies, [p0]),
      extrude({ profileIds: [p0.id], distanceMm: 1, bodyId: bid('A') })
    );
    cache.record(0, diffDelta(before, bodies), { opId: 'o0' as never, status: 'ok' });
    const firstA = bodies.get(bid('A'));

    const p1 = rectProfile('c1', 0, 0, 10, 10);
    before = snapshotRefs(bodies);
    executeExtrude(
      ctxFor(bodies, [p1]),
      extrude({ profileIds: [p1.id], distanceMm: 2, bodyId: bid('A') })
    );
    cache.record(1, diffDelta(before, bodies), { opId: 'o1' as never, status: 'ok' });

    // restoreTo(1) yields the state after op0 only (the smaller box).
    expect(cache.restoreTo(1).get(bid('A'))).toBe(firstA);
    // restoreTo(2) yields the post-op1 (bigger) box.
    const bigA = cache.restoreTo(2).get(bid('A'));
    if (bigA) expect(volumeOf(bigA)).toBeCloseTo(200, 3);

    cache.freeFrom(0);
    expect(getLiveShapeCount()).toBe(baseline);
  });
});

afterAll(() => {
  expect(getLiveShapeCount()).toBe(0);
});
