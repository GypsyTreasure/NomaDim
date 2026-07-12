import { describe, expect, it } from 'vitest';
import type { BodyId, OpId, ProfileId, SketchId } from '../../src/core/ids';
import type {
  ChamferOp,
  CombineOp,
  ExtrudeOp,
  FilletOp,
  RevolveOp,
  SketchOp,
  TimelineData,
} from '../../src/document';
import { timelineFromXml, timelineToXml } from '../../src/document';

/**
 * Timeline codec round-trip (R10): the codec iterates the op registry, so
 * every OpType — Sketch/Extrude/Revolve/Fillet/Chamfer/Combine — must survive
 * model → XML → model unchanged, and timeline ORDER (significant, unlike
 * sketch entities) must be preserved regardless of how the XML parser
 * regroups elements by tag.
 */

const sk = (id: string): SketchId => id as SketchId;
const op = (id: string): OpId => id as OpId;
const body = (id: string): BodyId => id as BodyId;
const prof = (id: string): ProfileId => id as ProfileId;

function sketchOp(id: string, sketchId: string): SketchOp {
  return { type: 'Sketch', id: op(id), name: id, suppressed: false, sketchId: sk(sketchId) };
}

function extrudeOp(overrides: Partial<ExtrudeOp> = {}): ExtrudeOp {
  return {
    type: 'Extrude',
    id: op('e1'),
    name: 'Extrude1',
    suppressed: false,
    sketchId: sk('s1'),
    profileIds: [prof('s1:p-aaaa'), prof('s1:p-bbbb')],
    distanceMm: 12.5,
    direction: 'symmetric',
    distance2Mm: 3,
    operation: 'NewBody',
    targetBodyId: null,
    bodyId: body('b1'),
    ...overrides,
  };
}

function revolveOp(overrides: Partial<RevolveOp> = {}): RevolveOp {
  return {
    type: 'Revolve',
    id: op('r1'),
    name: 'Revolve1',
    suppressed: true,
    sketchId: sk('s1'),
    profileIds: [prof('s1:p-cccc')],
    axis: { kind: 'entity', entityId: 'ln7' as never },
    angleDeg: 270,
    operation: 'Cut',
    targetBodyId: body('b1'),
    bodyId: body('b2'),
    ...overrides,
  };
}

function filletOp(overrides: Partial<FilletOp> = {}): FilletOp {
  return {
    type: 'Fillet',
    id: op('fl1'),
    name: 'Fillet1',
    suppressed: false,
    bodyId: body('b1'),
    edges: [
      {
        midpoint: [1.5, -2.25, 10],
        direction: [1, 0, 0],
        adjFaceKinds: ['cylinder', 'plane'],
        tolMm: 5,
      },
      { midpoint: [0, 0, 0], direction: [0, 0, 1], adjFaceKinds: [], tolMm: 2 },
    ],
    radiusMm: 2.5,
    ...overrides,
  };
}

function chamferOp(overrides: Partial<ChamferOp> = {}): ChamferOp {
  return {
    type: 'Chamfer',
    id: op('ch1'),
    name: 'Chamfer1',
    suppressed: true,
    bodyId: body('b2'),
    edges: [{ midpoint: [5, 5, 5], direction: [0, 1, 0], adjFaceKinds: ['plane', 'plane'], tolMm: 5 }],
    distanceMm: 1.25,
    ...overrides,
  };
}

function combineOp(overrides: Partial<CombineOp> = {}): CombineOp {
  return {
    type: 'Combine',
    id: op('cb1'),
    name: 'Combine1',
    suppressed: false,
    targetBodyId: body('b1'),
    toolBodyIds: [body('b2'), body('b3')],
    operation: 'Cut',
    keepTools: true,
    ...overrides,
  };
}

describe('timeline XML round-trip', () => {
  it('round-trips all three op types and preserves order', () => {
    const data: TimelineData = {
      ops: [sketchOp('so1', 's1'), extrudeOp(), revolveOp()],
      rollbackIndex: 2,
    };
    const xml = timelineToXml(data);
    const parsed = timelineFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(data);
  });

  it('preserves order even when the same op type repeats out of tag grouping', () => {
    // Two sketches interleaved with an extrude — parser groups sketchOps
    // together, so only the index attribute keeps the timeline order.
    const data: TimelineData = {
      ops: [
        sketchOp('so1', 's1'),
        extrudeOp({ id: op('e1'), bodyId: body('b1') }),
        sketchOp('so2', 's2'),
        extrudeOp({ id: op('e2'), sketchId: sk('s2'), bodyId: body('b2'), name: 'Extrude2' }),
      ],
      rollbackIndex: 4,
    };
    const xml = timelineToXml(data);
    const parsed = timelineFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.ops.map((o) => o.id)).toEqual(['so1', 'e1', 'so2', 'e2']);
      expect(parsed.value).toEqual(data);
    }
  });

  it('round-trips origin-axis revolve and two-sides extrude', () => {
    const data: TimelineData = {
      ops: [
        sketchOp('so1', 's1'),
        extrudeOp({ direction: 'two-sides', distanceMm: 5, distance2Mm: 8, operation: 'Join', targetBodyId: body('b0') }),
        revolveOp({ axis: { kind: 'origin', axis: 'Z' }, angleDeg: 360, operation: 'NewBody', targetBodyId: null, suppressed: false }),
      ],
      rollbackIndex: 3,
    };
    const xml = timelineToXml(data);
    const parsed = timelineFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(data);
  });

  it('serialization is deterministic (re-emitting the parse is byte-identical)', () => {
    const data: TimelineData = {
      ops: [sketchOp('so1', 's1'), extrudeOp()],
      rollbackIndex: 1,
    };
    const xml = timelineToXml(data);
    const parsed = timelineFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(timelineToXml(parsed.value)).toBe(xml);
  });

  it('round-trips Fillet/Chamfer/Combine incl. edge fingerprints + tool refs', () => {
    const data: TimelineData = {
      ops: [
        sketchOp('so1', 's1'),
        extrudeOp({ id: op('e1'), bodyId: body('b1') }),
        extrudeOp({ id: op('e2'), bodyId: body('b2'), name: 'Extrude2' }),
        extrudeOp({ id: op('e3'), bodyId: body('b3'), name: 'Extrude3' }),
        combineOp(),
        filletOp(),
        chamferOp(),
      ],
      rollbackIndex: 7,
    };
    const xml = timelineToXml(data);
    const parsed = timelineFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.ops.map((o) => o.id)).toEqual([
        'so1',
        'e1',
        'e2',
        'e3',
        'cb1',
        'fl1',
        'ch1',
      ]);
      expect(parsed.value).toEqual(data);
    }
  });

  it('rejects malformed timeline XML with ImportError', () => {
    for (const bad of [
      '<notTimeline/>',
      '<timeline/>', // missing rollback
      '<timeline rollback="-1"></timeline>',
      '<timeline rollback="99"><sketchOp index="0" id="a" name="a" suppressed="false" sketch="s1"/></timeline>',
    ]) {
      const result = timelineFromXml(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.name).toBe('ImportError');
    }
  });
});
