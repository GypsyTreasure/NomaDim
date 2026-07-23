import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import type { BodyId } from '../../src/core';
import type { CopyBodyOp, MirrorOp, MoveOp, PatternOp } from '../../src/document';
import { executeCopyBody } from '../../src/kernel-worker/executors/copyBody';
import { executeMirror } from '../../src/kernel-worker/executors/mirror';
import { executePattern } from '../../src/kernel-worker/executors/pattern';
import { executeMove } from '../../src/kernel-worker/executors/move';
import { ShapeCache, diffDelta, snapshotRefs } from '../../src/kernel-worker/bodyState';
import { trackShapeAllocation, getLiveShapeCount } from '../../src/kernel-worker/handleCounter';
import type { BodyStateMap, ExecCtx } from '../../src/kernel-worker/executors/types';

/**
 * Transform ops (P1): Mirror, Pattern, and CopyBody rotation. Golden volume
 * checks against real OCCT; R8 handle count returns to zero. Boxes are placed
 * so instances don't overlap, making a Join volume the exact sum.
 */

let oc: OpenCascadeInstance;
beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

const bid = (id: string): BodyId => id as BodyId;

function ctx(bodies: BodyStateMap): ExecCtx {
  return { oc, bodies, profiles: new Map() };
}
function volumeOf(shape: TopoDS_Shape): number {
  const g = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, g, false, false, false);
  const v = g.Mass();
  g.delete();
  return v;
}
/** Volume of the body under `id`, asserting it exists (avoids non-null `!`). */
function volOf(bodies: BodyStateMap, id: string): number {
  const shape = bodies.get(bid(id));
  expect(shape).toBeDefined();
  return shape ? volumeOf(shape) : 0;
}
/** A 10³ box with its min corner at (x0,0,0), stored under `id`. */
function seedBox(bodies: BodyStateMap, id: string, x0: number): void {
  const corner = new oc.gp_Pnt_3(x0, 0, 0);
  const box = new oc.BRepPrimAPI_MakeBox_3(corner, 10, 10, 10).Shape();
  corner.delete();
  trackShapeAllocation();
  bodies.set(bid(id), box);
}
function record(
  cache: ShapeCache,
  i: number,
  before: ReadonlyMap<BodyId, TopoDS_Shape>,
  bodies: BodyStateMap
): void {
  cache.record(i, diffDelta(before, bodies), { opId: `o${String(i)}` as never, status: 'ok' });
}

describe('Mirror', () => {
  it('NewBody reflects the box (volume preserved) across YZ', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    seedBox(bodies, 'A', 5); // x ∈ [5,15]
    record(cache, 0, new Map(), bodies);

    const op: MirrorOp = {
      type: 'Mirror',
      id: 'm1' as MirrorOp['id'],
      name: 'Mirror',
      suppressed: false,
      sourceBodyId: bid('A'),
      plane: 'YZ',
      operation: 'NewBody',
      bodyId: bid('M'),
    };
    const before = snapshotRefs(bodies);
    executeMirror(ctx(bodies), op);
    record(cache, 1, before, bodies);

    expect(volOf(bodies, 'M')).toBeCloseTo(1000, 2);
    expect(bodies.has(bid('A'))).toBe(true); // source preserved
    cache.freeFrom(0);
  });

  it('Join fuses the reflection into the source (double volume, no overlap)', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    seedBox(bodies, 'A', 5); // x ∈ [5,15] → mirror to [-15,-5], disjoint
    record(cache, 0, new Map(), bodies);

    const op: MirrorOp = {
      type: 'Mirror',
      id: 'm1' as MirrorOp['id'],
      name: 'Mirror',
      suppressed: false,
      sourceBodyId: bid('A'),
      plane: 'YZ',
      operation: 'Join',
      bodyId: bid('unused'),
    };
    const before = snapshotRefs(bodies);
    executeMirror(ctx(bodies), op);
    record(cache, 1, before, bodies);

    expect(volOf(bodies, 'A')).toBeCloseTo(2000, 2);
    cache.freeFrom(0);
  });
});

