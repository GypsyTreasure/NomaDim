import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core/ids';
import { nearlyEqual, nearlyEqualVec, vec2 } from '../../src/core/math';
import type { Sketch } from '../../src/document';
import {
  angleOnArc,
  closestPointOnCurve,
  curveMidpoint,
  evaluateSketch,
  intersectCurves,
  quadrantPoints,
  sampleCurve,
  type ArcCurve,
  type CircleCurve,
  type SegmentCurve,
} from '../../src/sketch';

const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

const seg = (ax: number, ay: number, bx: number, by: number): SegmentCurve => ({
  kind: 'segment',
  a: vec2(ax, ay),
  b: vec2(bx, by),
});
const circle = (cx: number, cy: number, r: number): CircleCurve => ({
  kind: 'circle',
  center: vec2(cx, cy),
  r,
});

describe('evaluateSketch', () => {
  it('evaluates lines, circles, and canonicalizes CW arcs to CCW', () => {
    const sketch: Sketch = {
      id: 'sk1' as SketchId,
      name: 'S',
      plane: { kind: 'origin', plane: 'XY' },
      points: [
        { id: pid('a'), x: 0, y: 0 },
        { id: pid('b'), x: 10, y: 0 },
        { id: pid('c'), x: 5, y: 5 },
        { id: pid('s'), x: 10, y: 5 },
        { id: pid('e'), x: 5, y: 10 },
      ],
      entities: [
        { type: 'line', id: eid('l1'), start: pid('a'), end: pid('b'), construction: false },
        { type: 'circle', id: eid('c1'), center: pid('c'), r: 3, construction: false },
        // CW arc from s to e about c === CCW arc from e to s.
        {
          type: 'arc',
          id: eid('a1'),
          center: pid('c'),
          start: pid('s'),
          end: pid('e'),
          ccw: false,
          construction: false,
        },
      ],
      constraints: [],
      dimensions: [],
    };

    const evaluated = evaluateSketch(sketch);
    expect(evaluated).toHaveLength(3);

    const arc = evaluated[2]?.curve;
    expect(arc?.kind).toBe('arc');
    if (arc?.kind === 'arc') {
      expect(nearlyEqual(arc.r, 5)).toBe(true);
      // CCW from e (90°) sweeping to s (0°) is a 270° sweep.
      expect(nearlyEqual(arc.startAngle, Math.PI / 2)).toBe(true);
      expect(nearlyEqual(arc.sweep, (3 * Math.PI) / 2)).toBe(true);
    }
  });
});

describe('closestPointOnCurve', () => {
  it('projects onto segments with clamping', () => {
    const s = seg(0, 0, 10, 0);
    expect(nearlyEqualVec(closestPointOnCurve(s, vec2(4, 3)), vec2(4, 0))).toBe(true);
    expect(nearlyEqualVec(closestPointOnCurve(s, vec2(-5, 3)), vec2(0, 0))).toBe(true);
    expect(nearlyEqualVec(closestPointOnCurve(s, vec2(15, -2)), vec2(10, 0))).toBe(true);
  });

  it('projects onto circles radially', () => {
    const c = circle(0, 0, 5);
    expect(nearlyEqualVec(closestPointOnCurve(c, vec2(10, 0)), vec2(5, 0))).toBe(true);
  });

  it('clamps arc projections to the nearer endpoint off-sweep', () => {
    const arc: ArcCurve = {
      kind: 'arc',
      center: vec2(0, 0),
      r: 5,
      startAngle: 0,
      sweep: Math.PI / 2,
    };
    // 45° is on the sweep.
    const on = closestPointOnCurve(arc, vec2(10, 10));
    expect(nearlyEqualVec(on, vec2(5 / Math.SQRT2, 5 / Math.SQRT2), 1e-9)).toBe(true);
    // -80° is off the sweep; nearest endpoint is (5, 0).
    const off = closestPointOnCurve(arc, vec2(1, -8));
    expect(nearlyEqualVec(off, vec2(5, 0))).toBe(true);
  });
});

