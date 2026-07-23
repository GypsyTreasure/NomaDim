import { describe, expect, it } from 'vitest';
import type { BodyId, OpId, SketchId } from '../../src/core';
import {
  bodyDisplayName,
  bodyOrdinal,
  emptyDocument,
  type DocumentState,
  type ExtrudeOp,
} from '../../src/document';

/**
 * Readable body names (request #5): unnamed bodies read as "Body N" by
 * creation order — never the raw id — and a user rename wins.
 */

const bid = (id: string): BodyId => id as BodyId;

function extrudeProducing(id: string, bodyId: string): ExtrudeOp {
  return {
    type: 'Extrude',
    id: id as OpId,
    name: id,
    suppressed: false,
    sketchId: 's1' as SketchId,
    profileIds: [],
    distanceMm: 5,
    direction: 'one-side',
    distance2Mm: 0,
    operation: 'NewBody',
    targetBodyId: null,
    wallThicknessMm: 0,
    asSurface: false,
    bodyId: bid(bodyId),
  };
}

function docWithBodies(): DocumentState {
  return {
    ...emptyDocument(),
    ops: [extrudeProducing('ex1', 'ba'), extrudeProducing('ex2', 'bb')],
  };
}

describe('body naming', () => {
  it('numbers bodies by creation order', () => {
    const doc = docWithBodies();
    expect(bodyOrdinal(doc, bid('ba'))).toBe(1);
    expect(bodyOrdinal(doc, bid('bb'))).toBe(2);
    expect(bodyDisplayName(doc, bid('ba'))).toBe('Body1');
    expect(bodyDisplayName(doc, bid('bb'))).toBe('Body2');
  });

  it('uses the user name once materialized', () => {
    const doc: DocumentState = {
      ...docWithBodies(),
      bodyMeta: [{ id: bid('ba'), name: 'Base Plate', color: '#1A6B5A', visible: true }],
    };
    expect(bodyDisplayName(doc, bid('ba'))).toBe('Base Plate');
    expect(bodyDisplayName(doc, bid('bb'))).toBe('Body2'); // still default
  });

  it('falls back to the id for a body no op produces', () => {
    expect(bodyDisplayName(emptyDocument(), bid('ghost'))).toBe('ghost');
  });
});
