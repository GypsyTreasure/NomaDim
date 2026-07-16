import { describe, expect, it } from 'vitest';
import { VIEW_IDS, viewOrientation, type ViewId } from '../../src/viewport/viewOrientation';

/**
 * Standard CAD view orientations (F11), world Z-up. Each `dir` is a unit
 * vector from target to camera; `up` is a unit vector orthogonal to it.
 */

const len = (v: readonly number[]): number => Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
const dot = (a: readonly number[], b: readonly number[]): number =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);

describe('viewOrientation', () => {
  it('every view has a unit dir + up', () => {
    for (const id of VIEW_IDS) {
      const o = viewOrientation(id);
      expect(len(o.dir)).toBeCloseTo(1, 6);
      expect(len(o.up)).toBeCloseTo(1, 6);
    }
  });

  it('the six orthographic faces have dir ⟂ up', () => {
    // Home is isometric: it keeps world-up (+Z), which lookAt re-orthogonalizes,
    // so only the axis-aligned faces are required to be strictly orthogonal.
    const faces: ViewId[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];
    for (const id of faces) {
      const o = viewOrientation(id);
      expect(dot(o.dir, o.up)).toBeCloseTo(0, 6);
    }
  });

  it('maps the six faces to the expected axes (Z-up)', () => {
    expect(viewOrientation('top').dir).toEqual([0, 0, 1]);
    expect(viewOrientation('bottom').dir).toEqual([0, 0, -1]);
    expect(viewOrientation('front').dir).toEqual([0, -1, 0]);
    expect(viewOrientation('back').dir).toEqual([0, 1, 0]);
    expect(viewOrientation('right').dir).toEqual([1, 0, 0]);
    expect(viewOrientation('left').dir).toEqual([-1, 0, 0]);
    // Side/front views keep Z up; top/bottom look down Z so up is +Y.
    expect(viewOrientation('front').up).toEqual([0, 0, 1]);
    expect(viewOrientation('top').up).toEqual([0, 1, 0]);
  });

  it('home is an isometric-ish view with Z up', () => {
    const o = viewOrientation('home');
    expect(o.dir[2]).toBeGreaterThan(0); // above the target
    expect(o.up).toEqual([0, 0, 1]);
  });

  it('VIEW_IDS covers every orientation exactly once', () => {
    const ids: ViewId[] = ['home', 'front', 'back', 'left', 'right', 'top', 'bottom'];
    expect([...VIEW_IDS].sort()).toEqual([...ids].sort());
  });
});
