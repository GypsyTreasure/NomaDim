import { beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import type { BodyId, ProfileId } from '../../src/core';
import type { ExtrudeOp } from '../../src/document';
import type { PlanProfile } from '../../src/kernel/protocol';
import { executeExtrude } from '../../src/kernel-worker/executors/extrude';
import type { BodyStateMap, ExecCtx } from '../../src/kernel-worker/executors/types';
import { resolveSketchFace } from '../../src/kernel-worker/faceResolve';
import { ShapeCache, diffDelta } from '../../src/kernel-worker/bodyState';
import { getLiveShapeCount } from '../../src/kernel-worker/handleCounter';

/**
 * Sketch-on-face worker resolution (F2 #1b): resolving the planar face under a
 * picked world point on a box gives the face's plane — outward normal,
 * on-face origin, orthonormal (u,v) — and a fingerprint (centroid/normal/area)
 * for future regen re-resolution. Non-flat picks return null. Real OCCT WASM.
 */

let oc: OpenCascadeInstance;
const bid = (id: string): BodyId => id as BodyId;
const pid = (id: string): ProfileId => id as ProfileId;

function rectProfile(id: string, x1: number, y1: number): PlanProfile {
  return {
    id: pid(id),
    plane: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
    outer: [
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: x1, y: 0 } },
      { kind: 'line', a: { x: x1, y: 0 }, b: { x: x1, y: y1 } },
      { kind: 'line', a: { x: x1, y: y1 }, b: { x: 0, y: y1 } },
      { kind: 'line', a: { x: 0, y: y1 }, b: { x: 0, y: 0 } },
    ],
    inner: [],
  };
}

/** A 20×20×10 box under bodyId 'B'. */
function makeBox(bodies: BodyStateMap): void {
  const profile = rectProfile('p', 20, 20);
  const op: ExtrudeOp = {
    type: 'Extrude',
    id: 'ex' as ExtrudeOp['id'],
    name: 'Extrude',
    suppressed: false,
    sketchId: 's1' as ExtrudeOp['sketchId'],
    profileIds: [profile.id],
    distanceMm: 10,
    direction: 'one-side',
    distance2Mm: 0,
    operation: 'NewBody',
    targetBodyId: null,
    wallThicknessMm: 0,
    asSurface: false,
    bodyId: bid('B'),
  };
  const ctx: ExecCtx = { oc, bodies, profiles: new Map([[profile.id, profile]]) };
  executeExtrude(ctx, op);
}

function freeBodies(bodies: BodyStateMap): void {
  const cache = new ShapeCache();
  cache.record(0, diffDelta(new Map(), bodies), { opId: 'x' as never, status: 'ok' });
  cache.freeFrom(0);
}

const dot = (a: readonly number[], b: readonly number[]): number =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);

beforeAll(async () => {
  oc = await initOpenCascade();
});

describe('resolveSketchFace', () => {
  it('resolves the top face (normal +Z, origin on the face, orthonormal basis)', () => {
    const bodies: BodyStateMap = new Map();
    makeBox(bodies);
    const box = bodies.get(bid('B'));
    expect(box).toBeDefined();
    if (!box) return;

    const face = resolveSketchFace(oc, box, [10, 10, 10]);
    expect(face).not.toBeNull();
    if (face) {
      expect(face.normal[2]).toBeCloseTo(1, 5); // outward +Z
      expect(Math.abs(face.normal[0])).toBeLessThan(1e-6);
      expect(face.origin[2]).toBeCloseTo(10, 5); // on the top face
      // Orthonormal in-plane axes.
      expect(Math.hypot(...face.xAxis)).toBeCloseTo(1, 6);
      expect(dot(face.normal, face.xAxis)).toBeCloseTo(0, 6);
      expect(dot(face.xAxis, face.yAxis)).toBeCloseTo(0, 6);
      // Fingerprint: the top face is 20×20 = 400 mm².
      expect(face.fingerprint.areaMm2).toBeCloseTo(400, 2);
    }
    freeBodies(bodies);
  });

  it('resolves a side face with an axis-aligned normal', () => {
    const bodies: BodyStateMap = new Map();
    makeBox(bodies);
    const box = bodies.get(bid('B'));
    if (!box) return;
    const face = resolveSketchFace(oc, box, [20, 10, 5]); // the x = 20 face
    expect(face).not.toBeNull();
    if (face) {
      expect(Math.abs(face.normal[0])).toBeCloseTo(1, 5); // ±X
      expect(Math.abs(face.normal[2])).toBeLessThan(1e-6);
      expect(face.origin[0]).toBeCloseTo(20, 5);
      expect(face.fingerprint.areaMm2).toBeCloseTo(200, 2); // 20 × 10
    }
    freeBodies(bodies);
  });

  it('frees every OCCT handle (R8)', () => {
    expect(getLiveShapeCount()).toBe(0);
  });
});
