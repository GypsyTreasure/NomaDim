import type { Vec2 } from '../../core';

/**
 * Neutral 2D primitives parsed from a reference file (SVG / DXF), in
 * sketch-plane millimetres (Y up). The app turns these into (construction)
 * sketch entities via the GeometryPlan, so imported art is real, snappable,
 * selectable geometry — "reference geometry you can trace over" (F2, ADR-0076).
 * Curves that aren't circles/arcs arrive pre-sampled as polylines so the
 * importer needs no analytic Bézier/ellipse support downstream.
 */
export type ImportPrimitive =
  | { readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly r: number }
  | {
      readonly kind: 'arc';
      readonly center: Vec2;
      readonly start: Vec2;
      readonly end: Vec2;
      readonly ccw: boolean;
    }
  | { readonly kind: 'polyline'; readonly points: readonly Vec2[]; readonly closed: boolean };

export interface ImportResult {
  readonly primitives: readonly ImportPrimitive[];
  /** Non-fatal notes (unsupported elements skipped, etc.) for a toast. */
  readonly warnings: readonly string[];
}

/** Curve tessellation density for imported Béziers / ellipses / SVG arcs. */
export const IMPORT_CURVE_SEGMENTS = 24;
