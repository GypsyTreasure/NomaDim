import type { EntityId, PointId } from '../../../core';
import { POINT_ROLES, resolveRole, type Sketch, type SketchEntity } from '../../../document';

/**
 * Select-vs-Change granularity (#3). The Select tool picks the WHOLE shape a
 * click lands on — every entity connected through shared pool points (a
 * rectangle's four lines, a chained free-shape) — so Properties can summarize
 * it as drawn. The Change tool keeps a single entity for point/line editing.
 * Pure over the document; no store or geometry deps.
 */

/** The pool-point ids an entity references (via its stable roles, C6). */
export function entityPointIds(entity: SketchEntity): PointId[] {
  const ids: PointId[] = [];
  for (const role of POINT_ROLES[entity.type]) {
    const id = resolveRole(entity, role);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Every entity in the connected component of `startId` — entities reachable by
 * hopping through shared pool points. A standalone circle/point returns just
 * itself; a rectangle returns its four lines.
 */
export function connectedEntityIds(sketch: Sketch, startId: EntityId): EntityId[] {
  const byId = new Map<EntityId, SketchEntity>();
  const pointToEntities = new Map<PointId, EntityId[]>();
  for (const entity of sketch.entities) {
    byId.set(entity.id, entity);
    for (const pid of entityPointIds(entity)) {
      const list = pointToEntities.get(pid);
      if (list) list.push(entity.id);
      else pointToEntities.set(pid, [entity.id]);
    }
  }
  if (!byId.has(startId)) return [];

  const seen = new Set<EntityId>([startId]);
  const queue: EntityId[] = [startId];
  while (queue.length > 0) {
    const id = queue.shift();
    const entity = id ? byId.get(id) : undefined;
    if (!entity) continue;
    for (const pid of entityPointIds(entity)) {
      for (const neighbour of pointToEntities.get(pid) ?? []) {
        if (!seen.has(neighbour)) {
          seen.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
  }
  return [...seen];
}
