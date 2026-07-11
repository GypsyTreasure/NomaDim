import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import { createId } from '../../src/core/ids';
import {
  VIEWPORT_ANGULAR_DEFLECTION_DEG,
  VIEWPORT_LINEAR_DEFLECTION_MM,
} from '../../src/core/units';
import { createHardcodedBox, disposeShape } from '../../src/kernel-worker/box';
import { getLiveShapeCount } from '../../src/kernel-worker/handleCounter';
import { tessellateShape } from '../../src/kernel-worker/tessellate';

/**
 * Kernel golden test (ARCHITECTURE §14): OCCT WASM in Node, no worker/DOM
 * involved. M1 has no op registry yet, so this exercises the hardcoded-box
 * fixture directly — `createHardcodedBox`/`tessellateShape` are pure
 * functions over an injected `OpenCascadeInstance`, reusable here exactly
 * as they run inside the real worker.
 */

let oc: OpenCascadeInstance;

beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

describe('hardcoded box (M1 fixture)', () => {
  it('has the expected volume within tolerance', () => {
    const baseline = getLiveShapeCount();
    const shape = createHardcodedBox(oc);

    const gprops = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, gprops, false, false, false);
    const volume = gprops.Mass();
    gprops.delete();

    expect(volume).toBeCloseTo(64000, 1); // 40mm cube

    disposeShape(shape);
    expect(getLiveShapeCount()).toBe(baseline);
  });

  it('tessellates into a mesh with correct face/triangle topology', () => {
    const shape = createHardcodedBox(oc);
    const bodyId = createId<'BodyId'>(new Set());

    const mesh = tessellateShape(oc, bodyId, shape, {
      linearDeflectionMm: VIEWPORT_LINEAR_DEFLECTION_MM,
      angularDeflectionDeg: VIEWPORT_ANGULAR_DEFLECTION_DEG,
    });

    // A box tessellates to 6 faces x 2 triangles x 3 indices.
    expect(mesh.indices.length).toBe(36);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.positions.length % 3).toBe(0);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.bodyId).toBe(bodyId);

    disposeShape(shape);
  });

  it('live-handle count returns to baseline after dispose (R8)', () => {
    const baseline = getLiveShapeCount();
    const shapes = [createHardcodedBox(oc), createHardcodedBox(oc), createHardcodedBox(oc)];

    expect(getLiveShapeCount()).toBe(baseline + 3);

    shapes.forEach(disposeShape);
    expect(getLiveShapeCount()).toBe(baseline);
  });
});

afterAll(() => {
  expect(getLiveShapeCount()).toBe(0);
});
