import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core/ids';
import { vec2 } from '../../src/core/math';
import type { Sketch } from '../../src/document';
import { mirrorEntities, patternEntities, reflectPoint, rotateAbout } from '../../src/sketch';

/**
 * Sketch Mirror & Pattern geometry engine (#2): pure generation of new pool
 * points + entities from a selection, ready for AddSketchGeometry. Shared points
 * are copied once per instance; mirrored arcs flip ccw.
 */

const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

/** A unit sketch: one line a→b and one arc sharing point b, plus a circle. */
function sampleSketch(): Sketch {
  return {
    id: 'sk' as SketchId,
    name: 'S',
    plane: { kind: 'origin', plane: 'XY' },
    points: [
      { id: pid('a'), x: 1, y: 0 },
      { id: pid('b'), x: 3, y: 0 },
      { id: pid('c'), x: 3, y: 2 },
      { id: pid('cc'), x: 10, y: 10 },
    ],
    entities: [
      { type: 'line', id: eid('l1'), start: pid('a'), end: pid('b'), construction: false },
      {
        type: 'arc',
        id: eid('ar1'),
        center: pid('b'),
        start: pid('b'),
        end: pid('c'),
        ccw: true,
        construction: false,
      },
      { type: 'circle', id: eid('ci1'), center: pid('cc'), r: 4, construction: false },
    ],
    constraints: [],
    dimensions: [],
  };
}

describe('reflectPoint', () => {
  it('reflects across the Y axis (x flips)', () => {
    const r = reflectPoint(vec2(3, 5), vec2(0, 0), vec2(0, 1));
    expect(r.x).toBeCloseTo(-3);
    expect(r.y).toBeCloseTo(5);
  });
  it('reflects across the X axis (y flips)', () => {
    const r = reflectPoint(vec2(3, 5), vec2(0, 0), vec2(1, 0));
    expect(r.x).toBeCloseTo(3);
    expect(r.y).toBeCloseTo(-5);
  });
});

describe('rotateAbout', () => {
  it('rotates 90° CCW about the origin', () => {
    const r = rotateAbout(vec2(1, 0), vec2(0, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });
});

describe('mirrorEntities (#2)', () => {
  it('copies each shared point once and flips arc orientation', () => {
    const sketch = sampleSketch();
    // Mirror the line + arc (which share point b) across the Y axis (x=0 line).
    const delta = mirrorEntities(sketch, new Set([eid('l1'), eid('ar1')]), vec2(0, 0), vec2(0, 1));

    // Points a, b, c → 3 new points (b shared once, not twice).
    expect(delta.points).toHaveLength(3);
    // Mirrored x coordinates are negated.
    const xs = delta.points.map((p) => p.x).sort((m, n) => m - n);
    expect(xs).toEqual([-3, -3, -1]); // a→-1, b→-3, c→-3
    // Two new entities; the arc's ccw is flipped.
    expect(delta.entities).toHaveLength(2);
    const arc = delta.entities.find((e) => e.type === 'arc');
    expect(arc?.type === 'arc' && arc.ccw).toBe(false);
    // New ids don't collide with existing ones.
    for (const p of delta.points) expect(sketch.points.some((sp) => sp.id === p.id)).toBe(false);
  });

  it('preserves shared topology: the mirrored line and arc share one new point', () => {
    const sketch = sampleSketch();
    const delta = mirrorEntities(sketch, new Set([eid('l1'), eid('ar1')]), vec2(0, 0), vec2(0, 1));
    const line = delta.entities.find((e) => e.type === 'line');
    const arc = delta.entities.find((e) => e.type === 'arc');
    // b was the shared endpoint (line.end === arc.center === arc.start).
    if (line?.type === 'line' && arc?.type === 'arc') {
      expect(line.end).toBe(arc.center);
      expect(arc.center).toBe(arc.start);
    }
  });
});

describe('patternEntities (#2)', () => {
  it('linear: count-1 copies at multiples of the step offset', () => {
    const sketch = sampleSketch();
    const delta = patternEntities(sketch, new Set([eid('ci1')]), {
      kind: 'linear',
      count: 3,
      dx: 20,
      dy: 0,
    });
    // 2 extra circles → 2 new centers.
    expect(delta.entities).toHaveLength(2);
    expect(delta.points).toHaveLength(2);
    const centers = delta.points.map((p) => p.x).sort((m, n) => m - n);
    expect(centers).toEqual([30, 50]); // 10+20, 10+40
  });

  it('circular: rotates copies about the center by even steps', () => {
    const sketch = sampleSketch();
    const delta = patternEntities(sketch, new Set([eid('ci1')]), {
      kind: 'circular',
      count: 3,
      center: vec2(0, 0),
      totalAngleRad: Math.PI, // 180° total, step = 90°
    });
    expect(delta.points).toHaveLength(2);
    // cc = (10,10). Rotated 90° → (-10,10); 180° → (-10,-10).
    const at90 = delta.points.find((p) => Math.abs(p.x + 10) < 1e-6 && Math.abs(p.y - 10) < 1e-6);
    const at180 = delta.points.find((p) => Math.abs(p.x + 10) < 1e-6 && Math.abs(p.y + 10) < 1e-6);
    expect(at90).toBeDefined();
    expect(at180).toBeDefined();
  });

  it('circular full turn spaces at 2π/count so no copy lands on the source (#2)', () => {
    const sketch = sampleSketch(); // circle centre at (10,10)
    const delta = patternEntities(sketch, new Set([eid('ci1')]), {
      kind: 'circular',
      count: 4,
      center: vec2(0, 0),
      totalAngleRad: 2 * Math.PI, // full ring → step 90°, copies at 90/180/270 only
    });
    expect(delta.points).toHaveLength(3);
    // None of the copies may coincide with the source centre (the old bug).
    for (const p of delta.points) {
      expect(Math.hypot(p.x - 10, p.y - 10)).toBeGreaterThan(1e-6);
    }
  });

  it('count of 1 produces nothing', () => {
    const sketch = sampleSketch();
    const delta = patternEntities(sketch, new Set([eid('ci1')]), {
      kind: 'linear',
      count: 1,
      dx: 20,
      dy: 0,
    });
    expect(delta.entities).toHaveLength(0);
    expect(delta.points).toHaveLength(0);
  });
});
