import type { EntityId, PointId, SketchId } from '../../core';
import type { Sketch, SketchEntity, SketchPlaneRef, SketchPoint } from './types';

/** Read-side lookup helpers over the immutable Sketch model. */

export function emptySketch(id: SketchId, name: string, plane: SketchPlaneRef): Sketch {
  return { id, name, plane, points: [], entities: [], constraints: [], dimensions: [] };
}

export function pointMap(sketch: Sketch): ReadonlyMap<PointId, SketchPoint> {
  return new Map(sketch.points.map((p) => [p.id, p]));
}

export function getPoint(sketch: Sketch, id: PointId): SketchPoint | undefined {
  return sketch.points.find((p) => p.id === id);
}

export function getEntity(sketch: Sketch, id: EntityId): SketchEntity | undefined {
  return sketch.entities.find((e) => e.id === id);
}

/** Entities referencing the given pool point (dependency checks before delete, F2). */
export function entitiesUsingPoint(sketch: Sketch, pointId: PointId): readonly SketchEntity[] {
  return sketch.entities.filter((entity) => {
    switch (entity.type) {
      case 'line':
        return entity.start === pointId || entity.end === pointId;
      case 'circle':
        return entity.center === pointId;
      case 'arc':
        return entity.center === pointId || entity.start === pointId || entity.end === pointId;
      case 'point':
        return entity.point === pointId;
      default: {
        const exhaustive: never = entity;
        return exhaustive;
      }
    }
  });
}