describe('Pattern', () => {
  it('linear Join adds count-1 disjoint copies (triple volume)', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    seedBox(bodies, 'A', 0); // x ∈ [0,10]
    record(cache, 0, new Map(), bodies);

    const op: PatternOp = {
      type: 'Pattern',
      id: 'p1' as PatternOp['id'],
      name: 'Pattern',
      suppressed: false,
      sourceBodyId: bid('A'),
      kind: 'linear',
      count: 3,
      spacingMm: 20, // gaps → disjoint
      axis: 'X',
      angleDeg: 0,
      count2: 1,
      spacingMm2: 0,
      axis2: 'Y',
      count3: 1,
      spacingMm3: 0,
      axis3: 'Z',
      operation: 'Join',
      bodyId: bid('unused'),
    };
    const before = snapshotRefs(bodies);
    executePattern(ctx(bodies), op);
    record(cache, 1, before, bodies);

    expect(volOf(bodies, 'A')).toBeCloseTo(3000, 2);
    cache.freeFrom(0);
  });

  it('linear 2-axis grid Join fills a count×count2 box (#4)', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    seedBox(bodies, 'A', 0); // x ∈ [0,10]
    record(cache, 0, new Map(), bodies);

    const op: PatternOp = {
      type: 'Pattern',
      id: 'p2' as PatternOp['id'],
      name: 'Pattern',
      suppressed: false,
      sourceBodyId: bid('A'),
      kind: 'linear',
      count: 2,
      spacingMm: 20,
      axis: 'X',
      angleDeg: 0,
      count2: 2,
      spacingMm2: 20,
      axis2: 'Y',
      count3: 1,
      spacingMm3: 0,
      axis3: 'Z',
      operation: 'Join',
      bodyId: bid('unused'),
    };
    const before = snapshotRefs(bodies);
    executePattern(ctx(bodies), op);
    record(cache, 1, before, bodies);

    // 2×2 disjoint cells of a 10³ box → four boxes → 4000.
    expect(volOf(bodies, 'A')).toBeCloseTo(4000, 2);
    cache.freeFrom(0);
  });
});

describe('Move', () => {
  it('moves a body in place, preserving volume and its id, shifting position', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    seedBox(bodies, 'A', 0); // x ∈ [0,10]
    record(cache, 0, new Map(), bodies);

    const comX = (id: string): number => {
      const shape = bodies.get(bid(id));
      expect(shape).toBeDefined();
      if (!shape) return 0;
      const g = new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_1(shape, g, false, false, false);
      const x = g.CentreOfMass().X();
      g.delete();
      return x;
    };
    const beforeX = comX('A'); // 5

    const op: MoveOp = {
      type: 'Move',
      id: 'mv1' as MoveOp['id'],
      name: 'Move',
      suppressed: false,
      bodyId: bid('A'),
      translate: [50, 0, 0],
      rotate: [0, 0, 0],
    };
    const before = snapshotRefs(bodies);
    executeMove(ctx(bodies), op);
    record(cache, 1, before, bodies);

    expect(volOf(bodies, 'A')).toBeCloseTo(1000, 2); // rigid move preserves volume
    expect(comX('A')).toBeCloseTo(beforeX + 50, 2); // and shifts by the translation
    expect([...bodies.keys()]).toEqual([bid('A')]); // in place: no new body id
    cache.freeFrom(0);
  });
});

describe('CopyBody rotation', () => {
  it('rotates + copies preserving volume; source stays', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    seedBox(bodies, 'A', 0);
    record(cache, 0, new Map(), bodies);

    const op: CopyBodyOp = {
      type: 'CopyBody',
      id: 'c1' as CopyBodyOp['id'],
      name: 'Copy',
      suppressed: false,
      sourceBodyId: bid('A'),
      translate: [50, 0, 0],
      rotate: [0, 0, 45],
      bodyId: bid('C'),
    };
    const before = snapshotRefs(bodies);
    executeCopyBody(ctx(bodies), op);
    record(cache, 1, before, bodies);

    expect(volOf(bodies, 'C')).toBeCloseTo(1000, 2);
    expect(bodies.has(bid('A'))).toBe(true);
    cache.freeFrom(0);
  });
});

afterAll(() => {
  expect(getLiveShapeCount()).toBe(0);
});
