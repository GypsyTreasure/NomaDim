import { describe, expect, it } from 'vitest';
import {
  add,
  angleOf,
  ccwSweep,
  cross,
  distance,
  dot,
  fromAngle,
  length,
  midpoint,
  nearlyEqual,
  nearlyEqualVec,
  normalize,
  normalizeAngle,
  perp,
  rotate,
  scale,
  sub,
  vec2,
} from '../../src/core/math';

describe('Vec2 operations', () => {
  it('add / sub / scale', () => {
    expect(add(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 });
    expect(sub(vec2(3, 4), vec2(1, 2))).toEqual({ x: 2, y: 2 });
    expect(scale(vec2(1, -2), 3)).toEqual({ x: 3, y: -6 });
  });

  it('dot / cross', () => {
    expect(dot(vec2(1, 2), vec2(3, 4))).toBe(11);
    expect(cross(vec2(1, 0), vec2(0, 1))).toBe(1); // +Y is CCW from +X
    expect(cross(vec2(0, 1), vec2(1, 0))).toBe(-1);
  });

  it('length / distance / midpoint', () => {
    expect(length(vec2(3, 4))).toBe(5);
    expect(distance(vec2(1, 1), vec2(4, 5))).toBe(5);
    expect(midpoint(vec2(0, 0), vec2(4, 6))).toEqual({ x: 2, y: 3 });
  });

  it('normalize handles zero vectors', () => {
    expect(normalize(vec2(3, 0))).toEqual({ x: 1, y: 0 });
    expect(normalize(vec2(0, 0))).toEqual({ x: 0, y: 0 });
  });

  it('perp is CCW', () => {
    expect(perp(vec2(1, 0))).toEqual({ x: -0, y: 1 });
  });

  it('rotate / angleOf / fromAngle round-trip', () => {
    const rotated = rotate(vec2(1, 0), Math.PI / 2);
    expect(nearlyEqualVec(rotated, vec2(0, 1), 1e-12)).toBe(true);
    expect(nearlyEqual(angleOf(vec2(0, 2)), Math.PI / 2)).toBe(true);
    expect(nearlyEqualVec(fromAngle(Math.PI), vec2(-1, 0), 1e-12)).toBe(true);
  });

  it('normalizeAngle wraps into [0, 2*PI)', () => {
    expect(nearlyEqual(normalizeAngle(-Math.PI / 2), (3 * Math.PI) / 2)).toBe(true);
    expect(normalizeAngle(2 * Math.PI)).toBe(0);
  });

  it('ccwSweep measures counterclockwise sweep', () => {
    expect(nearlyEqual(ccwSweep(0, Math.PI / 2), Math.PI / 2)).toBe(true);
    expect(nearlyEqual(ccwSweep(Math.PI / 2, 0), (3 * Math.PI) / 2)).toBe(true);
  });
});
