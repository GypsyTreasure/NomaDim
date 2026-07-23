import { beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import {
  brepBase64ToShape,
  readStepToBrepBase64,
  writeStepBytes,
} from '../../src/kernel-worker/stepio';

/**
 * STEP export (roadmap P1): the exported STEP re-imports to the same geometry —
 * a full export → import round-trip, verified by volume.
 */

let oc: OpenCascadeInstance;
beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

function volumeOf(shape: TopoDS_Shape): number {
  const g = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, g, false, false, false);
  const v = g.Mass();
  g.delete();
  return v;
}

describe('STEP export', () => {
  it('exports a solid whose STEP re-imports to the same volume', () => {
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const stepBytes = writeStepBytes(oc, [box]);
    box.delete();
    expect(stepBytes.byteLength).toBeGreaterThan(0);

    const brep = readStepToBrepBase64(oc, stepBytes);
    const reimported = brepBase64ToShape(oc, brep);
    expect(volumeOf(reimported)).toBeCloseTo(1000, 1);
    reimported.delete();
  });

  it('exports multiple bodies as one STEP (combined volume re-imports)', () => {
    const a = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const cornerB = new oc.gp_Pnt_3(20, 0, 0);
    const b = new oc.BRepPrimAPI_MakeBox_3(cornerB, 5, 5, 5).Shape();
    cornerB.delete();
    const stepBytes = writeStepBytes(oc, [a, b]);
    a.delete();
    b.delete();

    const reimported = brepBase64ToShape(oc, readStepToBrepBase64(oc, stepBytes));
    // 1000 (10³) + 125 (5³), disjoint → total volume preserved through STEP.
    expect(volumeOf(reimported)).toBeCloseTo(1125, 1);
    reimported.delete();
  });
});
