import type { BodyId } from '../../core';
import type { DocumentState } from '../model';
import { opDefinition } from '../ops/registry';
import { defaultBodyMeta, type BodyMeta } from './types';

/** Read-side helpers over the lazily-materialized body metadata list. */

export function getBodyMeta(state: DocumentState, id: BodyId): BodyMeta {
  return state.bodyMeta.find((m) => m.id === id) ?? defaultBodyMeta(id);
}

/**
 * 1-based creation order of a body across the timeline (the order ops mint
 * bodies). Stable in v1 (no op reordering); the basis for readable "Body N"
 * names. Returns 0 if the id is produced by no op.
 */
export function bodyOrdinal(state: DocumentState, id: BodyId): number {
  let n = 0;
  for (const op of state.ops) {
    for (const produced of opDefinition(op).dependencies(op).producesBodies) {
      n += 1;
      if (produced === id) return n;
    }
  }
  return 0;
}

/**
 * Human-readable body name (request #5): the user's name once materialized,
 * else "Body N" by creation order — never the raw id. Used in the browser
 * tree and every body dropdown.
 */
export function bodyDisplayName(state: DocumentState, id: BodyId): string {
  const meta = state.bodyMeta.find((m) => m.id === id);
  if (meta) return meta.name;
  const ordinal = bodyOrdinal(state, id);
  return ordinal > 0 ? `Body${String(ordinal)}` : id;
}

/** Upserts one body's metadata, returning the next whole list. */
export function upsertBodyMeta(state: DocumentState, meta: BodyMeta): readonly BodyMeta[] {
  const without = state.bodyMeta.filter((m) => m.id !== meta.id);
  return [...without, meta];
}
