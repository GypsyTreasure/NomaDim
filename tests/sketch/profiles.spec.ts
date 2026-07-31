import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core/ids';
import type { Sketch, SketchEntity, SketchPoint } from '../../src/document';
import { detectProfiles, profileIdFor } from '../../src/sketch';

const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;
const skId = 'sk1' as SketchId;

function sketchWith(points: SketchPoint[], entities: SketchEntity[]): Sketch {
  return {
    id: skId,
    name: 'S',
    plane: { kind: 'origin', plane: 'XY' },
    points,
    entities,
    constraints: [],
    dimensions: [],
  };
}

const pt = (id: string, x: number, y: number): SketchPoint => ({ id: pid(id), x, y });
const line = (id: string, start: string, end: string, construction = false): SketchEntity => ({
  type: 'line',
  id: eid(id),
  start: pid(start),
  end: pid(end),
  construction,
});

/** 40x20 rectangle out of four lines. */
function rectangle(): { points: SketchPoint[]; entities: SketchEntity[] } {
  return {
    points: [pt('a', 0, 0), pt('b', 40, 0), pt('c', 40, 20), pt('d', 0, 20)],
    entities: [
      line('e1', 'a', 'b'),
      line('e2', 'b', 'c'),
      line('e3', 'c', 'd'),
      line('e4', 'd', 'a'),
    ],
  };
}

