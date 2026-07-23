import type { SketchId } from '../core';
import {
  findSketch,
  getEntity,
  opDefinition,
  pointMap,
  type DocumentState,
  type ExtrudeOp,
  type OpType,
  type RevolveAxis,
  type RevolveOp,
  type SketchPlaneRef,
  type TimelineOp,
} from '../document';
import { detectProfiles } from '../sketch';
import type { PlanePlacement, PlanOp, PlanProfile, RegenPlan, WorldAxis } from '../kernel/protocol';

/**
 * Regen plan construction (ARCHITECTURE §9, R7): the MAIN thread resolves
 * every profile and revolve axis into world space so the worker never
 * re-derives sketch topology. Only the active prefix `ops[0..rollbackIndex)`
 * enters the plan (F1); ops beyond the marker exist but do not evaluate.
 *
 * Op-specific input resolution lives in the per-OpType resolver registry
 * below (R4) — no `if (op.type === …)` switches leak into the scheduler.
 */

// --- Plane placement (Z-up world) ------------------------------------------

const ORIGIN_PLACEMENTS: Record<'XY' | 'XZ' | 'YZ', PlanePlacement> = {
  XY: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
  XZ: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] },
  YZ: { origin: [0, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1] },
};

export function placementForPlane(plane: SketchPlaneRef): PlanePlacement {
  if (plane.kind === 'face') {
    const s = plane.planeSnapshot;
    return { origin: s.origin, xAxis: s.xAxis, yAxis: s.yAxis };
  }
  return ORIGIN_PLACEMENTS[plane.plane];
}

type Vec3 = readonly [number, number, number];

/** Maps a 2D sketch coordinate into world space through the plane placement. */
function to3d(placement: PlanePlacement, x: number, y: number): Vec3 {
  const { origin: o, xAxis: ax, yAxis: ay } = placement;
  return [o[0] + ax[0] * x + ay[0] * y, o[1] + ax[1] * x + ay[1] * y, o[2] + ax[2] * x + ay[2] * y];
}

// --- Op-specific input resolution (per-OpType registry, R4) ----------------

interface PlanInputs {
  readonly profiles: readonly PlanProfile[];
  readonly axisWorld?: WorldAxis;
}

interface OpPlanResolver<T extends TimelineOp = TimelineOp> {
  resolve(doc: DocumentState, op: T): PlanInputs;
}

/** Profiles referenced by a sketch-consuming op, resolved to world loops (R7). */
function resolveProfiles(
  doc: DocumentState,
  sketchId: SketchId,
  profileIds: readonly string[]
): PlanProfile[] {
  const sketch = findSketch(doc, sketchId);
  if (!sketch) return [];
  const placement = placementForPlane(sketch.plane);
  const wanted = new Set(profileIds);
  return detectProfiles(sketch)
    .profiles.filter((p) => wanted.has(p.id))
    .map((p) => ({
      id: p.id,
      plane: placement,
      outer: p.outer.segments,
      inner: p.inner.map((loop) => loop.segments),
    }));
}

/** Resolves a revolve axis (origin axis or same-sketch line) to world space. */
function resolveAxis(doc: DocumentState, op: RevolveOp): WorldAxis | undefined {
  const sketch = findSketch(doc, op.sketchId);
  if (!sketch) return undefined;
  const axis: RevolveAxis = op.axis;
  if (axis.kind === 'origin') {
    const direction: Vec3 =
      axis.axis === 'X' ? [1, 0, 0] : axis.axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
    return { origin: [0, 0, 0], direction };
  }
  const entity = getEntity(sketch, axis.entityId);
  if (entity?.type !== 'line') return undefined;
  const points = pointMap(sketch);
  const a = points.get(entity.start);
  const b = points.get(entity.end);
  if (!a || !b) return undefined;
  const placement = placementForPlane(sketch.plane);
  const wa = to3d(placement, a.x, a.y);
  const wb = to3d(placement, b.x, b.y);
  const d: Vec3 = [wb[0] - wa[0], wb[1] - wa[1], wb[2] - wa[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-9) return undefined;
  return { origin: wa, direction: [d[0] / len, d[1] / len, d[2] / len] };
}

/** Ops that need no main-thread input resolution (edges resolve in the worker). */
const noInputsResolver: OpPlanResolver = {
  resolve: () => ({ profiles: [] }),
};

const extrudePlanResolver: OpPlanResolver<ExtrudeOp> = {
  resolve: (doc, op) => ({ profiles: resolveProfiles(doc, op.sketchId, op.profileIds) }),
};

const revolvePlanResolver: OpPlanResolver<RevolveOp> = {
  resolve: (doc, op) => ({
    profiles: resolveProfiles(doc, op.sketchId, op.profileIds),
    axisWorld: resolveAxis(doc, op),
  }),
};

/**
 * Per-OpType plan resolver registry (ARCHITECTURE §7). Completeness across
 * OP_TYPES is asserted by the registry-completeness test (R9).
 */
export const OP_PLAN_RESOLVERS: Record<OpType, OpPlanResolver> = {
  Sketch: noInputsResolver,
  Extrude: extrudePlanResolver,
  Revolve: revolvePlanResolver,
  Fillet: noInputsResolver,
  Chamfer: noInputsResolver,
  Combine: noInputsResolver,
  CopyBody: noInputsResolver,
  Mirror: noInputsResolver,
  Pattern: noInputsResolver,
};

// --- Plan assembly ---------------------------------------------------------

export function buildRegenPlan(doc: DocumentState): RegenPlan {
  const active = doc.ops.slice(0, doc.rollbackIndex);

  // Sketches whose producing Sketch op is suppressed → downstream consumers
  // skip (§9). Derived generically from producesSketch (no type switch, R4).
  const suppressedSketches = new Set<SketchId>();
  for (const op of doc.ops) {
    const produced = opDefinition(op).dependencies(op).producesSketch;
    if (produced !== null && op.suppressed) suppressedSketches.add(produced);
  }

  const ops: PlanOp[] = active.map((op) => {
    const deps = opDefinition(op).dependencies(op);
    const inputs = OP_PLAN_RESOLVERS[op.type].resolve(doc, op);
    const inputsSuppressed =
      deps.consumesSketch !== null && suppressedSketches.has(deps.consumesSketch);
    return { op, profiles: inputs.profiles, axisWorld: inputs.axisWorld, inputsSuppressed };
  });

  return { ops };
}
