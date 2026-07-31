import { describe, expect, it } from 'vitest';
import type { SketchId } from '../../src/core/ids';
import { emptySketch } from '../../src/document';
import { GeometryPlan } from '../../src/app/features/sketcher/geometryPlan';
import { addImportedPrimitives } from '../../src/app/features/sketcher/importGeometry';
import type { ImportPrimitive } from '../../src/sketch';

function plan(): GeometryPlan {
  return new GeometryPlan(
    emptySketch('sk' as SketchId, 'Sketch1', { kind: 'origin', plane: 'XY' })
  );
}

describe('addImportedPrimitives', () => {
  it('imports every primitive as real (extrudable) sketch geometry (#3)', () => {
    const p = plan();
    const prims: ImportPrimitive[] = [
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { kind: 'circle', center: { x: 5, y: 5 }, r: 3 },
      {
        kind: 'arc',
        center: { x: 0, y: 0 },
        start: { x: 5, y: 0 },
        end: { x: 0, y: 5 },
        ccw: true,
      },
    ];
    addImportedPrimitives(p, prims);
    expect(p.entities).toHaveLength(3);
    // Imported geometry is normal, profile-forming geometry — Finish → Extrude
    // works directly — so nothing is flagged construction (ADR-0089).
    expect(p.entities.every((e) => e.construction)).toBe(false);
    expect(p.entities.map((e) => e.type).sort()).toEqual(['arc', 'circle', 'line']);
  });

  it('expands a closed polyline into a connected loop of lines', () => {
    const p = plan();
    addImportedPrimitives(p, [
      {
        kind: 'polyline',
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    ]);
    // 3 vertices, closed → 3 line segments; shared vertices merge to 3 points.
    const lines = p.entities.filter((e) => e.type === 'line');
    expect(lines).toHaveLength(3);
    expect(p.payload.points).toHaveLength(3);
  });

  it('imports a lone point as a point entity', () => {
    const p = plan();
    addImportedPrimitives(p, [{ kind: 'polyline', closed: false, points: [{ x: 2, y: 3 }] }]);
    expect(p.entities).toHaveLength(1);
    expect(p.entities[0]?.type).toBe('point');
  });

  it('skips a zero-radius circle', () => {
    const p = plan();
    addImportedPrimitives(p, [{ kind: 'circle', center: { x: 0, y: 0 }, r: 0 }]);
    expect(p.entities).toHaveLength(0);
  });

  it('merges coincident endpoints across many shapes (shared topology)', () => {
    const p = plan();
    // Two lines meeting at (10,0) and (0,0) — a chain sharing endpoints.
    addImportedPrimitives(p, [
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { kind: 'line', a: { x: 10, y: 0 }, b: { x: 10, y: 10 } },
      { kind: 'line', a: { x: 10, y: 10 }, b: { x: 0, y: 0 } },
    ]);
    expect(p.entities.filter((e) => e.type === 'line')).toHaveLength(3);
    // Three shared corners → three pool points, not six endpoints.
    expect(p.payload.points).toHaveLength(3);
  });

  it('resolves thousands of points quickly (spatial-hash merge)', () => {
    const p = plan();
    const prims = Array.from({ length: 4000 }, (_, i) => ({
      kind: 'line' as const,
      a: { x: i, y: 0 },
      b: { x: i + 1, y: 0 },
    }));
    const t0 = Date.now();
    addImportedPrimitives(p, prims);
    // A chain of 4000 segments merges to 4001 shared points; must not be O(n²).
    expect(p.payload.points).toHaveLength(4001);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
