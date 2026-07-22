import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import { documentFromXml, OP_DEFINITIONS } from '../../src/document';
import { buildRegenPlan } from '../../src/services/regenPlan';
import { OP_EXECUTORS } from '../../src/kernel-worker/executors/registry';
import { healInvalidSolid } from '../../src/kernel-worker/healShape';
import {
  trackShapeAllocation,
  trackShapeDisposal,
  getLiveShapeCount,
} from '../../src/kernel-worker/handleCounter';
import { ShapeCache, diffDelta, snapshotRefs } from '../../src/kernel-worker/bodyState';
import { KernelExecError, type BodyStateMap } from '../../src/kernel-worker/executors/types';

/**
 * Regression for a real user model (tests/fixtures/chained-fillet-chamfer.xml):
 * stacked fillets/chamfers where (a) one finishing op produces a face BRepMesh
 * can't triangulate — a see-through hole in the mesh AND the STL — and (b) a
 * chamfer whose distance is too large fails. Guards two fixes:
 *   1. healInvalidSolid repairs the invalid face → every face triangulates.
 *   2. A failed op no longer cascade-skips the rest of the timeline — the fillet
 *      after the failing chamfer still applies.
 */

let oc: OpenCascadeInstance;
beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

/** Meshes the shape and counts faces with no triangulation (mesh/STL holes). */
function nullFaceCount(shape: TopoDS_Shape): number {
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.25, false, (20 * Math.PI) / 180, false);
  const exp = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  let nulls = 0;
  while (exp.More()) {
    const face = oc.TopoDS.Face_1(exp.Current());
    const loc = new oc.TopLoc_Location_1();
    const tri = (
      oc.BRep_Tool.Triangulation as never as (
        a: unknown,
        b: unknown,
        c: number
      ) => { IsNull(): boolean; delete(): void }
    )(face, loc, 0);
    if (tri.IsNull()) nulls += 1;
    tri.delete();
    loc.delete();
    exp.Next();
  }
  exp.delete();
  return nulls;
}

describe('chained fillet/chamfer regression', () => {
  it('every op runs past a failing chamfer and the body has no un-meshed face', () => {
    const xml = readFileSync('tests/fixtures/chained-fillet-chamfer.xml', 'utf8');
    const res = documentFromXml(xml);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const plan = buildRegenPlan(res.value);
    const bodies: BodyStateMap = new Map();
    const cache = new ShapeCache();
    const statuses: string[] = [];

    // Mirror the worker regen loop (post-fix: no cascade skip). Every produced
    // shape is captured by a delta so freeFrom(0) frees them all (R8).
    for (let i = 0; i < plan.ops.length; i += 1) {
      const planOp = plan.ops[i];
      if (!planOp) continue;
      const op = planOp.op;
      const deps = OP_DEFINITIONS[op.type].dependencies(op);
      if (planOp.inputsSuppressed || deps.consumesBodies.some((b) => !bodies.has(b))) {
        statuses.push(`${op.name}:skipped`);
        continue;
      }
      const before = snapshotRefs(bodies);
      try {
        OP_EXECUTORS[op.type](
          { oc, bodies, profiles: new Map(planOp.profiles.map((p) => [p.id, p])) },
          planOp
        );
        cache.record(i, diffDelta(before, bodies), { opId: op.id, status: 'ok' });
        statuses.push(`${op.name}:ok`);
      } catch (error) {
        cache.record(i, diffDelta(before, bodies), { opId: op.id, status: 'error' });
        statuses.push(`${op.name}:${error instanceof KernelExecError ? error.code : 'err'}`);
      }
    }

    // Chamfer1's 2 mm distance is too large for that spot → it errors — but the
    // fillet after it still applies (no cascade skip).
    expect(statuses).toContain('Chamfer1:CHAMFER_FAILED');
    expect(statuses).toContain('Fillet3:ok');

    // The healed body meshes with zero un-triangulated faces (no see-through
    // hole in the viewport or the exported STL).
    const body = [...bodies.values()][0];
    expect(body).toBeDefined();
    if (body) expect(nullFaceCount(body)).toBe(0);

    cache.freeFrom(0); // frees every produced shape (R8)
  });

  it('healInvalidSolid leaves a valid shape untouched', () => {
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    trackShapeAllocation();
    const healed = healInvalidSolid(oc, box);
    expect(healed).toBe(box); // same handle back — no repair, no copy
    healed.delete();
    trackShapeDisposal();
  });
});

afterAll(() => {
  expect(getLiveShapeCount()).toBe(0);
});
