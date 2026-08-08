import { describe, it, expect } from 'vitest';
import { explodeEntities } from '../../src/sketch';
import { connectedEntityIds } from '../../src/app/features/sketcher/shapeSelection';
import type { Sketch } from '../../src/document';

/**
 * Explode ("bomb", ADR-0131): un-welds a shape so each entity gets private
 * points and becomes individually selectable. A rectangle (4 lines sharing 4
 * corner points) → 4 lines with 8 private points, no longer one connected shape.
 */
function rectSketch(): Sketch {
  // Four corner points shared by four lines (a welded rectangle).
  const p = (id: string, x: number, y: number) => ({ id: id as never, x, y });
  const line = (id: string, start: string, end: string) => ({
    type: 'line' as const,
    id: id as never,
    start: start as never,
    end: end as never,
    construction: false,
  });
  return {
    id: 'sk1' as never,
    plane: { kind: 'origin', plane: 'XY' },
    points: [p('a', 0, 0), p('b', 10, 0), p('c', 10, 5), p('d', 0, 5)],
    entities: [
      line('l1', 'a', 'b'),
      line('l2', 'b', 'c'),
      line('l3', 'c', 'd'),
      line('l4', 'd', 'a'),
    ],
    dimensions: [],
  } as unknown as Sketch;
}

describe('explodeEntities', () => {
  it('gives every line private points so the shape is no longer connected', () => {
    const sketch = rectSketch();
    // Before: all four lines are one connected shape.
    expect(connectedEntityIds(sketch, 'l1' as never).sort()).toEqual(['l1', 'l2', 'l3', 'l4']);

    const result = explodeEntities(sketch, ['l1', 'l2', 'l3', 'l4'] as never[]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.removeEntityIds).toHaveLength(4);
    expect(result.add.entities).toHaveLength(4);
    // 4 lines × 2 endpoints, none shared → 8 fresh points.
    expect(result.add.points).toHaveLength(8);
    const ids = new Set(result.add.points.map((p) => p.id));
    expect(ids.size).toBe(8);

    // Rebuild an exploded sketch and confirm each line stands alone.
    const exploded: Sketch = {
      ...sketch,
      points: result.add.points,
      entities: result.add.entities,
    };
    for (const e of result.add.entities) {
      expect(connectedEntityIds(exploded, e.id)).toEqual([e.id]);
    }
  });

  it('preserves coordinates (geometry looks identical)', () => {
    const result = explodeEntities(rectSketch(), ['l1'] as never[]);
    expect(result?.add.points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it('returns null when nothing matches', () => {
    expect(explodeEntities(rectSketch(), ['nope'] as never[])).toBeNull();
  });
});
