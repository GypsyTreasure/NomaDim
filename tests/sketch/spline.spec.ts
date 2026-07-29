import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core/ids';
import { emptySketch, sketchFromXml, sketchToXml, type Sketch } from '../../src/document';
import { detectProfiles, evaluateSketch, sampleSpline } from '../../src/sketch';

const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

/** A sketch with a spline through the given fit points. */
function splineSketch(fit: readonly { x: number; y: number }[], closed: boolean): Sketch {
  const base = emptySketch('sk' as SketchId, 'Sketch1', { kind: 'origin', plane: 'XY' });
  return {
    ...base,
    points: fit.map((p, i) => ({ id: pid(`p${String(i)}`), x: p.x, y: p.y })),
    entities: [
      {
        type: 'spline',
        id: eid('s0'),
        points: fit.map((_, i) => pid(`p${String(i)}`)),
        closed,
        construction: false,
      },
    ],
  };
}

describe('sampleSpline', () => {
  it('passes through every fit point', () => {
    const fit = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const samples = sampleSpline(fit, false);
    for (const f of fit) {
      const hit = samples.some((s) => Math.hypot(s.x - f.x, s.y - f.y) < 1e-6);
      expect(hit).toBe(true);
    }
    // The tessellation is denser than the fit points (it's a curve, not a polyline).
    expect(samples.length).toBeGreaterThan(fit.length);
  });

  it('two open points degenerate to a straight segment', () => {
    expect(
      sampleSpline(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        false
      )
    ).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
  });
});

describe('spline entity', () => {
  it('evaluates to a spline curve with samples through the fit points', () => {
    const sketch = splineSketch(
      [
        { x: 0, y: 0 },
        { x: 10, y: 8 },
        { x: 20, y: 0 },
      ],
      false
    );
    const [curve] = evaluateSketch(sketch);
    expect(curve?.curve.kind).toBe('spline');
    if (curve?.curve.kind === 'spline') {
      expect(curve.curve.fit).toHaveLength(3);
      expect(curve.curve.samples.length).toBeGreaterThan(3);
    }
  });

  it('a closed spline is a standalone profile (like a circle)', () => {
    const sketch = splineSketch(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      true
    );
    const { profiles } = detectProfiles(sketch);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.outer.area).toBeGreaterThan(0);
    // The loop ships to the worker as a single polyline segment.
    expect(profiles[0]?.outer.segments[0]?.kind).toBe('polyline');
  });

  it('round-trips through the sketch XML codec', () => {
    const sketch = splineSketch(
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ],
      true
    );
    const parsed = sketchFromXml(sketchToXml(sketch));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(sketch);
  });
});
