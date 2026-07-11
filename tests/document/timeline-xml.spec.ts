import { describe, expect, it } from 'vitest';
import type { BodyId, OpId, ProfileId, SketchId } from '../../src/core/ids';
import type { ExtrudeOp, RevolveOp, SketchOp, TimelineData } from '../../src/document';
import { timelineFromXml, timelineToXml } from '../../src/document';

/**
 * Timeline codec round-trip (R10): the codec iterates the op registry, so
 * every OpType — Sketch, Extrude, Revolve — must survive model → XML → model
 * unchanged, and timeline ORDER (significant, unlike sketch entities) must be
 * preserved regardless of how the XML parser regroups elements by tag.
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
