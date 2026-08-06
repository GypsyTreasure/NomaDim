import { describe, expect, it } from 'vitest';
import { entitiesInMarquee, pointIdsInMarquee } from '../../src/sketch';
import type { EvaluatedEntity } from '../../src/sketch';
import type { EntityId, PointId, Vec2 } from '../../src/core';

const id = (s: string): EntityId => s as EntityId;
const pid = (s: string): PointId => s as PointId;
const v = (x: number, y: number): Vec2 => ({ x, y });

/** A straight segment entity from a→b. */
function seg(entityId: string, a: Vec2, b: Vec2): EvaluatedEntity {
  return {
    entityId: id(entityId),
    construction: false,
    axis: false,
    curve: { kind: 'segment', a, b },
  };
}

/** A circle entity at center, radius r. */
function circle(entityId: string, center: Vec2, r: number): EvaluatedEntity {
  return {
    entityId: id(entityId),
    construction: false,
    axis: false,
    curve: { kind: 'circle', center, r },
  };
}

describe('entitiesInMarquee', () => {
  it('window (crossing=false) selects only wholly-enclosed entities', () => {
    const inside = seg('a', v(2, 2), v(4, 4)); // fully within 0..10
    const straddle = seg('b', v(5, 5), v(20, 20)); // one endpoint outside
    const out = entitiesInMarquee([inside, straddle], v(0, 0), v(10, 10), false);
    expect(out).toEqual([id('a')]);
  });

  it('crossing (crossing=true) selects anything the box touches', () => {
    const inside = seg('a', v(2, 2), v(4, 4));
    const straddle = seg('b', v(5, 5), v(20, 20)); // crosses the right/top edge
    const far = seg('c', v(50, 50), v(60, 60)); // wholly outside
    const out = entitiesInMarquee([inside, straddle, far], v(0, 0), v(10, 10), true);
    expect(out.sort()).toEqual([id('a'), id('b')]);
  });

  it('crossing catches a segment that passes through the box without endpoints inside', () => {
    const through = seg('a', v(-5, 5), v(15, 5)); // spans the box left→right at y=5
    const out = entitiesInMarquee([through], v(0, 0), v(10, 10), true);
    expect(out).toEqual([id('a')]);
  });

  it('a circle fully inside is a window hit; one straddling is only a crossing hit', () => {
    const enclosed = circle('a', v(5, 5), 2); // within 0..10
    const straddling = circle('b', v(9, 9), 3); // rim crosses the box boundary
    expect(entitiesInMarquee([enclosed, straddling], v(0, 0), v(10, 10), false)).toEqual([id('a')]);
    expect(entitiesInMarquee([enclosed, straddling], v(0, 0), v(10, 10), true).sort()).toEqual([
      id('a'),
      id('b'),
    ]);
  });

  it('is drag-direction agnostic in geometry (rect normalized from a/b)', () => {
    const inside = seg('a', v(2, 2), v(4, 4));
    // Same box, corners given bottom-right → top-left.
    const out = entitiesInMarquee([inside], v(10, 10), v(0, 0), false);
    expect(out).toEqual([id('a')]);
  });
});

describe('pointIdsInMarquee (#7 Stretch capture)', () => {
  const points = [
    { id: pid('p1'), x: 2, y: 2 }, // inside
    { id: pid('p2'), x: 9, y: 1 }, // inside
    { id: pid('p3'), x: 20, y: 20 }, // outside
  ];

  it('returns only the pool points inside the box', () => {
    expect(pointIdsInMarquee(points, v(0, 0), v(10, 10)).sort()).toEqual([pid('p1'), pid('p2')]);
  });

  it('is direction agnostic (rect normalized from the two corners)', () => {
    expect(pointIdsInMarquee(points, v(10, 10), v(0, 0)).sort()).toEqual([pid('p1'), pid('p2')]);
  });

  it('returns nothing for an empty box away from all points', () => {
    expect(pointIdsInMarquee(points, v(30, 30), v(40, 40))).toEqual([]);
  });
});
