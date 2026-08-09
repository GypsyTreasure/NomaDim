import { createId, type EntityId, type PointId, type Vec2 } from '../../core';
import { pointMap, type Sketch, type SketchEntity, type SketchPoint } from '../../document';
import type { SketchGeometryDelta } from '../sketchTransform';

/**
 * Sketch Group / Join (AutoCAD parity) — the exact inverse of Explode. Where
 * Explode gives every entity PRIVATE copies of its points (un-welding a shape so
 * each line/arc selects alone), Group WELDS the selected entities' coincident
 * endpoints into SHARED points, so lines that merely touch become one connected
 * shape that a single Select click grabs as a unit.
 *
 * Solver-free and serializable: coincident endpoints (same coordinate within a
 * sub-micron tolerance) are clustered and each cluster becomes one shared pool
 * point; the entities are rebuilt to reference the shared points. Returns the
 * ids to delete plus the fresh shared points + rebound entities for the normal
 * delete + `AddSketchGeometry` write path. Coordinates are unchanged — only the
 * topology (private → shared points) changes. Entities that do not touch keep
 * their own points and simply stay separate (nothing to weld).
 */

/** All ids already used, so minted ids never collide. */
function existingIds(sketch: Sketch): Set<string> {
  const ids = new Set<string>();
  for (const p of sketch.points) ids.add(p.id);
  for (const e of sketch.entities) ids.add(e.id);
  for (const d of sketch.dimensions) ids.add(d.id);
  return ids;
}

export interface GroupResult {
  /** Original entities to delete (their private points go with them if orphaned). */
  readonly removeEntityIds: EntityId[];
  /** Fresh shared points + rebound entities to add back at the same coordinates. */
  readonly add: SketchGeometryDelta;
}

/**
 * Group `entityIds`: weld coincident endpoints into shared points and rebuild
 * the entities. Returns null when fewer than two entities are targeted (nothing
 * to join). Coordinates are preserved; only point sharing changes.
 */
export function groupEntities(sketch: Sketch, entityIds: readonly EntityId[]): GroupResult | null {
  const wanted = new Set(entityIds);
  const targets = sketch.entities.filter((e) => wanted.has(e.id));
  if (targets.length < 2) return null;

  const pts = pointMap(sketch);
  const taken = existingIds(sketch);
  const at = (id: PointId): Vec2 => {
    const p = pts.get(id);
    return { x: p?.x ?? 0, y: p?.y ?? 0 };
  };
  // Cluster coincident coordinates (~0.1 µm) → one canonical shared point id.
  const key = (v: Vec2): string =>
    `${String(Math.round(v.x * 1e4))}:${String(Math.round(v.y * 1e4))}`;
  const canonical = new Map<string, PointId>();
  const newPoints: SketchPoint[] = [];
  const shared = (id: PointId): PointId => {
    const v = at(id);
    const k = key(v);
    const existing = canonical.get(k);
    if (existing) return existing;
    const nid = createId<'PointId'>(taken);
    taken.add(nid);
    canonical.set(k, nid);
    newPoints.push({ id: nid, x: v.x, y: v.y });
    return nid;
  };
  const mkEntityId = (): EntityId => {
    const id = createId<'EntityId'>(taken);
    taken.add(id);
    return id;
  };

  const newEntities: SketchEntity[] = [];
  for (const e of targets) {
    switch (e.type) {
      case 'line':
        newEntities.push({
          type: 'line',
          id: mkEntityId(),
          start: shared(e.start),
          end: shared(e.end),
          construction: e.construction,
          ...(e.axis ? { axis: true } : {}),
        });
        break;
      case 'circle':
        newEntities.push({
          type: 'circle',
          id: mkEntityId(),
          center: shared(e.center),
          r: e.r,
          construction: e.construction,
        });
        break;
      case 'arc':
        newEntities.push({
          type: 'arc',
          id: mkEntityId(),
          center: shared(e.center),
          start: shared(e.start),
          end: shared(e.end),
          ccw: e.ccw,
          construction: e.construction,
        });
        break;
      case 'point':
        newEntities.push({
          type: 'point',
          id: mkEntityId(),
          point: shared(e.point),
          construction: e.construction,
        });
        break;
      case 'spline':
        newEntities.push({
          type: 'spline',
          id: mkEntityId(),
          points: e.points.map(shared),
          closed: e.closed,
          construction: e.construction,
        });
        break;
      default: {
        const exhaustive: never = e;
        return exhaustive;
      }
    }
  }

  return {
    removeEntityIds: targets.map((e) => e.id),
    add: { points: newPoints, entities: newEntities },
  };
}
