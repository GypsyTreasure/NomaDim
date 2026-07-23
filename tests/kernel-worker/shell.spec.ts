import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import type { BodyId } from '../../src/core';
import type { ShellOp } from '../../src/document';
import { executeShell } from '../../src/kernel-worker/executors/shell';
import { ShapeCache, diffDelta, snapshotRefs } from '../../src/kernel-worker/bodyState';
import { trackShapeAllocation, getLiveShapeCount } from '../../src/kernel-worker/handleCounter';
import type { BodyStateMap, ExecCtx } from '../../src/kernel-worker/executors/types';

/**
 * Shell (P2, ADR-0064): hollows a 20³ box to a 2mm wall with
 * `BRepOffsetAPI_MakeThickSolid`. Golden volume checks against real OCCT — a
 * closed shell keeps a 2mm skin on all six faces, an open-top shell removes
 * the +Z skin so the cavity reaches the top surface. R8 handle count returns
 * to zero after the cache is freed.
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
function volOf(bodies: BodyStateMap, id: string): number {
  const shape = bodies.get(bid(id));
  expect(shape).toBeDefined();
  return shape ? volumeOf(shape) : 0;
}
/** A 20³ box with its min corner at the origin, stored under `id`. */
function seedBox(bodies: BodyStateMap, id: string): void {
  const corner = new oc.gp_Pnt_3(0, 0, 0);
  const box = new oc.BRepPrimAPI_MakeBox_3(corner, 20, 20, 20).Shape();
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
function shellOp(id: string, thicknessMm: number, openFace: ShellOp['openFace']): ShellOp {
  return {
    type: 'Shell',
    id: `s-${id}` as ShellOp['id'],
    name: 'Shell',
    suppressed: false,
    bodyId: bid(id),
    thicknessMm,
    openFace,
  };
}

describe('Shell', () => {
  it('closed shell keeps a 2mm skin on all faces (20³ − 16³ cavity)', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    seedBox(bodies, 'A');
    record(cache, 0, new Map(), bodies);

    const before = snapshotRefs(bodies);
    executeShell(ctx(bodies), shellOp('A', 2, 'none'));
    record(cache, 1, before, bodies);

    // 20³ outer − 16³ inner void = 8000 − 4096 = 3904.
    expect(volOf(bodies, 'A')).toBeCloseTo(3904, 1);
    cache.freeFrom(0);
  });

  it('open-top shell drops the +Z skin (cavity reaches the top)', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    seedBox(bodies, 'A');
    record(cache, 0, new Map(), bodies);

    const before = snapshotRefs(bodies);
    executeShell(ctx(bodies), shellOp('A', 2, 'top'));
    record(cache, 1, before, bodies);

    // Cavity is 16×16×18 (walls on ±X, ±Y, −Z only): 8000 − 4608 = 3392.
    expect(volOf(bodies, 'A')).toBeCloseTo(3392, 1);
    cache.freeFrom(0);
  });

  it('rejects a wall thicker than the body can hold', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    seedBox(bodies, 'A');
    record(cache, 0, new Map(), bodies);

    // 15mm walls on both sides (30mm) cannot fit in a 20mm box → collapse.
    expect(() => {
      executeShell(ctx(bodies), shellOp('A', 15, 'none'));
    }).toThrow();
    cache.freeFrom(0);
  });
});

afterAll(() => {
  expect(getLiveShapeCount()).toBe(0);
});
