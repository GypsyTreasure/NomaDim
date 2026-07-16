import { describe, expect, it } from 'vitest';
import type { BodyId, EntityId, OpId, PointId, ProfileId, SketchId } from '../../src/core/ids';
import type { DocumentState, Sketch, TimelineOp } from '../../src/document';
import { documentFromXml, documentToXml } from '../../src/document';

/**
 * Whole-document codec round-trip (M6, F7): the enclosing <nomadim> wrapper —
 * sketches (origin + face-plane snapshot + axis flag), the full timeline over
 * all 7 OpTypes, the rollback marker, and body/sketch display metadata — must
 * survive model → XML → model unchanged, and a newer schema version must be
 * rejected (ADR-0007).
 */

const sk = (id: string): SketchId => id as SketchId;
const op = (id: string): OpId => id as OpId;
const body = (id: string): BodyId => id as BodyId;
const prof = (id: string): ProfileId => id as ProfileId;
const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

/** An origin-plane sketch with a normal line and an axis (centerline). */
const originSketch: Sketch = {
  id: sk('s1'),
  name: 'Sketch1',
  plane: { kind: 'origin', plane: 'XY' },
  points: [
    { id: pid('p0'), x: 0, y: 0 },
    { id: pid('p1'), x: 10, y: 0 },
  ],
  entities: [
    {
      type: 'line',
      id: eid('e0'),
      start: pid('p0'),
      end: pid('p1'),
      construction: false,
      axis: false,
    },
    {
      type: 'line',
      id: eid('e1'),
      start: pid('p0'),
      end: pid('p1'),
      construction: true,
      axis: true,
    },
  ],
  constraints: [],
  dimensions: [],
};

/** A face-plane sketch (fingerprint + plane snapshot). */
const faceSketch: Sketch = {
  id: sk('s2'),
  name: 'Sketch2',
  plane: {
    kind: 'face',
    fingerprint: 'face:1,2,10:0,0,1:400',
    planeSnapshot: { origin: [1, 2, 10], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
  },
  points: [{ id: pid('q0'), x: 0, y: 0 }],
  entities: [{ type: 'circle', id: eid('c0'), center: pid('q0'), r: 5, construction: false }],
  constraints: [],
  dimensions: [],
};

/** All seven OpTypes, in timeline order. */
const ops: TimelineOp[] = [
  { type: 'Sketch', id: op('so1'), name: 'Sketch1', suppressed: false, sketchId: sk('s1') },
  { type: 'Sketch', id: op('so2'), name: 'Sketch2', suppressed: false, sketchId: sk('s2') },
  {
    type: 'Extrude',
    id: op('e1'),
    name: 'Extrude1',
    suppressed: false,
    sketchId: sk('s1'),
    profileIds: [prof('s1:p-aaaa')],
    distanceMm: 10,
    direction: 'one-side',
    distance2Mm: 0,
    operation: 'NewBody',
    targetBodyId: null,
    bodyId: body('b1'),
  },
  {
    type: 'Revolve',
    id: op('r1'),
    name: 'Revolve1',
    suppressed: false,
    sketchId: sk('s2'),
    profileIds: [prof('s2:p-bbbb')],
    axis: { kind: 'origin', axis: 'Z' },
    angleDeg: 360,
    operation: 'NewBody',
    targetBodyId: null,
    bodyId: body('b2'),
  },
  {
    type: 'Fillet',
    id: op('fl1'),
    name: 'Fillet1',
    suppressed: false,
    bodyId: body('b1'),
    edges: [
      { midpoint: [1, 2, 3], direction: [1, 0, 0], adjFaceKinds: ['plane', 'plane'], tolMm: 5 },
    ],
    radiusMm: 2,
  },
  {
    type: 'Chamfer',
    id: op('ch1'),
    name: 'Chamfer1',
    suppressed: true,
    bodyId: body('b2'),
    edges: [{ midpoint: [4, 5, 6], direction: [0, 1, 0], adjFaceKinds: [], tolMm: 2 }],
    distanceMm: 1,
  },
  {
    type: 'Combine',
    id: op('cb1'),
    name: 'Combine1',
    suppressed: false,
    targetBodyId: body('b1'),
    toolBodyIds: [body('b2')],
    operation: 'Join',
    keepTools: false,
  },
  {
    type: 'CopyBody',
    id: op('cp1'),
    name: 'Copy1',
    suppressed: false,
    sourceBodyId: body('b1'),
    translate: [5, 0, 0],
    bodyId: body('b9'),
  },
];

const doc: DocumentState = {
  sketches: [originSketch, faceSketch],
  ops,
  rollbackIndex: ops.length,
  bodyMeta: [{ id: body('b1'), name: 'Base Plate', color: '#ff0000', visible: false }],
  sketchMeta: [{ id: sk('s1'), visible: false }],
};

describe('document XML round-trip', () => {
  it('round-trips the whole document (sketches, face sketch, 7 ops, meta)', () => {
    const xml = documentToXml(doc);
    const parsed = documentFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(doc);
  });

  it('is deterministic (re-emitting the parse is byte-identical)', () => {
    const xml = documentToXml(doc);
    const parsed = documentFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(documentToXml(parsed.value)).toBe(xml);
  });

  it('accepts the current and older schema versions', () => {
    const xml = documentToXml(doc);
    expect(documentFromXml(xml).ok).toBe(true);
    expect(documentFromXml(xml.replace('version="1.0"', 'version="0.9"')).ok).toBe(true);
  });

  it('rejects a newer schema version (ADR-0007, no silent forward data loss)', () => {
    const xml = documentToXml(doc);
    for (const bad of ['1.1', '2.0']) {
      const result = documentFromXml(xml.replace('version="1.0"', `version="${bad}"`));
      expect(result.ok).toBe(false);
    }
  });

  it('rejects malformed document XML with ImportError', () => {
    for (const bad of ['<notNomadim/>', '<nomadim/>']) {
      const result = documentFromXml(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.name).toBe('ImportError');
    }
  });
});
