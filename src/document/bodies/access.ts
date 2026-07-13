import type { BodyId } from '../../core';
import type { DocumentState } from '../model';
import { defaultBodyMeta, type BodyMeta } from './types';

/** Read-side helpers over the lazily-materialized body metadata list. */

export function getBodyMeta(state: DocumentState, id: BodyId): BodyMeta {
  return state.bodyMeta.find((m) => m.id === id) ?? defaultBodyMeta(id);
}

/** Upserts one body's metadata, returning the next whole list. */
export function upsertBodyMeta(state: DocumentState, meta: BodyMeta): readonly BodyMeta[] {
  const without = state.bodyMeta.filter((m) => m.id !== meta.id);
  return [...without, meta];
}
