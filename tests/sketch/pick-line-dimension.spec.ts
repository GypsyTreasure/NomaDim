import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core';
import type { Sketch, SketchEntity, SketchPoint } from '../../src/document';
import { pickLineDimension, linearKindFromSpan } from '../../src/sketch';

/**
 * Line-pick dimensioning (#6c): clicking a line (not its endpoints) dimensions
 * its length between its two endpoints; the kind follows the tool setting, with
 * `auto`/radius/diameter falling back to the horizontal-vs-vertical span rule.
 */

const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

function sketchWith(points: SketchPoint[], entities: SketchEntity[]): Sketch {
  return {
    id: 'sk1' as SketchId,
    name: 'S',
    plane: { kind: 'origin', plane: 'XY' },
    points,
    entities,
    constraints: [],
    dimensions: [],
  };
}

const pt = (id: string, x: number, y: number): SketchPoint => ({ id: pid(id), x, y });
const line = (id: string, start: string, end: string): SketchEntity => ({
  type: 'line',
  id: eid(id),
  start: pid(start),
  end: pid(end),
  construction: false,
});

// A 10mm-long horizontal line a→b, and a vertical line c→d.
const horizontal = sketchWith([pt('a', 0, 0), pt('b', 10, 0)], [line('e1', 'a', 'b')]);
const vertical = sketchWith([pt('c', 0, 0), pt('d', 0, 10)], [line('e2', 'c', 'd')]);

describe('pickLineDimension', () => {
  it('dimensions the nearest line between its endpoints, auto → horizontal', () => {
    const pick = pickLineDimension(horizontal, { x: 5, y: 0.1 }, 1, 'auto');
    expect(pick).toEqual({ a: 'a', b: 'b', kind: 'horizontal' });
  });

  it('auto resolves a vertical line to vertical', () => {
    const pick = pickLineDimension(vertical, { x: 0.1, y: 5 }, 1, 'auto');
    expect(pick).toEqual({ a: 'c', b: 'd', kind: 'vertical' });
  });

  it('keeps an explicit aligned (linear) kind', () => {
    const pick = pickLineDimension(horizontal, { x: 5, y: 0.1 }, 1, 'linear');
    expect(pick?.kind).toBe('linear');
  });

  it('falls back to the span rule for the circle-only radius/diameter kinds', () => {
    expect(pickLineDimension(horizontal, { x: 5, y: 0 }, 1, 'radius')?.kind).toBe('horizontal');
    expect(pickLineDimension(horizontal, { x: 5, y: 0 }, 1, 'diameter')?.kind).toBe('horizontal');
  });

  it('returns null when no line is within tolerance', () => {
    expect(pickLineDimension(horizontal, { x: 5, y: 50 }, 1, 'auto')).toBeNull();
  });

  it('linearKindFromSpan picks the dominant axis', () => {
    expect(linearKindFromSpan({ x: 0, y: 0 }, { x: 10, y: 1 })).toBe('horizontal');
    expect(linearKindFromSpan({ x: 0, y: 0 }, { x: 1, y: 10 })).toBe('vertical');
  });
});