describe('detectProfiles', () => {
  it('finds a rectangle as one closed profile with correct area', () => {
    const { points, entities } = rectangle();
    const result = detectProfiles(sketchWith(points, entities));
    expect(result.profiles).toHaveLength(1);
    expect(result.openEntityIds).toHaveLength(0);
    const profile = result.profiles[0];
    expect(profile?.outer.area).toBeCloseTo(800, 6);
    expect(profile?.inner).toHaveLength(0);
    expect([...(profile?.outer.entityIds ?? [])].sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('plate with hole: rectangle + circle inside = ring profile with inner loop, plus the disk (M2 acceptance)', () => {
    const { points, entities } = rectangle();
    const sketch = sketchWith(
      [...points, pt('cc', 20, 10)],
      [...entities, { type: 'circle', id: eid('e5'), center: pid('cc'), r: 4, construction: false }]
    );
    const result = detectProfiles(sketch);
    expect(result.profiles).toHaveLength(2);

    const ring = result.profiles.find((p) => p.inner.length === 1);
    const disk = result.profiles.find((p) => p.inner.length === 0);
    expect(ring).toBeDefined();
    expect(disk).toBeDefined();
    expect(ring?.inner[0]?.entityIds).toEqual(['e5']);
    expect(disk?.outer.entityIds).toEqual(['e5']);
    expect(disk?.outer.area).toBeCloseTo(Math.PI * 16, 3);
    // R7a: ring id hashes outer + inner entity sets.
    expect(ring?.id).toBe(
      profileIdFor(skId, [eid('e1'), eid('e2'), eid('e3'), eid('e4'), eid('e5')])
    );
  });

  it('a shared internal edge splits a rectangle into two profiles', () => {
    const { points, entities } = rectangle();
    // Vertical chord through the middle, sharing midpoints on top/bottom edges
    // would need entity splitting — instead build two adjacent rectangles
    // sharing the edge m1-m2 (endpoint topology only, ADR scope).
    const sketch = sketchWith(
      [
        pt('a', 0, 0),
        pt('m1', 20, 0),
        pt('b', 40, 0),
        pt('c', 40, 20),
        pt('m2', 20, 20),
        pt('d', 0, 20),
      ],
      [
        line('e1', 'a', 'm1'),
        line('e2', 'm1', 'b'),
        line('e3', 'b', 'c'),
        line('e4', 'c', 'm2'),
        line('e5', 'm2', 'd'),
        line('e6', 'd', 'a'),
        line('e7', 'm1', 'm2'), // shared chord
      ]
    );
    void points;
    void entities;
    const result = detectProfiles(sketch);
    expect(result.profiles).toHaveLength(2);
    expect(result.openEntityIds).toHaveLength(0);
    for (const profile of result.profiles) {
      expect(profile.outer.area).toBeCloseTo(400, 6);
      expect(profile.outer.entityIds).toContain('e7'); // chord borders both
    }
    // Different regions → different entity sets → different ids (R7a).
    expect(result.profiles[0]?.id).not.toBe(result.profiles[1]?.id);
  });

  it('flags open contours and dangling tails without breaking closed loops', () => {
    const { points, entities } = rectangle();
    const sketch = sketchWith(
      [...points, pt('t1', 40, 20), pt('t2', 60, 30), pt('u1', 100, 0), pt('u2', 120, 0)],
      [
        ...entities,
        line('e5', 'c', 't2'), // tail off the rectangle corner
        line('e6', 'u1', 'u2'), // isolated open segment
      ]
    );
    const result = detectProfiles(sketch);
    expect(result.profiles).toHaveLength(1);
    expect([...result.openEntityIds].sort()).toEqual(['e5', 'e6']);
  });

  it('groups connected open lines into a single ordered open profile (#12)', () => {
    // An open L: (0,0)→(20,0)→(20,20). Not closed → no closed profile, but one
    // open chain surface-swept as a wire.
    const sketch = sketchWith(
      [pt('a', 0, 0), pt('b', 20, 0), pt('c', 20, 20)],
      [line('e1', 'a', 'b'), line('e2', 'b', 'c')]
    );
    const result = detectProfiles(sketch);
    expect(result.profiles).toHaveLength(0);
    expect(result.openProfiles).toHaveLength(1);
    const open = result.openProfiles[0];
    expect(open?.open).toBe(true);
    expect(open?.outer.area).toBe(0);
    expect(open?.outer.segments).toHaveLength(2);
    expect([...(open?.outer.entityIds ?? [])].sort()).toEqual(['e1', 'e2']);
    // Ordered end-to-end: first segment starts at (0,0), last ends at (20,20).
    const segs = open?.outer.segments ?? [];
    const firstSeg = segs[0];
    const lastSeg = segs[segs.length - 1];
    if (firstSeg?.kind === 'line') {
      expect(firstSeg.a.x).toBe(0);
      expect(firstSeg.a.y).toBe(0);
    }
    if (lastSeg?.kind === 'line') {
      expect(lastSeg.b.x).toBe(20);
      expect(lastSeg.b.y).toBe(20);
    }
    // Same id from the same entity set on re-detection (R7a, stable persistence).
    expect(open?.id).toBe(profileIdFor(skId, [eid('e1'), eid('e2')]));
  });

  it('a single open line is a valid open profile (#12)', () => {
    const sketch = sketchWith([pt('a', 0, 0), pt('b', 30, 0)], [line('e1', 'a', 'b')]);
    const result = detectProfiles(sketch);
    expect(result.profiles).toHaveLength(0);
    expect(result.openProfiles).toHaveLength(1);
    expect(result.openProfiles[0]?.outer.segments).toHaveLength(1);
  });

  it('closed profiles produce no open profiles (closed path unchanged)', () => {
    const { points, entities } = rectangle();
    const result = detectProfiles(sketchWith(points, entities));
    expect(result.profiles).toHaveLength(1);
    expect(result.openProfiles).toHaveLength(0);
  });

  it('construction geometry participates in nothing', () => {
    const { points, entities } = rectangle();
    const sketch = sketchWith([...points, pt('cc', 20, 10)], [
      ...entities.map((e) => ({ ...e, construction: true })),
      { type: 'circle', id: eid('e5'), center: pid('cc'), r: 4, construction: false },
    ] as SketchEntity[]);
    const result = detectProfiles(sketch);
    expect(result.profiles).toHaveLength(1); // just the circle disk
    expect(result.profiles[0]?.outer.entityIds).toEqual(['e5']);
  });

  it('closed arc+line loop (rounded shape) forms a profile', () => {
    // Half-disc: line from (-10,0) to (10,0), CCW arc back over the top.
    const sketch = sketchWith(
      [pt('c', 0, 0), pt('l', -10, 0), pt('r', 10, 0)],
      [
        line('e1', 'l', 'r'),
        {
          type: 'arc',
          id: eid('e2'),
          center: pid('c'),
          start: pid('r'),
          end: pid('l'),
          ccw: true,
          construction: false,
        },
      ]
    );
    const result = detectProfiles(sketch);
    expect(result.profiles).toHaveLength(1);
    expect(result.openEntityIds).toHaveLength(0);
    // Sampled-polygon area (inscribed) — within 1.5% of the exact half-disc.
    const exact = (Math.PI * 100) / 2;
    const area = result.profiles[0]?.outer.area ?? 0;
    expect(Math.abs(area - exact) / exact).toBeLessThan(0.015);
  });

  it('profile ids are stable under geometric edits but change with the entity set (R7a)', () => {
    const { points, entities } = rectangle();
    const before = detectProfiles(sketchWith(points, entities));
    // Geometric edit: stretch the rectangle — same entities, same id.
    const stretched = points.map((p) => (p.x === 40 ? { ...p, x: 80 } : p));
    const after = detectProfiles(sketchWith(stretched, entities));
    expect(after.profiles[0]?.id).toBe(before.profiles[0]?.id);
    expect(after.profiles[0]?.outer.area).toBeCloseTo(1600, 6);
  });

  it('two disjoint rectangles yield two independent profiles', () => {
    const sketch = sketchWith(
      [
        pt('a', 0, 0),
        pt('b', 10, 0),
        pt('c', 10, 10),
        pt('d', 0, 10),
        pt('e', 100, 0),
        pt('f', 110, 0),
        pt('g', 110, 10),
        pt('h', 100, 10),
      ],
      [
        line('e1', 'a', 'b'),
        line('e2', 'b', 'c'),
        line('e3', 'c', 'd'),
        line('e4', 'd', 'a'),
        line('e5', 'e', 'f'),
        line('e6', 'f', 'g'),
        line('e7', 'g', 'h'),
        line('e8', 'h', 'e'),
      ]
    );
    const result = detectProfiles(sketch);
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles.every((p) => p.inner.length === 0)).toBe(true);
  });
});