describe('special points', () => {
  it('midpoints of segments and arcs; none for circles', () => {
    expect(curveMidpoint(seg(0, 0, 10, 0))).toEqual(vec2(5, 0));
    const arc: ArcCurve = { kind: 'arc', center: vec2(0, 0), r: 5, startAngle: 0, sweep: Math.PI };
    const mid = curveMidpoint(arc);
    expect(mid && nearlyEqualVec(mid, vec2(0, 5), 1e-9)).toBe(true);
    expect(curveMidpoint(circle(0, 0, 5))).toBeNull();
  });

  it('quadrants of circles, filtered by sweep for arcs', () => {
    expect(quadrantPoints(circle(0, 0, 5))).toHaveLength(4);
    const arc: ArcCurve = { kind: 'arc', center: vec2(0, 0), r: 5, startAngle: 0, sweep: Math.PI };
    const quads = quadrantPoints(arc);
    expect(quads).toHaveLength(3); // 0°, 90°, 180° on-sweep; 270° not
  });
});

describe('intersectCurves', () => {
  it('segment-segment', () => {
    const hits = intersectCurves(seg(0, 0, 10, 10), seg(0, 10, 10, 0));
    expect(hits).toHaveLength(1);
    expect(nearlyEqualVec(hits[0] ?? vec2(0, 0), vec2(5, 5))).toBe(true);
    expect(intersectCurves(seg(0, 0, 1, 0), seg(0, 1, 1, 1))).toHaveLength(0); // parallel
  });

  it('segment-circle secant, tangent, and miss', () => {
    const c = circle(0, 0, 5);
    expect(intersectCurves(seg(-10, 0, 10, 0), c)).toHaveLength(2);
    expect(intersectCurves(seg(-10, 5, 10, 5), c)).toHaveLength(1); // tangent
    expect(intersectCurves(seg(-10, 8, 10, 8), c)).toHaveLength(0);
    expect(intersectCurves(seg(-10, 0, -6, 0), c)).toHaveLength(0); // stops short
  });

  it('circle-circle and arc range filtering', () => {
    const hits = intersectCurves(circle(0, 0, 5), circle(6, 0, 5));
    expect(hits).toHaveLength(2);

    // Upper-half arc of the second circle only keeps the upper intersection.
    const upperArc: ArcCurve = {
      kind: 'arc',
      center: vec2(6, 0),
      r: 5,
      startAngle: 0,
      sweep: Math.PI,
    };
    const filtered = intersectCurves(circle(0, 0, 5), upperArc);
    expect(filtered).toHaveLength(1);
    expect((filtered[0]?.y ?? -1) > 0).toBe(true);
  });
});

describe('sampleCurve', () => {
  it('samples segments as their endpoints', () => {
    expect(sampleCurve(seg(0, 0, 3, 4), 0.01)).toEqual([vec2(0, 0), vec2(3, 4)]);
  });

  it('samples circles within chord tolerance', () => {
    const samples = sampleCurve(circle(0, 0, 10), 0.05);
    expect(samples.length).toBeGreaterThanOrEqual(8);
    for (const p of samples) {
      expect(nearlyEqual(Math.hypot(p.x, p.y), 10, 1e-9)).toBe(true);
    }
  });

  it('arc samples start and end exactly on the endpoints', () => {
    const arc: ArcCurve = {
      kind: 'arc',
      center: vec2(0, 0),
      r: 5,
      startAngle: 0,
      sweep: Math.PI / 2,
    };
    const samples = sampleCurve(arc, 0.01);
    expect(nearlyEqualVec(samples[0] ?? vec2(0, 0), vec2(5, 0), 1e-9)).toBe(true);
    expect(nearlyEqualVec(samples[samples.length - 1] ?? vec2(0, 0), vec2(0, 5), 1e-9)).toBe(true);
  });
});

describe('angleOnArc', () => {
  it('is inclusive at seams', () => {
    const arc: ArcCurve = {
      kind: 'arc',
      center: vec2(0, 0),
      r: 1,
      startAngle: 0,
      sweep: Math.PI / 2,
    };
    expect(angleOnArc(arc, 0)).toBe(true);
    expect(angleOnArc(arc, Math.PI / 2)).toBe(true);
    expect(angleOnArc(arc, Math.PI / 4)).toBe(true);
    expect(angleOnArc(arc, Math.PI)).toBe(false);
  });
});
