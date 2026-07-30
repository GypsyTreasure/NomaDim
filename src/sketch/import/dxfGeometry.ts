import { vec2, type Vec2 } from '../../core';
import { IMPORT_CURVE_SEGMENTS, type ImportPrimitive } from './types';

/**
 * Pure 2D geometry helpers for the DXF importer (ADR-0076): a 2×3 affine
 * transform (for resolving BLOCK/INSERT placements, including nesting) plus
 * bulge-arc and ellipse tessellation. No DXF parsing here — just maths.
 */

/** 2×3 affine: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function apply(t: Affine, p: Vec2): Vec2 {
  return vec2(t.a * p.x + t.c * p.y + t.e, t.b * p.x + t.d * p.y + t.f);
}

/** Composed transform applying `inner` first, then `outer`. */
export function compose(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

const det = (t: Affine): number => t.a * t.d - t.b * t.c;

/** Isotropic length scale (geometric mean) — used for circle radii. */
const lengthFactor = (t: Affine): number => Math.sqrt(Math.abs(det(t))) || 1;

/** Maps a primitive through an affine transform (INSERT placement). */
export function transformPrimitive(prim: ImportPrimitive, t: Affine): ImportPrimitive {
  switch (prim.kind) {
    case 'line':
      return { kind: 'line', a: apply(t, prim.a), b: apply(t, prim.b), layer: prim.layer };
    case 'circle':
      return {
        kind: 'circle',
        center: apply(t, prim.center),
        r: prim.r * lengthFactor(t),
        layer: prim.layer,
      };
    case 'arc':
      return {
        kind: 'arc',
        center: apply(t, prim.center),
        start: apply(t, prim.start),
        end: apply(t, prim.end),
        // A reflection (negative determinant) flips the sweep direction.
        ccw: det(t) < 0 ? !prim.ccw : prim.ccw,
        layer: prim.layer,
      };
    case 'polyline':
      return {
        kind: 'polyline',
        points: prim.points.map((p) => apply(t, p)),
        closed: prim.closed,
        layer: prim.layer,
      };
    default: {
      const exhaustive: never = prim;
      return exhaustive;
    }
  }
}

/**
 * Samples a bulged polyline segment (DXF group 42) from `p0` (exclusive) to
 * `p1` (inclusive). `bulge` = tan(¼·included-angle); sign gives direction
 * (positive = counter-clockwise). A zero bulge is a straight segment.
 */
export function bulgeArcPoints(p0: Vec2, p1: Vec2, bulge: number, n: number): Vec2[] {
  if (bulge === 0) return [p1];
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return [p1];
  const included = 4 * Math.atan(bulge); // signed sweep angle
  const half = included / 2;
  const apothem = chord / 2 / Math.tan(half); // signed
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  // Perpendicular to the chord (rotate chord direction +90°).
  const ux = -dy / chord;
  const uy = dx / chord;
  const cx = mx + apothem * ux;
  const cy = my + apothem * uy;
  const r = Math.hypot(p0.x - cx, p0.y - cy);
  const startAng = Math.atan2(p0.y - cy, p0.x - cx);
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i += 1) {
    const ang = startAng + (included * i) / n;
    out.push(vec2(cx + r * Math.cos(ang), cy + r * Math.sin(ang)));
  }
  return out;
}

/**
 * Tessellates a DXF ELLIPSE: `center`, `major` = major-axis endpoint relative
 * to the center, `ratio` = minor/major, swept from `startParam` to `endParam`
 * (radians in the ellipse's own frame). Returns `{ points, closed }`.
 */
export function ellipsePoints(
  center: Vec2,
  major: Vec2,
  ratio: number,
  startParam: number,
  endParam: number
): { points: Vec2[]; closed: boolean } {
  const majorLen = Math.hypot(major.x, major.y);
  const rot = Math.atan2(major.y, major.x);
  const minorLen = majorLen * ratio;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  let sweep = endParam - startParam;
  const full = Math.abs(sweep) < 1e-9 || Math.abs(Math.abs(sweep) - 2 * Math.PI) < 1e-6;
  if (full) sweep = 2 * Math.PI;
  const n = Math.max(
    IMPORT_CURVE_SEGMENTS,
    Math.ceil((IMPORT_CURVE_SEGMENTS * Math.abs(sweep)) / (2 * Math.PI))
  );
  const points: Vec2[] = [];
  const count = full ? n : n + 1;
  for (let i = 0; i < count; i += 1) {
    const t = startParam + (sweep * i) / n;
    const ex = majorLen * Math.cos(t);
    const ey = minorLen * Math.sin(t);
    points.push(vec2(center.x + cos * ex - sin * ey, center.y + sin * ex + cos * ey));
  }
  return { points, closed: full };
}
