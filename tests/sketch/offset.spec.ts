import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core/ids';
import { vec2 } from '../../src/core/math';
import type { Sketch, SketchEntity } from '../../src/document';
import { offsetEntity, offsetPreviewCurve } from '../../src/sketch';

/**
 * Sketch Offset (#8): a parallel copy of a line/circle/arc that passes through a
 * "through" point. Pure geometry — line offsets perpendicular; circle/arc offset
 * radially (concentric). Splines/points are unsupported.
 */

const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

function sampleSketch(lineConstruction = false): Sketch {
  return {
    id: 'sk' as SketchId,
    name: 'S',
    plane: { kind: 'origin', plane: 'XY' },
    points: [
      { id: pid('a'), x: 0, y: 0 },
      { id: pid('b'), x: 10, y: 0 }, // horizontal line a→b along y=0
      { id: pid('cc'), x: 0, y: 0 }, // circle centre
      { id: pid('ac'), x: 0, y: 0 }, // arc centre
      { id: pid('as'), x: 4, y: 0 }, // arc start (r=4)
      { id: pid('ae'), x: 0, y: 4 }, // arc end (r=4)
    ],
    entities: [
      {
        type: 'line',
        id: eid('l1'),
        start: pid('a'),
        end: pid('b'),
        construction: lineConstruction,
      },
      { type: 'circle', id: eid('ci1'), center: pid('cc'), r: 5, construction: false },
      {
        type: 'arc',
        id: eid('ar1'),
        center: pid('ac'),
        start: pid('as'),
        end: pid('ae'),
        ccw: true,
        construction: false,
      },
      {
        type: 'spline',
        id: eid('sp1'),
        points: [pid('a'), pid('b')],
        closed: false,
        construction: false,
      },
    ],
    constraints: [],
    dimensions: [],
  };
}

/** Narrowing helper so tests never reach for a non-null assertion. */
function firstEntity(delta: { entities: readonly SketchEntity[] } | null): SketchEntity {
  expect(delta).not.toBeNull();
  const e = delta?.entities[0];
  expect(e).toBeDefined();
  if (!e) throw new Error('no entity');
  return e;
}

describe('offsetEntity — line', () => {
  it('offsets a horizontal line perpendicular to pass through the point', () => {
    const delta = offsetEntity(sampleSketch(), eid('l1'), vec2(5, 3)); // 3 above the line
    expect(delta).not.toBeNull();
    expect(delta?.points).toHaveLength(2);
    for (const p of delta?.points ?? []) expect(p.y).toBeCloseTo(3);
    expect(firstEntity(delta).type).toBe('line');
  });

  it('offsets to the other side when the point is below', () => {
    const delta = offsetEntity(sampleSketch(), eid('l1'), vec2(5, -2));
    for (const p of delta?.points ?? []) expect(p.y).toBeCloseTo(-2);
  });

  it('inherits the construction flag', () => {
    const delta = offsetEntity(sampleSketch(true), eid('l1'), vec2(5, 3));
    expect(firstEntity(delta).construction).toBe(true);
  });
});

describe('offsetEntity — circle', () => {
  it('makes a concentric circle through the point (radius = |centre→through|)', () => {
    const circle = firstEntity(offsetEntity(sampleSketch(), eid('ci1'), vec2(8, 0)));
    expect(circle.type).toBe('circle');
    if (circle.type === 'circle') expect(circle.r).toBeCloseTo(8);
  });

  it('supports an inner offset (point inside the circle)', () => {
    const circle = firstEntity(offsetEntity(sampleSketch(), eid('ci1'), vec2(3, 0)));
    if (circle.type === 'circle') expect(circle.r).toBeCloseTo(3);
  });
});

describe('offsetEntity — arc', () => {
  it('scales the arc radially, preserving the angular extent', () => {
    const delta = offsetEntity(sampleSketch(), eid('ar1'), vec2(6, 0)); // r 4 → 6
    expect(delta?.points).toHaveLength(3); // centre + start + end
    const byId = new Map((delta?.points ?? []).map((p) => [p.id, p]));
    const arc = firstEntity(delta);
    if (arc.type === 'arc') {
      const s = byId.get(arc.start);
      const e = byId.get(arc.end);
      const c = byId.get(arc.center);
      expect(s && c && Math.hypot(s.x - c.x, s.y - c.y)).toBeCloseTo(6);
      expect(e && c && Math.hypot(e.x - c.x, e.y - c.y)).toBeCloseTo(6);
      expect(arc.ccw).toBe(true);
    }
  });
});

describe('offsetEntity — unsupported / degenerate', () => {
  it('returns null for a spline', () => {
    expect(offsetEntity(sampleSketch(), eid('sp1'), vec2(1, 1))).toBeNull();
  });
  it('returns null for a missing entity', () => {
    expect(offsetEntity(sampleSketch(), eid('nope'), vec2(1, 1))).toBeNull();
  });
});

describe('offsetPreviewCurve', () => {
  it('previews a segment offset in evaluated form', () => {
    const c = offsetPreviewCurve({ kind: 'segment', a: vec2(0, 0), b: vec2(10, 0) }, vec2(5, 2));
    expect(c?.kind).toBe('segment');
    if (c?.kind === 'segment') {
      expect(c.a.y).toBeCloseTo(2);
      expect(c.b.y).toBeCloseTo(2);
    }
  });
  it('previews a circle offset (radius through the point)', () => {
    const c = offsetPreviewCurve({ kind: 'circle', center: vec2(0, 0), r: 5 }, vec2(0, 7));
    if (c?.kind === 'circle') expect(c.r).toBeCloseTo(7);
  });
  it('returns null for a spline preview', () => {
    expect(
      offsetPreviewCurve({ kind: 'spline', fit: [], samples: [], closed: false }, vec2(1, 1))
    ).toBeNull();
  });
});
