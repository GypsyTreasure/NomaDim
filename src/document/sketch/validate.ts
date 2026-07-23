import { err, ok, ValidationError, distance, nearlyEqual, type Result } from '../../core';
import type { Sketch, SketchPoint } from './types';
import { referencedPointIds } from './roles';

/**
 * Structural validation for a Sketch (ARCHITECTURE §12: ValidationError →
 * inline dialog message, nothing applied). Geometry is baked (Option B), so
 * validation is where the model's invariants are enforced on every write.
 */

/** Baked-coordinate tolerance for arc radius agreement, in mm. */
const ARC_RADIUS_TOLERANCE_MM = 1e-6;

export function validateSketch(sketch: Sketch): Result<void, ValidationError> {
  const pointsById = new Map<string, SketchPoint>();
  for (const point of sketch.points) {
    if (pointsById.has(point.id)) {
      return err(new ValidationError(`Duplicate point id "${point.id}"`, 'points'));
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return err(new ValidationError(`Point "${point.id}" has non-finite coordinates`, 'points'));
    }
    pointsById.set(point.id, point);
  }

  const entityIds = new Set<string>();
  for (const entity of sketch.entities) {
    if (entityIds.has(entity.id)) {
      return err(new ValidationError(`Duplicate entity id "${entity.id}"`, 'entities'));
    }
    entityIds.add(entity.id);

    for (const pointId of referencedPointIds(entity)) {
      if (!pointsById.has(pointId)) {
        return err(
          new ValidationError(
            `Entity "${entity.id}" references missing point "${pointId}"`,
            'entities'
          )
        );
      }
    }

    switch (entity.type) {
      case 'line': {
        if (entity.start === entity.end) {
          return err(
            new ValidationError(`Line "${entity.id}" is degenerate (start === end)`, 'entities')
          );
        }
        break;
      }
      case 'circle': {
        if (!(entity.r > 0)) {
          return err(
            new ValidationError(`Circle "${entity.id}" has non-positive radius`, 'entities')
          );
        }
        break;
      }
      case 'arc': {
        if (entity.start === entity.end) {
          return err(
            new ValidationError(
              `Arc "${entity.id}" is degenerate (start === end); use a circle`,
              'entities'
            )
          );
        }
        const center = pointsById.get(entity.center);
        const start = pointsById.get(entity.start);
        const end = pointsById.get(entity.end);
        if (center && start && end) {
          const rStart = distance(center, start);
          const rEnd = distance(center, end);
          if (!(rStart > 0)) {
            return err(new ValidationError(`Arc "${entity.id}" has zero radius`, 'entities'));
          }
          if (!nearlyEqual(rStart, rEnd, ARC_RADIUS_TOLERANCE_MM)) {
            return err(
              new ValidationError(
                `Arc "${entity.id}" endpoints are not equidistant from its center`,
                'entities'
              )
            );
          }
        }
        break;
      }
      case 'point':
        break;
      default: {
        const exhaustive: never = entity;
        return exhaustive;
      }
    }
  }

  const dimensionIds = new Set<string>();
  for (const dim of sketch.dimensions) {
    if (dimensionIds.has(dim.id)) {
      return err(new ValidationError(`Duplicate dimension id "${dim.id}"`, 'dimensions'));
    }
    dimensionIds.add(dim.id);
    // A radial dimension (entityId set) legitimately has a === b: both point at
    // the entity centre, and the rim endpoint is derived from the entity (#1).
    if (dim.entityId === undefined && dim.a === dim.b) {
      return err(
        new ValidationError(`Dimension "${dim.id}" references a single point twice`, 'dimensions')
      );
    }
    for (const pointId of [dim.a, dim.b]) {
      if (!pointsById.has(pointId)) {
        return err(
          new ValidationError(
            `Dimension "${dim.id}" references missing point "${pointId}"`,
            'dimensions'
          )
        );
      }
    }
    if (dim.entityId !== undefined && !entityIds.has(dim.entityId)) {
      return err(
        new ValidationError(
          `Dimension "${dim.id}" references missing entity "${dim.entityId}"`,
          'dimensions'
        )
      );
    }
    if (!Number.isFinite(dim.offset)) {
      return err(new ValidationError(`Dimension "${dim.id}" has non-finite offset`, 'dimensions'));
    }
  }

  return ok(undefined);
}
