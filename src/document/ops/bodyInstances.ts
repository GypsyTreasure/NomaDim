import type { BodyId } from '../../core';
import { asRawArray, strAttr, type Raw } from '../xml/xmlRaw';
import type { BodyInstance } from './types';

/**
 * Shared codec for the multi-source `extraInstances` of transform ops (#3):
 * each extra source→produced pair serializes as an `<instance source body/>`
 * child. A single-source op has none — the field stays absent for round-trip
 * equality and back-compat with pre-#3 documents.
 */

export function instanceChildren(
  extras: readonly BodyInstance[] | undefined
): { tag: 'instance'; attrs: { source: string; body: string } }[] {
  return (extras ?? []).map((i) => ({
    tag: 'instance',
    attrs: { source: i.sourceBodyId, body: i.bodyId },
  }));
}

/** Parses `<instance>` children into extras, or undefined when there are none. */
export function parseInstances(raw: Raw): readonly BodyInstance[] | undefined {
  const list = asRawArray(raw.instance).flatMap((el): BodyInstance[] => {
    const source = strAttr(el, 'source');
    const body = strAttr(el, 'body');
    return source !== null && body !== null
      ? [{ sourceBodyId: source as BodyId, bodyId: body as BodyId }]
      : [];
  });
  return list.length > 0 ? list : undefined;
}
