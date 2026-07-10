/**
 * 2D vector math for the sketch subsystem (ARCHITECTURE §3: core/ owns
 * Vec2/Vec3/Mat4 math). Immutable value objects — every operation returns a
 * new Vec2. Vec3/Mat4 arrive when a consumer needs them (viewport uses
 * Three.js's own types; the worker uses OCCT's gp_*).
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Geometric tolerance in sketch units (mm). One place, never inline literals. */
export const GEOM_EPS = 1e-9;

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** z-component of the 3D cross product — positive when b is CCW from a. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  return lengthSq(sub(a, b));
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Zero vectors normalize to zero (callers guard with nearlyZeroVec when it matters). */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len < GEOM_EPS ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/** CCW perpendicular. */
export function perp(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

export function rotate(v: Vec2, angleRad: number): Vec2 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Angle of v from +X axis, in (-PI, PI]. */
export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

/** Unit vector at angle from +X axis. */
export function fromAngle(angleRad: number): Vec2 {
  return { x: Math.cos(angleRad), y: Math.sin(angleRad) };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return lerp(a, b, 0.5);
}

export function nearlyEqual(a: number, b: number, eps: number = GEOM_EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function nearlyZero(value: number, eps: number = GEOM_EPS): boolean {
  return Math.abs(value) <= eps;
}

export function nearlyEqualVec(a: Vec2, b: Vec2, eps: number = GEOM_EPS): boolean {
  return nearlyEqual(a.x, b.x, eps) && nearlyEqual(a.y, b.y, eps);
}

export function clampToRange(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/** Normalizes an angle to [0, 2*PI). */
export function normalizeAngle(angleRad: number): number {
  const tau = 2 * Math.PI;
  const wrapped = angleRad % tau;
  return wrapped < 0 ? wrapped + tau : wrapped;
}

/** CCW sweep from `fromRad` to `toRad`, in [0, 2*PI). */
export function ccwSweep(fromRad: number, toRad: number): number {
  return normalizeAngle(toRad - fromRad);
}
