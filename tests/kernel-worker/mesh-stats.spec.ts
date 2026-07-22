import { beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import { shapeMeshStat } from '../../src/kernel-worker/meshStats';

/**
 * F6 STL export stats: triangle count + watertightness computed from the mesh.
 * A closed solid is watertight; a single open face is not. Watertight is a
 * mesh property, so it stays correct on healed-but-BRepCheck-invalid bodies.
 */

let oc: OpenCascadeInstance;
beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

const QUALITY = { linearDeflectionMm: 0.25, angularDeflectionDeg: 20 };

describe('shapeMeshStat', () => {
  it('a closed box is watertight with a positive triangle count', () => {
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const stat = shapeMeshStat(oc, box, QUALITY);
    expect(stat.triangleCount).toBeGreaterThan(0);
    expect(stat.watertight).toBe(true);
    box.delete();
  });

  it('a single open face is NOT watertight', () => {
    // One planar face (4 boundary edges used by a single triangle fan) — open.
    const p1 = new oc.gp_Pnt_3(0, 0, 0);
    const p2 = new oc.gp_Pnt_3(10, 0, 0);
    const p3 = new oc.gp_Pnt_3(10, 10, 0);
    const p4 = new oc.gp_Pnt_3(0, 10, 0);
    const poly = new oc.BRepBuilderAPI_MakePolygon_1();
    poly.Add_1(p1);
    poly.Add_1(p2);
    poly.Add_1(p3);
    poly.Add_1(p4);
    poly.Close();
    const wire = poly.Wire();
    const face = new oc.BRepBuilderAPI_MakeFace_15(wire, true).Face();
    const stat = shapeMeshStat(oc, face, QUALITY);
    expect(stat.triangleCount).toBeGreaterThan(0);
    expect(stat.watertight).toBe(false);
    face.delete();
    wire.delete();
    poly.delete();
    p1.delete();
    p2.delete();
    p3.delete();
    p4.delete();
  });
});
