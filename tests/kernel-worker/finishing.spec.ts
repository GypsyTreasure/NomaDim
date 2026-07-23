import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import type { BodyId, ProfileId } from '../../src/core';
import type {
  ChamferOp,
  CombineOp,
  CombineOperation,
  EdgeFingerprint,
  ExtrudeOp,
  FilletOp,
} from '../../src/document';
import type { PlanePlacement, PlanProfile } from '../../src/kernel/protocol';
import { executeExtrude } from '../../src/kernel-worker/executors/extrude';
import { executeFillet } from '../../src/kernel-worker/executors/fillet';
import { executeChamfer } from '../../src/kernel-worker/executors/chamfer';
import { executeCombine } from '../../src/kernel-worker/executors/combine';
import { resolveEdges, tessellateBodyEdges } from '../../src/kernel-worker/edgeFingerprint';
import type { BodyStateMap, ExecCtx } from '../../src/kernel-worker/executors/types';
import { KernelExecError } from '../../src/kernel-worker/executors/types';
import { ShapeCache, diffDelta } from '../../src/kernel-worker/bodyState';
import { getLiveShapeCount } from '../../src/kernel-worker/handleCounter';

/**
 * M4 golden tests (ARCHITECTURE §14, §8): Fillet/Chamfer/Combine executors
 * plus the edge-fingerprint resolve-at-regen contract — the acceptance is
 * "a filleted part survives an upstream edit OR errors gracefully." A modest
 * dimensional change re-resolves the fingerprint; a large one (edge moved
 * out of tolerance / gone) raises a KernelExecError the regen loop turns into
 * the op's error state. Real OCCT WASM in Node, R8 handle counter to zero.
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

/** Extrudes a rectangle into a box, stored under `bodyId`. */
function makeBox(bodies: BodyStateMap, bodyId: string, size: number, height: number): void {
  const profile = rectProfile(`p-${bodyId}`, 0, 0, size, size);
  const op: ExtrudeOp = {
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
    wallThicknessMm: 0,
    bodyId: bid(bodyId),
  };
  executeExtrude(ctxFor(bodies, [profile]), op);
}

/** Frees a body map through a single delta (R8) — for maps with no in-place replacements. */
function freeBodies(bodies: BodyStateMap): void {
  const cache = new ShapeCache();
  cache.record(0, diffDelta(new Map(), bodies), { opId: 'x' as never, status: 'ok' });
  cache.freeFrom(0);
}

/** Records op i's delta (the shapes changed since `before`) into `cache`. */
function record(cache: ShapeCache, i: number, before: BodyStateMap, bodies: BodyStateMap): void {
  cache.record(i, diffDelta(before, bodies), { opId: `o${String(i)}` as never, status: 'ok' });
}

/** The fingerprint of a top edge running along X (max midpoint Z, direction ≈ X). */
function topXEdgeFingerprint(shape: TopoDS_Shape): EdgeFingerprint {
  const edges = tessellateBodyEdges(oc, shape);
  let best: EdgeFingerprint | null = null;
  for (const edge of edges) {
    const fp = edge.fingerprint;
    if (Math.abs(fp.direction[0]) < 0.99) continue; // want an X-running edge
    if (!best || fp.midpoint[2] > best.midpoint[2]) best = fp;
  }
  if (!best) throw new Error('no X-running top edge found');
  return best;
}

beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

describe('fillet + chamfer executors', () => {
  it('fillet rounds an edge, reducing the box volume', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    let before: BodyStateMap = new Map(bodies);
    makeBox(bodies, 'B', 20, 20);
    record(cache, 0, before, bodies);

    const box = bodies.get(bid('B'));
    expect(box).toBeDefined();
    if (!box) return;
    const boxVolume = volumeOf(box);

    const op: FilletOp = {
      type: 'Fillet',
      id: 'f1' as FilletOp['id'],
      name: 'Fillet',
      suppressed: false,
      bodyId: bid('B'),
      edges: [topXEdgeFingerprint(box)],
      radiusMm: 3,
    };
    before = new Map(bodies);
    executeFillet(ctxFor(bodies, []), op);
    record(cache, 1, before, bodies);

    const filleted = bodies.get(bid('B'));
    if (filleted) {
      const v = volumeOf(filleted);
      expect(v).toBeLessThan(boxVolume);
      expect(v).toBeGreaterThan(boxVolume * 0.9); // only a corner removed
    }
    cache.freeFrom(0);
  });

  it('chamfer bevels an edge, reducing the box volume', () => {
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    let before: BodyStateMap = new Map(bodies);
    makeBox(bodies, 'B', 20, 20);
    record(cache, 0, before, bodies);

    const box = bodies.get(bid('B'));
    if (!box) return;
    const boxVolume = volumeOf(box);

    const op: ChamferOp = {
      type: 'Chamfer',
      id: 'c1' as ChamferOp['id'],
      name: 'Chamfer',
      suppressed: false,
      bodyId: bid('B'),
      edges: [topXEdgeFingerprint(box)],
      distanceMm: 3,
    };
    before = new Map(bodies);
    executeChamfer(ctxFor(bodies, []), op);
    record(cache, 1, before, bodies);

    const chamfered = bodies.get(bid('B'));
    if (chamfered) expect(volumeOf(chamfered)).toBeLessThan(boxVolume);
    cache.freeFrom(0);
  });
});

