import { describe, expect, it } from 'vitest';
import type { SketchId } from '../../src/core/ids';
import { vec2 } from '../../src/core/math';
import { emptySketch, type Sketch } from '../../src/document';
import { GeometryPlan } from '../../src/app/features/sketcher/geometryPlan';
import {
  initialToolState,
  isChained,
  toolClick,
  toolEnter,
  toolEscape,
  type ToolState,
} from '../../src/app/features/sketcher/toolLogic';
import { lineEndFrom } from '../../src/app/features/sketcher/shapeMath';

const skId = 'sk1' as SketchId;
const blank = (): Sketch => emptySketch(skId, 'S', { kind: 'origin', plane: 'XY' });

/** Applies a tool step against a sketch, returning committed payload + next state. */
function commitStep(
  sketch: Sketch,
  step: ReturnType<typeof toolEnter>
): { sketch: Sketch; state: ToolState } {
  if (!step.commit) return { sketch, state: step.state };
  const plan = new GeometryPlan(sketch);
  step.commit(plan);
  return {
    sketch: {
      ...sketch,
      points: [...sketch.points, ...plan.payload.points],
      entities: [...sketch.entities, ...plan.payload.entities],
    },
    state: step.state,
  };
}

describe('lineEndFrom (F2 angle semantics)', () => {
  it('absolute angle is measured from the sketch +X axis', () => {
    const end = lineEndFrom(vec2(0, 0), vec2(99, 99), 40, 90, null, null);
    expect(end?.x).toBeCloseTo(0, 9);
    expect(end?.y).toBeCloseTo(40, 9);
  });

  it('relative angle measures from the previous segment direction', () => {
    const end = lineEndFrom(vec2(10, 0), vec2(0, 0), 10, null, 90, vec2(1, 0));
    expect(end?.x).toBeCloseTo(10, 9);
    expect(end?.y).toBeCloseTo(10, 9);
  });

  it('typed absolute angle wins over relative', () => {
    const end = lineEndFrom(vec2(0, 0), vec2(0, 0), 10, 0, 90, vec2(0, 1));
    expect(end?.x).toBeCloseTo(10, 9);
    expect(end?.y).toBeCloseTo(0, 9);
  });

  it('cursor drives untyped values', () => {
    const end = lineEndFrom(vec2(0, 0), vec2(30, 40), null, null, null, null);
    expect(end?.x).toBeCloseTo(30, 9);
    expect(end?.y).toBeCloseTo(40, 9);
  });
});

describe('line tool keyboard chain (M2 acceptance core)', () => {
  it('draws a closed rectangle via typed segments, sharing all corner points', () => {
    let sketch = blank();
    let state = initialToolState('line');
    expect(isChained(state)).toBe(false);

    const segments: [string, string][] = [
      ['60', '0'],
      ['40', '90'],
      ['60', '180'],
      ['40', '270'],
    ];
    for (const [len, ang] of segments) {
      const step = toolEnter(state, [Number(len), Number(ang), null], vec2(0, 0));
      ({ sketch, state } = commitStep(sketch, step));
    }

    expect(sketch.entities).toHaveLength(4);
    // Shared topology: 4 corners, not 8 endpoints — the closing segment
    // merged with the origin anchor by coordinates.
    expect(sketch.points).toHaveLength(4);
    expect(isChained(state)).toBe(true);

    const escaped = toolEscape(state);
    expect(escaped.chainAnchor).toBeNull();
    expect(isChained(escaped)).toBe(false);
  });

  it('first keyboard segment anchors at the origin (ADR-0012)', () => {
    const step = toolEnter(initialToolState('line'), [25, 45, null], vec2(0, 0));
    const { sketch } = commitStep(blank(), step);
    const [a, b] = sketch.points;
    expect(a).toMatchObject({ x: 0, y: 0 });
    expect(b?.x).toBeCloseTo(25 / Math.SQRT2, 9);
    expect(b?.y).toBeCloseTo(25 / Math.SQRT2, 9);
  });
});

describe('macro tools expand to primitives on commit (F2)', () => {
  it('rectangle-2p commits four chained lines', () => {
    let state = initialToolState('rectangle-2p');
    state = toolClick(state, { p: vec2(0, 0) }).state;
    const step = toolEnter(state, [30, 20], vec2(1, 1));
    const { sketch } = commitStep(blank(), step);
    expect(sketch.entities).toHaveLength(4);
    expect(sketch.entities.every((e) => e.type === 'line')).toBe(true);
    expect(sketch.points).toHaveLength(4);
  });

  it('polygon commits n chained lines inscribed in the typed diameter', () => {
    const step = toolEnter(initialToolState('polygon'), [6, 50], vec2(0, 0));
    const { sketch } = commitStep(blank(), step);
    expect(sketch.entities).toHaveLength(6);
    expect(sketch.points).toHaveLength(6);
    for (const p of sketch.points) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(25, 9);
    }
  });

  it('circle with typed diameter defaults its center to the origin (keyboard-only)', () => {
    const step = toolEnter(initialToolState('circle-center-diameter'), [20], vec2(0, 0));
    const { sketch } = commitStep(blank(), step);
    expect(sketch.entities[0]).toMatchObject({ type: 'circle', r: 10 });
    expect(sketch.points[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('arc-3p click sequence commits an arc through the picked points', () => {
    let state = initialToolState('arc-3p');
    state = toolClick(state, { p: vec2(10, 0) }).state; // start
    state = toolClick(state, { p: vec2(-10, 0) }).state; // end
    const step = toolClick(state, { p: vec2(0, 10) }); // via top
    const { sketch } = commitStep(blank(), step);
    const arc = sketch.entities[0];
    expect(arc?.type).toBe('arc');
    // Center at origin (circumcenter of the three points).
    const center = sketch.points.find((p) => Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9);
    expect(center).toBeDefined();
  });
});

describe('GeometryPlan point merging', () => {
  it('reuses existing pool points by exact coordinates', () => {
    let sketch = blank();
    const first = commitStep(
      sketch,
      toolEnter(initialToolState('line'), [10, 0, null], vec2(0, 0))
    );
    sketch = first.sketch;
    // New chain starting exactly at (10, 0) merges with the existing endpoint.
    const plan = new GeometryPlan(sketch);
    plan.addLine({ p: vec2(10, 0) }, { p: vec2(10, 5) }, false);
    expect(plan.payload.points).toHaveLength(1); // only (10,5) is new
  });
});
