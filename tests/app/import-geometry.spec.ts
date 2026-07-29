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
  it('imports every primitive as construction (reference) geometry', () => {
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
    expect(p.entities.every((e) => e.construction)).toBe(true);
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

  it('imports a lone point as a construction point entity', () => {
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
});