describe('edge fingerprint resolve-at-regen (acceptance)', () => {
  it('re-resolves after a modest upstream edit (survives)', () => {
    const original: BodyStateMap = new Map();
    makeBox(original, 'B', 20, 20);
    const box = original.get(bid('B'));
    if (!box) return;
    const fingerprint = topXEdgeFingerprint(box);
    freeBodies(original);

    // Upstream edit: box grows 20 → 22 tall; the top edge moves 2 mm ≤ tol.
    const edited: BodyStateMap = new Map();
    makeBox(edited, 'B', 20, 22);
    const editedBox = edited.get(bid('B'));
    if (!editedBox) return;
    const resolved = resolveEdges(oc, editedBox, [fingerprint]);
    expect(resolved).toHaveLength(1);
    for (const e of resolved) e.delete();
    freeBodies(edited);
  });

  it('will not resolve two fingerprints onto the same live edge', () => {
    // Two identical fingerprints must not both claim the one nearest edge
    // (that would silently drop one and double-add the other to the maker).
    // Greedy claiming takes it once; the second finds no unused edge in
    // tolerance (the other top-X edge is 20 mm away) and errors.
    const bodies: BodyStateMap = new Map();
    makeBox(bodies, 'B', 20, 20);
    const box = bodies.get(bid('B'));
    if (!box) return;
    const fp = topXEdgeFingerprint(box);
    expect(() => resolveEdges(oc, box, [fp, fp])).toThrow(KernelExecError);
    // A single copy still resolves fine.
    const one = resolveEdges(oc, box, [fp]);
    expect(one).toHaveLength(1);
    for (const e of one) e.delete();
    freeBodies(bodies);
  });

  it('errors gracefully when the edge moves out of tolerance', () => {
    const original: BodyStateMap = new Map();
    makeBox(original, 'B', 20, 20);
    const box = original.get(bid('B'));
    if (!box) return;
    const fingerprint = topXEdgeFingerprint(box);
    freeBodies(original);

    // Large edit: box grows 20 → 60 tall; the top edge moves 40 mm > tol.
    const edited: BodyStateMap = new Map();
    makeBox(edited, 'B', 20, 60);
    const editedBox = edited.get(bid('B'));
    if (!editedBox) return;
    expect(() => resolveEdges(oc, editedBox, [fingerprint])).toThrow(KernelExecError);
    freeBodies(edited);
  });

  it('a fillet op re-applies after a surviving edit', () => {
    // Pick on the original, then fillet the EDITED body via the same fingerprint.
    const probe: BodyStateMap = new Map();
    makeBox(probe, 'B', 20, 20);
    const probeBox = probe.get(bid('B'));
    if (!probeBox) return;
    const fingerprint = topXEdgeFingerprint(probeBox);
    freeBodies(probe);

    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    let before: BodyStateMap = new Map(bodies);
    makeBox(bodies, 'B', 20, 21);
    record(cache, 0, before, bodies);

    const editedBox = bodies.get(bid('B'));
    if (!editedBox) return;
    const boxVolume = volumeOf(editedBox);

    const op: FilletOp = {
      type: 'Fillet',
      id: 'f1' as FilletOp['id'],
      name: 'Fillet',
      suppressed: false,
      bodyId: bid('B'),
      edges: [fingerprint],
      radiusMm: 2,
    };
    before = new Map(bodies);
    executeFillet(ctxFor(bodies, []), op);
    record(cache, 1, before, bodies);

    const filleted = bodies.get(bid('B'));
    if (filleted) expect(volumeOf(filleted)).toBeLessThan(boxVolume);
    cache.freeFrom(0);
  });
});

describe('combine executor (F5)', () => {
  // A = 20x20x10 (4000); B = 10x10x20 footprint inside A.
  function setup(): BodyStateMap {
    const bodies: BodyStateMap = new Map();
    makeBox(bodies, 'A', 20, 10);
    makeBox(bodies, 'B', 10, 20);
    return bodies;
  }

  function combineOp(operation: CombineOperation, keepTools: boolean): CombineOp {
    return {
      type: 'Combine',
      id: 'cb1' as CombineOp['id'],
      name: 'Combine',
      suppressed: false,
      targetBodyId: bid('A'),
      toolBodyIds: [bid('B')],
      operation,
      keepTools,
    };
  }

  function run(operation: CombineOperation, expected: number, keepTools = false): void {
    const bodies = setup();
    const cache = new ShapeCache();
    cache.record(0, diffDelta(new Map(), bodies), { opId: 'seed' as never, status: 'ok' });

    const before = new Map(bodies);
    executeCombine(ctxFor(bodies, []), combineOp(operation, keepTools));
    cache.record(1, diffDelta(before, bodies), { opId: 'cb' as never, status: 'ok' });

    const a = bodies.get(bid('A'));
    expect(a).toBeDefined();
    if (a) expect(volumeOf(a)).toBeCloseTo(expected, 2);
    expect(bodies.has(bid('B'))).toBe(keepTools);
    cache.freeFrom(0);
  }

  it('Join fuses tool into target (5000)', () => {
    run('Join', 5000);
  });
  it('Cut removes tool from target (3000)', () => {
    run('Cut', 3000);
  });
  it('Intersect keeps the overlap (1000)', () => {
    run('Intersect', 1000);
  });
  it('Keep Tools leaves the tool body in the map', () => {
    run('Join', 5000, true);
  });
});

afterAll(() => {
  expect(getLiveShapeCount()).toBe(0);
});
