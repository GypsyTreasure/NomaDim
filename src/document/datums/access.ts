import type { DatumId } from '../../core';
import type { DocumentState } from '../model';
import type { Datum } from './types';

/** Read/write helpers over the construction-geometry (datum) collection. */

export function getDatum(state: DocumentState, id: DatumId): Datum | undefined {
  return state.datums.find((d) => d.id === id);
}

/** Upserts one datum, returning the next whole list (undoable as one patch). */
export function upsertDatum(state: DocumentState, datum: Datum): readonly Datum[] {
  const without = state.datums.filter((d) => d.id !== datum.id);
  return [...without, datum];
}

/** Removes one datum by id, returning the next whole list. */
export function removeDatum(state: DocumentState, id: DatumId): readonly Datum[] {
  return state.datums.filter((d) => d.id !== id);
}
