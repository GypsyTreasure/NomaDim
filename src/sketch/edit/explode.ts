import { createId, type EntityId, type PointId, type Vec2 } from '../../core';
import { pointMap, type Sketch, type SketchEntity, type SketchPoint } from '../../document';
import type { SketchGeometryDelta } from '../sketchTransform';

/**
 * Sketch Explode ("bomb", AutoCAD parity). Shapes in NomaDim are grouped for
 * selection by SHARED pool points (a rectangle's four lines share four corner
 * points), so a single Select click grabs the whole connected shape. Explode
 * un-welds that: it gives every selected entity its OWN private copy of each
 * point it references, so the entities are no longer connected and each
 * line/arc/circle/spline becomes individually selectable — exactly like AutoCAD
 * EXPLODE on a polyline/rectangle.
 *
 * Solver-free and serializable: it returns the ids to remove plus plain new
 * points + rebound entities for the normal delete + `AddSketchGeometry` write
 * path. Coordinates are unchanged, so the drawing looks identical — only the
 * topology (shared vs private points) changes.
 */

/** All ids already used, so minted ids never collide. */
function existingIds(sketch: Sketch): Set<string> {
  const ids = new Set<string>();
  for (const p of sketch.points) ids.add(p.id);
  for (const e of sketch.entities) ids.add(e.id);
  for (const d of sketch.dimensions) ids.add(d.id);
  return ids;
}

export interface ExplodeResult {
  /** Original entities to delete (their shared points go with them if orphaned). */
  readonly removeEntityIds: EntityId[];
  /** Fresh private points + rebound entities to add back at the same coordinates. */
  readonly add: SketchGeometryDelta;
}

/**
 * Explode `entityIds`: each entity is rebuilt with private copies of its points.
 * Returns null when nothing explodable was found. Point coordinates are copied
 * verbatim, so geometry is preserved; only the sharing is broken.
 */
export function explodeEntities(
  sketch: Sketch,
  entityIds: readonly EntityId[]
): ExplodeResult | null {
  const wanted = new Set(entityIds);
  const targets = sketch.entities.filter((e) => wanted.has(e.id));
  if (targets.length === 0) return null;

  const pts = pointMap(sketch);
  const taken = existingIds(sketch);
  const newPoints: SketchPoint[] = [];
  const newEntities: SketchEntity[] = [];

  const at = (id: PointId): Vec2 => {
    const p = pts.get(id);
    return { x: p?.x ?? 0, y: p?.y ?? 0 };
  };
  const copy = (id: PointId): PointId => {
    const v = at(id);
    const nid = createId<'PointId'>(taken);
    taken.add(nid);
    newPoints.push({ id: nid, x: v.x, y: v.y });
    return nid;
  };
  const mkEntityId = (): EntityId => {
    const id = createId<'EntityId'>(taken);
    taken.add(id);
    return id;
  };

  for (const e of targets) {
    switch (e.type) {
      case 'line':
        newEntities.push({
          type: 'line',
          id: mkEntityId(),
          start: copy(e.start),
          end: copy(e.end),
          construction: e.construction,
          ...(e.axis ? { axis: true } : {}),
        });
        break;
      case 'circle':
        newEntities.push({
          type: 'circle',
          id: mkEntityId(),
          center: copy(e.center),
          r: e.r,
          construction: e.construction,
        });
        break;
      case 'arc':
        newEntities.push({
          type: 'arc',
          id: mkEntityId(),
          center: copy(e.center),
          start: copy(e.start),
          end: copy(e.end),
          ccw: e.ccw,
          construction: e.construction,
        });
        break;
      case 'point':
        newEntities.push({
          type: 'point',
          id: mkEntityId(),
          point: copy(e.point),
          construction: e.construction,
        });
        break;
      case 'spline':
        newEntities.push({
          type: 'spline',
          id: mkEntityId(),
          points: e.points.map(copy),
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
