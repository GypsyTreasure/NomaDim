import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core/ids';
import { emptySketch, type Sketch, type SketchPoint } from '../../src/document';
import { connectedEntityIds, entityPointIds } from '../../src/app/features/sketcher/shapeSelection';

const skId = 'sk1' as SketchId;
const pt = (id: string, x: number, y: number): SketchPoint => ({ id: id as PointId, x, y });
const eid = (id: string): EntityId => id as EntityId;
const pid = (id: string): PointId => id as PointId;

/** A 20×20 square (4 lines sharing corners) plus a standalone circle. */
function sketchWithSquareAndCircle(): Sketch {
  return {
    ...emptySketch(skId, 'Sketch1', { kind: 'origin', plane: 'XY' }),
    points: [pt('a', 0, 0), pt('b', 20, 0), pt('c', 20, 20), pt('d', 0, 20), pt('k', 100, 100)],
    entities: [
      { type: 'line', id: eid('s1'), start: pid('a'), end: pid('b'), construction: false },
      { type: 'line', id: eid('s2'), start: pid('b'), end: pid('c'), construction: false },
      { type: 'line', id: eid('s3'), start: pid('c'), end: pid('d'), construction: false },
      { type: 'line', id: eid('s4'), start: pid('d'), end: pid('a'), construction: false },
      { type: 'circle', id: eid('cir'), center: pid('k'), r: 5, construction: false },
    ],
  };
}

describe('entityPointIds', () => {
  it('lists a line’s endpoints and a circle’s centre', () => {
    const sk = sketchWithSquareAndCircle();
    const line = sk.entities.find((e) => e.id === eid('s1'));
    const circle = sk.entities.find((e) => e.id === eid('cir'));
    expect(line && entityPointIds(line)).toEqual([pid('a'), pid('b')]);
    expect(circle && entityPointIds(circle)).toEqual([pid('k')]);
  });
});

describe('connectedEntityIds (whole-shape selection, #3)', () => {
  it('groups all four sides of a square from any one side', () => {
    const sk = sketchWithSquareAndCircle();
    const group = connectedEntityIds(sk, eid('s2')).sort();
    expect(group).toEqual([eid('s1'), eid('s2'), eid('s3'), eid('s4')]);
  });

  it('returns just the entity for a disconnected shape (circle)', () => {
    const sk = sketchWithSquareAndCircle();
    expect(connectedEntityIds(sk, eid('cir'))).toEqual([eid('cir')]);
  });

  it('returns empty for an unknown entity', () => {
    expect(connectedEntityIds(sketchWithSquareAndCircle(), eid('nope'))).toEqual([]);
  });
});
