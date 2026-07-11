import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core/ids';
import { DEG_TO_RAD, nearlyEqualVec, vec2, type Vec2 } from '../../src/core/math';
import type { Sketch } from '../../src/document';
import { evaluateSketch, SnapEngine, type SnapContext, type SnapKind } from '../../src/sketch';

const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

/**
 * Fixture: horizontal line (0,0)→(10,0), vertical line (10,0)→(10,10)
 * sharing corner point pb, plus a circle centered (20,5) r=2.
 */
function fixtureSketch(): Sketch {
  return {
    id: 'sk1' as SketchId,
    name: 'S',
    plane: { kind: 'origin', plane: 'XY' },
    points: [
      { id: pid('pa'), x: 0, y: 0 },
      { id: pid('pb'), x: 10, y: 0 },
      { id: pid('pc'), x: 10, y: 10 },
      { id: pid('pd'), x: 20, y: 5 },
    ],
    entities: [
      { type: 'line', id: eid('l1'), start: pid('pa'), end: pid('pb'), construction: false },
      { type: 'line', id: eid('l2'), start: pid('pb'), end: pid('pc'), construction: false },
      { type: 'circle', id: eid('c1'), center: pid('pd'), r: 2, construction: false },
    ],
    constraints: [],
    dimensions: [],
  };
}

function makeCtx(cursor: Vec2, overrides: Partial<SnapContext> = {}): SnapContext {
  const sketch = fixtureSketch();
  return {
    sketch,
    evaluated: evaluateSketch(sketch),
    cursor,
    toleranceMm: 0.5,
    angularToleranceRad: 2 * DEG_TO_RAD,
    gridSpacingMm: 1,
    ...overrides,
  };
}

const engine = new SnapEngine();

function snapKind(cursor: Vec2, overrides: Partial<SnapContext> = {}): SnapKind | null {
  return engine.query(makeCtx(cursor, overrides)).snap?.kind ?? null;
}

describe('SnapEngine point snaps', () => {
  it('endpoint beats everything near a shared corner and carries the pool id', () => {
    const result = engine.query(makeCtx(vec2(10.2, 0.1)));
    expect(result.snap?.kind).toBe('endpoint');
    expect(result.snap?.sourceRef).toEqual({ type: 'point', pointId: 'pb' });
    expect(result.snap && nearlyEqualVec(result.snap.point, vec2(10, 0))).toBe(true);
  });

  it('midpoint snaps at segment middle', () => {
    const result = engine.query(makeCtx(vec2(5.1, 0.2)));
    expect(result.snap?.kind).toBe('midpoint');
    expect(result.snap && nearlyEqualVec(result.snap.point, vec2(5, 0))).toBe(true);
  });

  it('center snaps at circle center with the pool id', () => {
    const result = engine.query(makeCtx(vec2(20.1, 5.1)));
    expect(result.snap?.kind).toBe('center');
    expect(result.snap?.sourceRef).toEqual({ type: 'point', pointId: 'pd' });
  });

  it('quadrant snaps on the circle rim', () => {
    expect(snapKind(vec2(22.1, 5.05))).toBe('quadrant'); // east quadrant (22, 5)
  });

  it('on-entity snaps to the nearest curve point', () => {
    const result = engine.query(makeCtx(vec2(3.4, 0.3)));
    expect(result.snap?.kind).toBe('on-entity');
    expect(result.snap && nearlyEqualVec(result.snap.point, vec2(3.4, 0))).toBe(true);
  });

  it('grid snaps when nothing better is near', () => {
    const result = engine.query(makeCtx(vec2(4.9, 6.1)));
    expect(result.snap?.kind).toBe('grid');
    expect(result.snap && nearlyEqualVec(result.snap.point, vec2(5, 6))).toBe(true);
  });

  it('returns null when everything is out of tolerance', () => {
    expect(snapKind(vec2(4.4, 6.6), { gridSpacingMm: 0 })).toBeNull();
  });

  it('intersection beats midpoint/on-entity where curves cross', () => {
    // Add a diagonal crossing l1 at (5,0) — same spot as l1's midpoint.
    const sketch = fixtureSketch();
    const crossed: Sketch = {
      ...sketch,
      points: [...sketch.points, { id: pid('pe'), x: 5, y: -5 }, { id: pid('pf'), x: 5, y: 5 }],
      entities: [
        ...sketch.entities,
        { type: 'line', id: eid('l3'), start: pid('pe'), end: pid('pf'), construction: false },
      ],
    };
    const ctx = makeCtx(vec2(5.1, 0.1), { sketch: crossed, evaluated: evaluateSketch(crossed) });
    const result = engine.query(ctx);
    expect(result.snap?.kind).toBe('intersection');
    expect(result.snap?.sourceRef.type).toBe('entities');
  });

  it('respects disabledKinds and excludeEntityIds', () => {
    expect(snapKind(vec2(10.2, 0.1), { disabledKinds: new Set(['endpoint']) })).not.toBe(
      'endpoint'
    );
    const excluded = new Set([eid('l1'), eid('l2')]);
    const result = engine.query(
      makeCtx(vec2(10.2, 0.1), { excludeEntityIds: excluded, gridSpacingMm: 0 })
    );
    expect(result.snap?.kind ?? null).toBeNull();
  });
});

