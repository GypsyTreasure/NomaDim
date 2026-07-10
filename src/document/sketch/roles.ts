import type { EntityId, PointId } from '../../core';
import type { SketchEntity, SketchEntityType } from './types';

/**
 * Stable point roles per entity type (ARCHITECTURE §8). Role references
 * `"<entityId>.<pointRole>"` (e.g. `"e12.p1"`, `"e7.center"`) are ACCESSORS
 * resolving to pool ids — they are never stored as coordinates. This is
 * part of the constraint-ready contract (C6): a v2 solver attaches
 * constraints to `entityId.role` pairs without any schema migration.
 */

export type PointRole = 'p1' | 'p2' | 'center';

/** Roles each entity type exposes, in canonical order. */
export const POINT_ROLES: Record<SketchEntityType, readonly PointRole[]> = {
  line: ['p1', 'p2'],
  circle: ['center'],
  arc: ['center', 'p1', 'p2'],
  point: ['p1'],
};

/** Resolves a role on an entity to its pool point id, or null when the entity lacks that role. */
export function resolveRole(entity: SketchEntity, role: PointRole): PointId | null {
  switch (entity.type) {
    case 'line':
      switch (role) {
        case 'p1':
          return entity.start;
        case 'p2':
          return entity.end;
        case 'center':
          return null;
      }
      break;
    case 'circle':
      switch (role) {
        case 'center':
          return entity.center;
        case 'p1':
        case 'p2':
          return null;
      }
      break;
    case 'arc':
      switch (role) {
        case 'center':
          return entity.center;
        case 'p1':
          return entity.start;
        case 'p2':
          return entity.end;
      }
      break;
    case 'point':
      switch (role) {
        case 'p1':
          return entity.point;
        case 'p2':
        case 'center':
          return null;
      }
      break;
    default: {
      const exhaustive: never = entity;
      return exhaustive;
    }
  }
}

/** All pool point ids an entity references, in canonical role order. */
export function referencedPointIds(entity: SketchEntity): readonly PointId[] {
  const ids: PointId[] = [];
  for (const role of POINT_ROLES[entity.type]) {
    const id = resolveRole(entity, role);
    if (id !== null) ids.push(id);
  }
  return ids;
}

export interface RoleRef {
  readonly entityId: EntityId;
  readonly role: PointRole;
}

const ROLE_REF_PATTERN = /^(.+)\.(p1|p2|center)$/;

/** Parses `"<entityId>.<pointRole>"`; returns null for malformed refs. */
export function parseRoleRef(ref: string): RoleRef | null {
  const match = ROLE_REF_PATTERN.exec(ref);
  if (!match) return null;
  return { entityId: match[1] as EntityId, role: match[2] as PointRole };
}

export function formatRoleRef(ref: RoleRef): string {
  return `${ref.entityId}.${ref.role}`;
}
