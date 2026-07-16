import { describe, expect, it } from 'vitest';
import type { SketchId } from '../../src/core';
import { emptySketch } from '../../src/document';
import { SnapEngine } from '../../src/sketch';

/**
 * Origin base point (F2 dimensioning datum): the sketch origin (0,0) is always
 * snappable and outranks every other snap, so geometry and dimensions can be
 * based on it even in an empty sketch.
 */

const engine = new SnapEngine();
const sketch = emptySketch('sk1' as SketchId, 'S', { kind: 'origin', plane: 'XY' });

function query(cursor: { x: number; y: number }) {
  return engine.query({
    sketch,
    evaluated: [],
    cursor,
    toleranceMm: 2,
    angularToleranceRad: 0.05,
    gridSpacingMm: 1,
  });
}

describe('origin snap', () => {
  it('snaps to (0,0) near the origin, even with no geometry', () => {
    const { snap } = query({ x: 0.3, y: 0.3 });
    expect(snap?.kind).toBe('origin');
    expect(snap?.point).toEqual({ x: 0, y: 0 });
  });

  it('outranks the grid at the same point', () => {
    // Cursor rounds to the origin grid node too; origin must still win.
    const { snap } = query({ x: 0.2, y: -0.1 });
    expect(snap?.kind).toBe('origin');
  });

  it('stays free when the cursor is far from the origin', () => {
    const { snap } = query({ x: 50, y: 50 });
    expect(snap?.kind).not.toBe('origin');
  });
});
