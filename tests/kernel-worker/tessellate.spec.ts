import { beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import type { BodyId, ProfileId } from '../../src/core';
import { VIEWPORT_ANGULAR_DEFLECTION_DEG, VIEWPORT_LINEAR_DEFLECTION_MM } from '../../src/core';
import type { ChamferOp, ExtrudeOp, FilletOp } from '../../src/document';
import type { PlanePlacement, PlanProfile } from '../../src/kernel/protocol';
import { executeExtrude } from '../../src/kernel-worker/executors/extrude';
import { executeFillet } from '../../src/kernel-worker/executors/fillet';
import { executeChamfer } from '../../src/kernel-worker/executors/chamfer';
import { tessellateBodyEdges } from '../../src/kernel-worker/edgeFingerprint';
import { tessellateShape } from '../../src/kernel-worker/tessellate';
import type { BodyStateMap, ExecCtx } from '../../src/kernel-worker/executors/types';
import type { EdgeFingerprint } from '../../src/document';

/**
 * Tessellation orientation guard: every triangle normal must point OUTWARD.
 * `Poly_Triangulation` normals follow the surface's FORWARD orientation, so a
 * REVERSED face (routine after fillet/chamfer/boolean) must have its normal
 * negated. A body with inward-facing normals renders as "fake walls" and
 * see-through faces under directional lighting — the artifact this guards.
 */

let oc: OpenCascadeInstance;

const XY: PlanePlacement = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] };
const pid = (id: string): ProfileId => id as ProfileId;
const bid = (id: string): BodyId => id as BodyId;
const QUALITY = {
  linearDeflectionMm: VIEWPORT_LINEAR_DEFLECTION_MM,
  angularDeflectionDeg: VIEWPORT_ANGULAR_DEFLECTION_DEG,
};

function rectProfile(id: string, size: number): PlanProfile {
  return {
    id: pid(id),
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

function makeBox(bodies: BodyStateMap, id: string, size: number, height: number): void {
  const profile = rectProfile(`p-${id}`, size);
  const op: ExtrudeOp = {
    type: 'Extrude',
    id: `ex-${id}` as ExtrudeOp['id'],
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
    asSurface: false,
    bodyId: bid(id),
  };
  executeExtrude(ctxFor(bodies, [profile]), op);
}

function centroid(shape: TopoDS_Shape): [number, number, number] {
  const g = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, g, false, false, false);
  const c = g.CentreOfMass();
  const out: [number, number, number] = [c.X(), c.Y(), c.Z()];
  g.delete();
  return out;
}

/** Fraction of mesh vertices whose normal points toward the centroid (inward). */
function inwardFraction(shape: TopoDS_Shape): number {
  const [cx, cy, cz] = centroid(shape);
  const mesh = tessellateShape(oc, bid('probe'), shape, QUALITY);
  const pos = mesh.positions;
  const nrm = mesh.normals;
  let inward = 0;
  const n = pos.length / 3;
  for (let i = 0; i < n; i += 1) {
    const px = (pos[i * 3] ?? 0) - cx;
    const py = (pos[i * 3 + 1] ?? 0) - cy;
    const pz = (pos[i * 3 + 2] ?? 0) - cz;
    const dot = px * (nrm[i * 3] ?? 0) + py * (nrm[i * 3 + 1] ?? 0) + pz * (nrm[i * 3 + 2] ?? 0);
    if (dot < -1e-6) inward += 1;
  }
  return inward / n;
}

/** The fingerprint of a top edge running along X (max midpoint Z, direction ≈ X). */
function topXEdgeFingerprint(shape: TopoDS_Shape): EdgeFingerprint {
  const edges = tessellateBodyEdges(oc, shape);
  let best: EdgeFingerprint | null = null;
  for (const edge of edges) {
    const fp = edge.fingerprint;
    if (Math.abs(fp.direction[0]) < 0.99) continue;
    if (!best || fp.midpoint[2] > best.midpoint[2]) best = fp;
  }
  if (!best) throw new Error('no X-running top edge found');
  return best;
}

beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

describe('tessellation normal orientation', () => {
  it('a plain box meshes with all-outward normals', () => {
    const bodies: BodyStateMap = new Map();
    makeBox(bodies, 'B', 20, 20);
    const box = bodies.get(bid('B'));
    expect(box).toBeDefined();
    if (box) expect(inwardFraction(box)).toBe(0);
    box?.delete();
  });

  it('a filleted box (REVERSED faces) still meshes all-outward', () => {
    const bodies: BodyStateMap = new Map();
    makeBox(bodies, 'B', 20, 20);
    const box = bodies.get(bid('B'));
    if (!box) return;
    const op: FilletOp = {
      type: 'Fillet',
      id: 'f1' as FilletOp['id'],
      name: 'Fillet',
      suppressed: false,
      bodyId: bid('B'),
      edges: [topXEdgeFingerprint(box)],
      radiusMm: 3,
    };
    executeFillet(ctxFor(bodies, []), op);
    const filleted = bodies.get(bid('B'));
    if (filleted) expect(inwardFraction(filleted)).toBe(0);
    filleted?.delete();
  });

  it('a chamfered box still meshes all-outward', () => {
    const bodies: BodyStateMap = new Map();
    makeBox(bodies, 'B', 20, 20);
    const box = bodies.get(bid('B'));
    if (!box) return;
    const op: ChamferOp = {
      type: 'Chamfer',
      id: 'c1' as ChamferOp['id'],
      name: 'Chamfer',
      suppressed: false,
      bodyId: bid('B'),
      edges: [topXEdgeFingerprint(box)],
      distanceMm: 3,
    };
    executeChamfer(ctxFor(bodies, []), op);
    const chamfered = bodies.get(bid('B'));
    if (chamfered) expect(inwardFraction(chamfered)).toBe(0);
    chamfered?.delete();
  });
});
