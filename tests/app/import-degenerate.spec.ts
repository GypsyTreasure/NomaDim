import { describe, expect, it } from 'vitest';
import { vec2, type SketchId } from '../../src/core';
import { applyCommand, emptyDocument } from '../../src/document';
import { emptySketch } from '../../src/document/sketch/access';
import { GeometryPlan } from '../../src/app/features/sketcher/geometryPlan';
import { addImportedPrimitives } from '../../src/app/features/sketcher/importGeometry';
import type { ImportPrimitive } from '../../src/sketch';

/**
 * Robust reference import (ADR-0085): real DXF/SVG files carry degenerate
 * artifacts (zero-length lines, coincident-endpoint arcs). One such entity used
 * to fail validateSketch and reject the WHOLE import ("crushing import"). The
 * GeometryPlan now drops degenerate lines/arcs so the rest imports cleanly.
 */
describe('degenerate reference geometry', () => {
  const build = (prims: ImportPrimitive[]) => {
    const sketch = emptySketch('s1' as SketchId, 'S', { kind: 'origin', plane: 'XY' });
    const doc = { ...emptyDocument(), sketches: [sketch] };
    const plan = new GeometryPlan(sketch);
    addImportedPrimitives(plan, prims);
    return applyCommand(doc, {
      type: 'AddSketchGeometry',
      payload: { sketchId: 's1' as SketchId, ...plan.payload },
    });
  };

  it('drops a zero-length line but keeps the rest of the import', () => {
    const res = build([
      { kind: 'line', a: vec2(5, 5), b: vec2(5, 5) }, // degenerate
      { kind: 'line', a: vec2(0, 0), b: vec2(10, 0) }, // valid
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.state.sketches[0]?.entities).toHaveLength(1);
  });

  it('drops a coincident-endpoint arc', () => {
    const res = build([
      { kind: 'arc', center: vec2(0, 0), start: vec2(1, 0), end: vec2(1, 0), ccw: true },
      { kind: 'line', a: vec2(0, 0), b: vec2(3, 4) },
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.state.sketches[0]?.entities).toHaveLength(1);
  });

  it('a degenerate polyline segment does not reject the whole polyline', () => {
    const res = build([
      { kind: 'polyline', points: [vec2(0, 0), vec2(0, 0), vec2(5, 0), vec2(5, 5)], closed: false },
    ]);
    expect(res.ok).toBe(true);
    // 3 points → 2 non-degenerate segments (the zero-length first hop is dropped).
    if (res.ok) expect(res.value.state.sketches[0]?.entities).toHaveLength(2);
  });
});
