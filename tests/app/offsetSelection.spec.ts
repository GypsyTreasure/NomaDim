import { describe, it, expect } from 'vitest';
import { offsetSelection } from '../../src/sketch';
import type { Sketch } from '../../src/document';

/**
 * Multi-entity Offset (#2, ADR-0132): offsets a whole selection at once —
 * connected line chains as mitred parallel loops/polylines, circles/arcs
 * concentrically. Side 'a' grows a closed loop / enlarges a circle; 'b' shrinks.
 */
function p(id: string, x: number, y: number) {
  return { id: id as never, x, y };
}
function line(id: string, start: string, end: string) {
  return {
    type: 'line' as const,
    id: id as never,
    start: start as never,
    end: end as never,
    construction: false,
  };
}

/** A welded 10×10 rectangle loop (CCW) sharing four corner points. */
function rectSketch(): Sketch {
  return {
    id: 'sk1' as never,
    plane: { kind: 'origin', plane: 'XY' },
    points: [p('a', 0, 0), p('b', 10, 0), p('c', 10, 10), p('d', 0, 10)],
    entities: [
      line('l1', 'a', 'b'),
      line('l2', 'b', 'c'),
      line('l3', 'c', 'd'),
      line('l4', 'd', 'a'),
    ],
    dimensions: [],
  } as unknown as Sketch;
}

function circleSketch(): Sketch {
  return {
    id: 'sk1' as never,
    plane: { kind: 'origin', plane: 'XY' },
    points: [p('c', 0, 0)],
    entities: [{ type: 'circle', id: 'c1' as never, center: 'c' as never, r: 5, construction: false }],
    dimensions: [],
  } as unknown as Sketch;
}

/** Bounding box of a delta's new points. */
function bbox(pts: readonly { x: number; y: number }[]) {
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('offsetSelection', () => {
  it('offsets a closed rectangle loop inward (side b) as a smaller welded loop', () => {
    const sketch = rectSketch();
    const ids = ['l1', 'l2', 'l3', 'l4'] as never[];
    const delta = offsetSelection(sketch, ids, 2, 'b');
    expect(delta).not.toBeNull();
    if (!delta) return;
    // Four mitred corners → four shared points, four connected lines.
    expect(delta.entities).toHaveLength(4);
    expect(delta.points).toHaveLength(4);
    expect(delta.entities.every((e) => e.type === 'line')).toBe(true);
    const box = bbox(delta.points);
    // Inset by 2 mm on every side: 10×10 → 6×6 from (2,2) to (8,8).
    expect(box.minX).toBeCloseTo(2, 6);
    expect(box.minY).toBeCloseTo(2, 6);
    expect(box.maxX).toBeCloseTo(8, 6);
    expect(box.maxY).toBeCloseTo(8, 6);
  });

  it('offsets a rectangle loop outward (side a) as a larger loop', () => {
    const delta = offsetSelection(rectSketch(), ['l1', 'l2', 'l3', 'l4'] as never[], 2, 'a');
    expect(delta).not.toBeNull();
    if (!delta) return;
    const box = bbox(delta.points);
    // Grown by 2 mm on every side: from (-2,-2) to (12,12).
    expect(box.minX).toBeCloseTo(-2, 6);
    expect(box.maxX).toBeCloseTo(12, 6);
    expect(box.minY).toBeCloseTo(-2, 6);
    expect(box.maxY).toBeCloseTo(12, 6);
  });

  it('offsets a circle concentrically (a grows, b shrinks)', () => {
    const grow = offsetSelection(circleSketch(), ['c1'] as never[], 3, 'a');
    const shrink = offsetSelection(circleSketch(), ['c1'] as never[], 3, 'b');
    expect(grow?.entities[0]).toMatchObject({ type: 'circle', r: 8 });
    expect(shrink?.entities[0]).toMatchObject({ type: 'circle', r: 2 });
  });

  it('drops a circle that would collapse to a non-positive radius', () => {
    expect(offsetSelection(circleSketch(), ['c1'] as never[], 5, 'b')).toBeNull();
  });

  it('returns null for a non-positive distance or empty selection', () => {
    expect(offsetSelection(rectSketch(), ['l1'] as never[], 0, 'a')).toBeNull();
    expect(offsetSelection(rectSketch(), [] as never[], 2, 'a')).toBeNull();
  });
});
