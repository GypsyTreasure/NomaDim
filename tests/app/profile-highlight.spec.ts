import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, ProfileId, SketchId } from '../../src/core';
import type { Sketch } from '../../src/document';
import { detectProfiles } from '../../src/sketch';
import { computeProfileHighlight } from '../../src/app/features/timeline/dialogData';

/**
 * Op-selection highlight (F3): the pure derivation that feeds the viewport —
 * selected profile loops (outer + holes) and an optional revolve axis, in
 * sketch-local coordinates on the sketch's plane.
 */

const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

/** A 10×10 square on XY, plus a vertical axis line down the middle. */
function squareSketch(): Sketch {
  return {
    id: 'sk1' as SketchId,
    name: 'S',
    plane: { kind: 'origin', plane: 'XY' },
    points: [
      { id: pid('a'), x: 0, y: 0 },
      { id: pid('b'), x: 10, y: 0 },
      { id: pid('c'), x: 10, y: 10 },
      { id: pid('d'), x: 0, y: 10 },
      { id: pid('m0'), x: 5, y: -5 },
      { id: pid('m1'), x: 5, y: 15 },
    ],
    entities: [
      { type: 'line', id: eid('l1'), start: pid('a'), end: pid('b'), construction: false },
      { type: 'line', id: eid('l2'), start: pid('b'), end: pid('c'), construction: false },
      { type: 'line', id: eid('l3'), start: pid('c'), end: pid('d'), construction: false },
      { type: 'line', id: eid('l4'), start: pid('d'), end: pid('a'), construction: false },
      {
        type: 'line',
        id: eid('ax'),
        start: pid('m0'),
        end: pid('m1'),
        construction: true,
        axis: true,
      },
    ],
    constraints: [],
    dimensions: [],
  };
}

describe('computeProfileHighlight', () => {
  it('returns the selected profile loop on the sketch plane', () => {
    const sketch = squareSketch();
    const profile = detectProfiles(sketch).profiles[0];
    expect(profile).toBeDefined();
    if (!profile) return;

    const hl = computeProfileHighlight(sketch, new Set([profile.id]), [profile], null);
    expect(hl).not.toBeNull();
    expect(hl?.plane).toBe('XY');
    expect(hl?.loops).toHaveLength(1);
    expect(hl?.loops[0]?.length ?? 0).toBeGreaterThan(2);
    expect(hl?.axis).toBeNull();
  });

  it('emits no loops when nothing is selected', () => {
    const sketch = squareSketch();
    const profile = detectProfiles(sketch).profiles[0];
    if (!profile) return;
    const hl = computeProfileHighlight(sketch, new Set<ProfileId>(), [profile], null);
    expect(hl?.loops).toHaveLength(0);
  });

  it('includes the axis line endpoints when an axis entity is given', () => {
    const sketch = squareSketch();
    const hl = computeProfileHighlight(sketch, new Set<ProfileId>(), [], eid('ax'));
    expect(hl?.axis).toEqual([
      { x: 5, y: -5 },
      { x: 5, y: 15 },
    ]);
  });
});