describe('SnapEngine guides', () => {
  it('vertical alignment guide + candidate at same x as an existing point', () => {
    // Far from all curves; x within tolerance of pc's x=10.
    const result = engine.query(makeCtx(vec2(10.3, 20), { gridSpacingMm: 0 }));
    expect(result.snap?.kind).toBe('align-v');
    expect(result.snap && nearlyEqualVec(result.snap.point, vec2(10, 20))).toBe(true);
    expect(result.guides.some((g) => g.kind === 'align-v')).toBe(true);
  });

  it('corner (guide-intersection) wins when both axes align', () => {
    // x ≈ 0 (pa), y ≈ 10 (pc) — far from both source points.
    const result = engine.query(makeCtx(vec2(0.2, 10.2), { gridSpacingMm: 0 }));
    expect(result.snap?.kind).toBe('guide-intersection');
    expect(result.snap && nearlyEqualVec(result.snap.point, vec2(0, 10))).toBe(true);
  });

  /** Fixture plus a 45° diagonal so direction guides aren't degenerate with axis alignment. */
  function withDiagonal(): Sketch {
    const sketch = fixtureSketch();
    return {
      ...sketch,
      points: [...sketch.points, { id: pid('pg'), x: 0, y: 30 }, { id: pid('ph'), x: 10, y: 40 }],
      entities: [
        ...sketch.entities,
        { type: 'line', id: eid('l4'), start: pid('pg'), end: pid('ph'), construction: false },
      ],
    };
  }

  it('parallel guide while drawing from an anchor (45° reference line)', () => {
    const sketch = withDiagonal();
    const anchor = vec2(20, 30);
    const cursor = vec2(26, 36.2); // ~0.9° off the 45° diagonal
    const result = engine.query(
      makeCtx(cursor, { sketch, evaluated: evaluateSketch(sketch), anchor, gridSpacingMm: 0 })
    );
    expect(result.snap?.kind).toBe('parallel');
    const p = result.snap?.point ?? vec2(0, 0);
    expect(Math.abs(p.y - 30 - (p.x - 20))).toBeLessThan(1e-9); // exactly on the 45° ray
    expect(result.guides.some((g) => g.kind === 'parallel')).toBe(true);
  });

  it('perpendicular guide while drawing from an anchor (135° vs 45° base)', () => {
    const sketch = withDiagonal();
    const anchor = vec2(30, 30);
    const cursor = vec2(24, 36.2);
    const result = engine.query(
      makeCtx(cursor, { sketch, evaluated: evaluateSketch(sketch), anchor, gridSpacingMm: 0 })
    );
    expect(result.snap?.kind).toBe('perpendicular');
    const p = result.snap?.point ?? vec2(0, 0);
    expect(Math.abs(p.y - 30 + (p.x - 30))).toBeLessThan(1e-9); // exactly on the 135° ray
  });

  it('tangent guide when drawing from a point on a circle', () => {
    // 45° point of the circle centered (20,5) r=2 — tangent there runs at 135°.
    const anchor = vec2(20 + Math.SQRT2, 5 + Math.SQRT2);
    const cursor = vec2(18.51, 9.16); // ~1.5° off the tangent direction
    const result = engine.query(makeCtx(cursor, { anchor, gridSpacingMm: 0 }));
    expect(result.snap?.kind).toBe('tangent');
    const p = result.snap?.point ?? vec2(0, 0);
    expect(Math.abs(p.y - anchor.y + (p.x - anchor.x))).toBeLessThan(1e-9);
    expect(result.guides.some((g) => g.kind === 'tangent')).toBe(true);
  });
});
