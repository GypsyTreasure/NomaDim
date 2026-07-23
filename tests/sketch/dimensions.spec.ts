import { describe, expect, it } from 'vitest';
import type { DimensionId, EntityId, PointId } from '../../src/core/ids';
import { vec2 } from '../../src/core/math';
import type { SketchDimension, SketchDimensionKind, SketchEntity } from '../../src/document';
import {
  dimensionEndpoints,
  dimensionLabel,
  dimensionMeasure,
  dimensionRender,
} from '../../src/sketch';

const dim = (kind: SketchDimensionKind, offset = 10): SketchDimension => ({
  id: 'd0' as DimensionId,
  kind,
  a: 'a' as PointId,
  b: 'b' as PointId,
  offset,
});

describe('dimensionMeasure', () => {
  it('linear/radius measure the straight distance |ab|', () => {
    expect(dimensionMeasure('linear', vec2(0, 0), vec2(3, 4))).toBeCloseTo(5);
    expect(dimensionMeasure('radius', vec2(1, 1), vec2(1, 6))).toBeCloseTo(5);
  });

  it('diameter is twice the straight distance |ab|', () => {
    expect(dimensionMeasure('diameter', vec2(0, 0), vec2(3, 4))).toBeCloseTo(10);
  });

  it('horizontal/vertical measure absolute axis deltas (sign-free)', () => {
    expect(dimensionMeasure('horizontal', vec2(5, 9), vec2(-3, 2))).toBeCloseTo(8);
    expect(dimensionMeasure('vertical', vec2(5, 9), vec2(-3, 2))).toBeCloseTo(7);
  });

  it('angle is the a→b inclination from +X in [0, 360)', () => {
    expect(dimensionMeasure('angle', vec2(0, 0), vec2(1, 0))).toBeCloseTo(0);
    expect(dimensionMeasure('angle', vec2(0, 0), vec2(1, 1))).toBeCloseTo(45);
    expect(dimensionMeasure('angle', vec2(0, 0), vec2(0, 1))).toBeCloseTo(90);
    // A downward-right segment wraps into the upper range rather than going negative.
    expect(dimensionMeasure('angle', vec2(0, 0), vec2(1, -1))).toBeCloseTo(315);
  });
});

describe('dimensionLabel', () => {
  it('formats each kind with its unit/prefix and trims trailing zeros', () => {
    expect(dimensionLabel('linear', vec2(0, 0), vec2(3, 4))).toBe('5');
    expect(dimensionLabel('horizontal', vec2(0, 0), vec2(2.5, 0))).toBe('2.5');
    expect(dimensionLabel('radius', vec2(0, 0), vec2(12, 0))).toBe('R12');
    expect(dimensionLabel('diameter', vec2(0, 0), vec2(12, 0))).toBe('⌀24');
    expect(dimensionLabel('angle', vec2(0, 0), vec2(1, 1))).toBe('45°');
  });
});

describe('dimensionEndpoints (radial dims, #1)', () => {
  const pt =
    (map: Record<string, ReturnType<typeof vec2>>) =>
    (id: PointId): ReturnType<typeof vec2> | undefined =>
      map[id];

  it('two-point dim resolves its pool points', () => {
    const points = { a: vec2(1, 2), b: vec2(4, 6) };
    const ends = dimensionEndpoints(dim('linear'), pt(points), () => undefined);
    expect(ends).not.toBeNull();
    expect(ends?.[0]).toEqual(vec2(1, 2));
    expect(ends?.[1]).toEqual(vec2(4, 6));
  });

  it('circle radial dim synthesizes a rim point from the entity radius', () => {
    const circle: SketchEntity = {
      type: 'circle',
      id: 'c1' as EntityId,
      center: 'ctr' as PointId,
      r: 7,
      construction: false,
    };
    const radial: SketchDimension = {
      id: 'd1' as DimensionId,
      kind: 'diameter',
      a: 'ctr' as PointId,
      b: 'ctr' as PointId,
      offset: 10,
      entityId: 'c1' as EntityId,
    };
    const ends = dimensionEndpoints(radial, pt({ ctr: vec2(2, 3) }), (id) =>
      id === circle.id ? circle : undefined
    );
    expect(ends).not.toBeNull();
    expect(ends?.[0]).toEqual(vec2(2, 3)); // centre
    expect(ends?.[1]).toEqual(vec2(9, 3)); // centre + radius along +X
    // |a→b| = 7 → diameter reads ⌀14.
    if (ends) expect(dimensionLabel('diameter', ends[0], ends[1])).toBe('⌀14');
  });

  it('returns null when the referenced entity is missing', () => {
    const radial: SketchDimension = {
      id: 'd2' as DimensionId,
      kind: 'radius',
      a: 'ctr' as PointId,
      b: 'ctr' as PointId,
      offset: 10,
      entityId: 'gone' as EntityId,
    };
    expect(dimensionEndpoints(radial, pt({ ctr: vec2(0, 0) }), () => undefined)).toBeNull();
  });
});

describe('dimensionRender', () => {
  it('linear: dimension line is parallel to a→b, offset perpendicular', () => {
    const r = dimensionRender(dim('linear', 10), vec2(0, 0), vec2(10, 0));
    // a→b is along +X, so the CCW perpendicular offset pushes the line to +Y.
    expect(r.segments).toHaveLength(3); // two extension lines + dimension line
    expect(r.labelAnchor.x).toBeCloseTo(5);
    expect(r.labelAnchor.y).toBeCloseTo(10);
    expect(r.label).toBe('10');
  });

  it('horizontal: dimension line sits at constant y past the extreme point', () => {
    const r = dimensionRender(dim('horizontal', 4), vec2(0, 0), vec2(6, 2));
    // Positive offset places the line above the topmost point (y = 2 + 4).
    expect(r.labelAnchor.y).toBeCloseTo(6);
    expect(r.labelAnchor.x).toBeCloseTo(3);
    // The dimension line (last segment) is horizontal.
    const line = r.segments[r.segments.length - 1];
    expect(line?.[0].y).toBeCloseTo(line?.[1].y ?? NaN);
  });

  it('vertical: dimension line sits at constant x past the extreme point', () => {
    const r = dimensionRender(dim('vertical', 3), vec2(0, 0), vec2(2, 6));
    expect(r.labelAnchor.x).toBeCloseTo(5); // x = 2 + 3
    const line = r.segments[r.segments.length - 1];
    expect(line?.[0].x).toBeCloseTo(line?.[1].x ?? NaN);
  });

  it('angle: emits reference + direction rays and a sampled arc', () => {
    const r = dimensionRender(dim('angle', 8), vec2(0, 0), vec2(1, 1));
    // At least the two rays plus one arc segment.
    expect(r.segments.length).toBeGreaterThanOrEqual(3);
    expect(r.label).toBe('45°');
  });

  it('radius: a single line from centre to the rim point', () => {
    const r = dimensionRender(dim('radius', 0), vec2(0, 0), vec2(0, 12));
    expect(r.segments).toHaveLength(1);
    expect(r.label).toBe('R12');
  });

  it('diameter: a single chord through the centre, labelled ⌀', () => {
    const r = dimensionRender(dim('diameter', 0), vec2(0, 0), vec2(0, 12));
    expect(r.segments).toHaveLength(1);
    // The chord spans the full diameter: from the far rim (0,-12) to b (0,12).
    const chord = r.segments[0];
    expect(chord?.[0].y).toBeCloseTo(-12);
    expect(chord?.[1].y).toBeCloseTo(12);
    expect(r.label).toBe('⌀24');
  });
});
