import type { PointId } from '../../core';
import type { SketchEntity } from '../../document';

/**
 * Entity → pool-point topology enumeration, local to sketch/ because the
 * layer contract allows only TYPE imports from document/ (ARCHITECTURE §3).
 * The equivalent accessor in document/sketch/roles.ts serves document-side
 * consumers; this one serves geometry (snap sources, profile graphs).
 */

/** Every pool point the entity references. */
export function entityPointIds(entity: SketchEntity): readonly PointId[] {
  switch (entity.type) {
    case 'line':
      return [entity.start, entity.end];
    case 'circle':
      return [entity.center];
    case 'arc':
      return [entity.center, entity.start, entity.end];
    case 'point':
      return [entity.point];
    default: {
      const exhaustive: never = entity;
      return exhaustive;
    }
  }
}

/** Endpoints only — the connectivity that profile loops traverse (centers excluded). */
export function entityEndpointIds(entity: SketchEntity): readonly PointId[] {
  switch (entity.type) {
    case 'line':
      return [entity.start, entity.end];
    case 'arc':
      return [entity.start, entity.end];
    case 'circle':
    case 'point':
      return [];
    default: {
      const exhaustive: never = entity;
      return exhaustive;
    }
  }
}
