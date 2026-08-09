import { describe, it, expect } from 'vitest';
import { groupEntities } from '../../src/sketch';
import { connectedEntityIds } from '../../src/app/features/sketcher/shapeSelection';
import type { Sketch } from '../../src/document';

/**
 * Group / Join (ADR-0135), the inverse of Explode: welds the selected entities'
 * coincident endpoints into SHARED points so touching lines become one connected
 * shape. Here four lines meet at four corners but each has PRIVATE endpoints (as
 * if just exploded) → after Group they share four corner points and select as one.
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

/** Four unwelded lines forming a 10×5 rectangle: 8 private points, coincident in pairs. */
function unweldedRect(): Sketch {
  return {
    id: 'sk1' as never,
    plane: { kind: 'origin', plane: 'XY' },
    points: [
      p('a1', 0, 0),
      p('b1', 10, 0),
      p('b2', 10, 0),
      p('c1', 10, 5),
      p('c2', 10, 5),
      p('d1', 0, 5),
      p('d2', 0, 5),
      p('a2', 0, 0),
    ],
    entities: [
      line('l1', 'a1', 'b1'),
      line('l2', 'b2', 'c1'),
      line('l3', 'c2', 'd1'),
      line('l4', 'd2', 'a2'),
    ],
    dimensions: [],
  } as unknown as Sketch;
}

describe('groupEntities', () => {
  it('welds coincident endpoints so the lines become one connected shape', () => {
    const sketch = unweldedRect();
    // Before: each line stands alone (private endpoints, nothing shared).
    expect(connectedEntityIds(sketch, 'l1' as never)).toEqual(['l1']);

    const result = groupEntities(sketch, ['l1', 'l2', 'l3', 'l4'] as never[]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.removeEntityIds).toHaveLength(4);
    expect(result.add.entities).toHaveLength(4);
    // 8 private endpoints collapse to 4 shared corner points.
    expect(result.add.points).toHaveLength(4);

    const grouped: Sketch = {
      ...sketch,
      points: result.add.points,
      entities: result.add.entities,
    };
    // After: all four lines are one connected shape.
    const first = result.add.entities[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(connectedEntityIds(grouped, first.id).sort()).toEqual(
      result.add.entities.map((e) => e.id).sort()
    );
  });

  it('preserves coordinates (geometry unchanged)', () => {
    const result = groupEntities(unweldedRect(), ['l1', 'l2', 'l3', 'l4'] as never[]);
    const coords = new Set(result?.add.points.map((q) => `${String(q.x)},${String(q.y)}`));
    expect(coords).toEqual(new Set(['0,0', '10,0', '10,5', '0,5']));
  });

  it('returns null with fewer than two entities (nothing to join)', () => {
    expect(groupEntities(unweldedRect(), ['l1'] as never[])).toBeNull();
    expect(groupEntities(unweldedRect(), [] as never[])).toBeNull();
  });
});
