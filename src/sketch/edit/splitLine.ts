import { createId, cross, lerp, sub, type EntityId, type PointId, type Vec2 } from '../../core';
import {
  pointMap,
  type LineEntity,
  type Sketch,
  type SketchEntity,
  type SketchPoint,
} from '../../document';

/**
 * Split-line-by-lines (#6, ADR-0099): dividing a picked line wherever OTHER
 * lines cross it, inserting a shared "joint" pool point at each crossing so the
 * pieces (and the crossing line, when the hit is interior to it) meet as real
 * topology — the AutoCAD "Break" / Fusion split. Pure geometry (core math +
 * document types only), unit-tested without DOM (R11); the app builds the plan
 * and dispatches it as one undoable transaction.
 */

/** A ready-to-apply mutation: drop `removeEntityIds`, add `addPoints`+`addEntities`. */
export interface SplitPlan {
  readonly removeEntityIds: readonly EntityId[];
  readonly addPoints: readonly SketchPoint[];
  readonly addEntities: readonly SketchEntity[];
}

/** Parametric tolerance: a crossing this close to an endpoint is treated AS the
 * endpoint (reuse it, don't split there) rather than making a zero-length stub. */
const PARAM_EPS = 1e-6;
/** Two points within this distance (mm) are the same pool point (shared joint). */
const MERGE_EPS_MM = 1e-6;

function lineEndpoints(
  e: LineEntity,
  pts: ReadonlyMap<PointId, SketchPoint>
): { a: Vec2; b: Vec2 } | null {
  const A = pts.get(e.start);
  const B = pts.get(e.end);
  return A && B ? { a: { x: A.x, y: A.y }, b: { x: B.x, y: B.y } } : null;
}

/**
 * Plans the split of line `entityId` by every other line it crosses. Returns
 * null when the entity is not a line or nothing crosses its interior.
 */
export function planLineSplit(sketch: Sketch, entityId: EntityId): SplitPlan | null {
  const target = sketch.entities.find((e) => e.id === entityId);
  if (target?.type !== 'line') return null;
  const pts = pointMap(sketch);
  const ends = lineEndpoints(target, pts);
  if (!ends) return null;
  const { a, b } = ends;
  const ab = sub(b, a);

  const idPool = new Set<string>();
  for (const p of sketch.points) idPool.add(p.id);
  for (const e of sketch.entities) idPool.add(e.id);

  const addPoints: SketchPoint[] = [];
  // Reuse a coincident existing/new pool point (that's what makes the joint a
  // shared reference, not just equal coordinates); otherwise mint one.
  const jointAt = (coord: Vec2): PointId => {
    const near = (p: SketchPoint): boolean =>
      (p.x - coord.x) ** 2 + (p.y - coord.y) ** 2 <= MERGE_EPS_MM ** 2;
    for (const p of sketch.points) if (near(p)) return p.id;
    for (const p of addPoints) if (near(p)) return p.id;
    const id = createId<'PointId'>(idPool);
    idPool.add(id);
    addPoints.push({ id, x: coord.x, y: coord.y });
    return id;
  };

  const cuts: { t: number; pointId: PointId }[] = [];
  const crosserSplits = new Map<EntityId, { pointId: PointId; entity: LineEntity }>();

  for (const e of sketch.entities) {
    if (e.id === entityId || e.type !== 'line') continue;
    const other = lineEndpoints(e, pts);
    if (!other) continue;
    const cd = sub(other.b, other.a);
    const denom = cross(ab, cd);
    if (Math.abs(denom) < 1e-12) continue; // parallel or collinear — no clean cut
    const ac = sub(other.a, a);
    const t = cross(ac, cd) / denom; // param along the target
    const u = cross(ac, ab) / denom; // param along the crossing line
    if (t <= PARAM_EPS || t >= 1 - PARAM_EPS) continue; // must divide the target's interior
    if (u < -PARAM_EPS || u > 1 + PARAM_EPS) continue; // must land on the crosser
    const pointId = jointAt(lerp(a, b, t));
    cuts.push({ t, pointId });
    // Interior to the crosser too → split it there so the joint is mutual.
    // (u≈0/1 lands on the crosser's endpoint, already shared via jointAt.)
    if (u > PARAM_EPS && u < 1 - PARAM_EPS) crosserSplits.set(e.id, { pointId, entity: e });
  }

  if (cuts.length === 0) return null;
  cuts.sort((x, y) => x.t - y.t);

  // Ordered, de-duplicated joint sequence along the target (two crossers meeting
  // it at one spot share a pointId → one cut).
  const sequence: PointId[] = [];
  for (const cut of cuts) {
    if (sequence[sequence.length - 1] !== cut.pointId) sequence.push(cut.pointId);
  }

  const line = (start: PointId, end: PointId, from: LineEntity): SketchEntity => {
    const id = createId<'EntityId'>(idPool);
    idPool.add(id);
    return from.axis
      ? { type: 'line', id, start, end, construction: from.construction, axis: true }
      : { type: 'line', id, start, end, construction: from.construction };
  };

  const addEntities: SketchEntity[] = [];
  const removeEntityIds: EntityId[] = [entityId];

  const chain: PointId[] = [target.start, ...sequence, target.end];
  for (let i = 0; i + 1 < chain.length; i += 1) {
    const start = chain[i];
    const end = chain[i + 1];
    if (start === undefined || end === undefined) continue;
    addEntities.push(line(start, end, target));
  }
  for (const { entity, pointId } of crosserSplits.values()) {
    removeEntityIds.push(entity.id);
    addEntities.push(line(entity.start, pointId, entity));
    addEntities.push(line(pointId, entity.end, entity));
  }

  return { removeEntityIds, addPoints, addEntities };
}
