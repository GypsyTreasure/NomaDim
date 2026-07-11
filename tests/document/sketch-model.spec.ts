import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core/ids';
import {
  emptySketch,
  entitiesUsingPoint,
  formatRoleRef,
  parseRoleRef,
  referencedPointIds,
  resolveRole,
  validateSketch,
  type ArcEntity,
  type LineEntity,
  type Sketch,
  type SketchPoint,
} from '../../src/document';

const skId = 'sk1' as SketchId;
const pt = (id: string, x: number, y: number): SketchPoint => ({ id: id as PointId, x, y });
const eid = (id: string): EntityId => id as EntityId;
const pid = (id: string): PointId => id as PointId;

function baseSketch(): Sketch {
  return {
    ...emptySketch(skId, 'Sketch1', { kind: 'origin', plane: 'XY' }),
    points: [pt('pt1', 0, 0), pt('pt2', 40, 0), pt('pt3', 20, 10)],
    entities: [
      { type: 'line', id: eid('e1'), start: pid('pt1'), end: pid('pt2'), construction: false },
      { type: 'circle', id: eid('e2'), center: pid('pt3'), r: 5, construction: false },
    ],
  };
}

describe('point roles', () => {
  it('resolves roles to pool ids', () => {
    const line = baseSketch().entities[0] as LineEntity;
    expect(resolveRole(line, 'p1')).toBe('pt1');
    expect(resolveRole(line, 'p2')).toBe('pt2');
    expect(resolveRole(line, 'center')).toBeNull();
  });

  it('enumerates referenced points in canonical order', () => {
    const arc: ArcEntity = {
      type: 'arc',
      id: eid('e9'),
      center: pid('pt3'),
      start: pid('pt1'),
      end: pid('pt2'),
      ccw: true,
      construction: false,
    };
    expect(referencedPointIds(arc)).toEqual(['pt3', 'pt1', 'pt2']);
  });

  it('parses and formats role refs', () => {
    expect(parseRoleRef('e12.p1')).toEqual({ entityId: 'e12', role: 'p1' });
    expect(parseRoleRef('e7.center')).toEqual({ entityId: 'e7', role: 'center' });
    expect(parseRoleRef('nonsense')).toBeNull();
    expect(formatRoleRef({ entityId: eid('e12'), role: 'p1' })).toBe('e12.p1');
  });
});

describe('validateSketch', () => {
  it('accepts a well-formed sketch', () => {
    expect(validateSketch(baseSketch()).ok).toBe(true);
  });

  it('rejects entities referencing missing points', () => {
    const sketch: Sketch = {
      ...baseSketch(),
      entities: [
        { type: 'line', id: eid('e1'), start: pid('ptX'), end: pid('pt2'), construction: false },
      ],
    };
    const result = validateSketch(sketch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('missing point');
  });

  it('rejects duplicate ids', () => {
    const sketch: Sketch = { ...baseSketch(), points: [pt('pt1', 0, 0), pt('pt1', 1, 1)] };
    expect(validateSketch(sketch).ok).toBe(false);
  });

  it('rejects degenerate lines and non-positive circles', () => {
    const degenerate: Sketch = {
      ...baseSketch(),
      entities: [
        { type: 'line', id: eid('e1'), start: pid('pt1'), end: pid('pt1'), construction: false },
      ],
    };
    expect(validateSketch(degenerate).ok).toBe(false);

    const flat: Sketch = {
      ...baseSketch(),
      entities: [{ type: 'circle', id: eid('e2'), center: pid('pt3'), r: 0, construction: false }],
    };
    expect(validateSketch(flat).ok).toBe(false);
  });

  it('rejects arcs whose endpoints are not equidistant from center', () => {
    const sketch: Sketch = {
      ...baseSketch(),
      points: [pt('c', 0, 0), pt('a', 10, 0), pt('b', 0, 11)],
      entities: [
        {
          type: 'arc',
          id: eid('e1'),
          center: pid('c'),
          start: pid('a'),
          end: pid('b'),
          ccw: true,
          construction: false,
        },
      ],
    };
    const result = validateSketch(sketch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('equidistant');
  });

  it('accepts valid arcs', () => {
    const sketch: Sketch = {
      ...baseSketch(),
      points: [pt('c', 0, 0), pt('a', 10, 0), pt('b', 0, 10)],
      entities: [
        {
          type: 'arc',
          id: eid('e1'),
          center: pid('c'),
          start: pid('a'),
          end: pid('b'),
          ccw: true,
          construction: false,
        },
      ],
    };
    expect(validateSketch(sketch).ok).toBe(true);
  });
});

describe('entitiesUsingPoint', () => {
  it('finds all dependents of a pool point', () => {
    const sketch = baseSketch();
    expect(entitiesUsingPoint(sketch, pid('pt1')).map((e) => e.id)).toEqual(['e1']);
    expect(entitiesUsingPoint(sketch, pid('pt3')).map((e) => e.id)).toEqual(['e2']);
  });
});
