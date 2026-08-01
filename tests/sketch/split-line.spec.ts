import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core';
import type { Sketch, SketchEntity, SketchPoint } from '../../src/document';
import { planLineSplit } from '../../src/sketch';

/**
 * Split-line-by-lines (#6, ADR-0099): a picked line is divided wherever other
 * lines cross it, with a SHARED joint point at each crossing (real topology).
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

describe('planLineSplit', () => {
  it('splits a horizontal line where a vertical line crosses its interior', () => {
    // Horizontal e1 (0,0)→(10,0); vertical e2 (5,-5)→(5,5) crosses at (5,0).
    const sketch = sketchWith(
      [pt('a', 0, 0), pt('b', 10, 0), pt('c', 5, -5), pt('d', 5, 5)],
      [line('e1', 'a', 'b'), line('e2', 'c', 'd')]
    );
    const plan = planLineSplit(sketch, eid('e1'));
    expect(plan).not.toBeNull();
    if (!plan) return;
    // One new joint point at (5,0).
    expect(plan.addPoints).toHaveLength(1);
    expect(plan.addPoints[0]?.x).toBeCloseTo(5);
    expect(plan.addPoints[0]?.y).toBeCloseTo(0);
    // The crossing is interior to BOTH lines → both are split (mutual joint):
    // e1 → 2, e2 → 2. removeEntityIds = [e1, e2]; addEntities = 4 lines.
    expect([...plan.removeEntityIds].sort()).toEqual(['e1', 'e2']);
    expect(plan.addEntities).toHaveLength(4);
    // Every new line references the shared joint point on at least one end.
    const joint = plan.addPoints[0]?.id;
    const touching = plan.addEntities.filter(
      (e) => e.type === 'line' && (e.start === joint || e.end === joint)
    );
    expect(touching).toHaveLength(4);
  });

  it('reuses an existing endpoint as the joint for a T-junction (no new point)', () => {
    // e1 (0,0)→(10,0); e2 endpoint (5,0)→(5,5) meets e1's interior at its own
    // endpoint → e1 splits at the SHARED point c, e2 is untouched.
    const sketch = sketchWith(
      [pt('a', 0, 0), pt('b', 10, 0), pt('c', 5, 0), pt('d', 5, 5)],
      [line('e1', 'a', 'b'), line('e2', 'c', 'd')]
    );
    const plan = planLineSplit(sketch, eid('e1'));
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.addPoints).toHaveLength(0); // reused existing point c
    expect([...plan.removeEntityIds]).toEqual(['e1']); // only the target splits
    expect(plan.addEntities).toHaveLength(2);
    // Both halves share the existing point c → real joint with e2.
    for (const e of plan.addEntities) {
      if (e.type === 'line') expect(e.start === 'c' || e.end === 'c').toBe(true);
    }
  });

  it('returns null when nothing crosses the line', () => {
    const sketch = sketchWith(
      [pt('a', 0, 0), pt('b', 10, 0), pt('c', 0, 5), pt('d', 10, 5)],
      [line('e1', 'a', 'b'), line('e2', 'c', 'd')] // parallel, never meet
    );
    expect(planLineSplit(sketch, eid('e1'))).toBeNull();
  });

  it('ignores a crossing that lies beyond the crossing line segment', () => {
    // e2 (5,2)→(5,5) is vertical but does not reach y=0, so it never touches e1.
    const sketch = sketchWith(
      [pt('a', 0, 0), pt('b', 10, 0), pt('c', 5, 2), pt('d', 5, 5)],
      [line('e1', 'a', 'b'), line('e2', 'c', 'd')]
    );
    expect(planLineSplit(sketch, eid('e1'))).toBeNull();
  });

  it('splits at two crossings in order along the line', () => {
    // e1 (0,0)→(30,0); crossers at x=10 and x=20 (endpoints on e1 → reused).
    const sketch = sketchWith(
      [
        pt('a', 0, 0),
        pt('b', 30, 0),
        pt('p1', 10, 0),
        pt('q1', 10, 5),
        pt('p2', 20, 0),
        pt('q2', 20, 5),
      ],
      [line('e1', 'a', 'b'), line('e2', 'p1', 'q1'), line('e3', 'p2', 'q2')]
    );
    const plan = planLineSplit(sketch, eid('e1'));
    expect(plan).not.toBeNull();
    if (!plan) return;
    // e1 → three segments (a→p1→p2→b); crossers reuse their endpoints.
    expect([...plan.removeEntityIds]).toEqual(['e1']);
    expect(plan.addEntities).toHaveLength(3);
  });
});
