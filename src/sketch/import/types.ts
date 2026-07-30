import type { Vec2 } from '../../core';

/**
 * Neutral 2D primitives parsed from a reference file (SVG / DXF), in
 * sketch-plane millimetres (Y up). The app turns these into (construction)
 * sketch entities via the GeometryPlan, so imported art is real, snappable,
 * selectable geometry — "reference geometry you can trace over" (F2, ADR-0076).
 * Curves that aren't circles/arcs arrive pre-sampled as polylines so the
 * importer needs no analytic Bézier/ellipse support downstream.
 */
/**
 * The source layer a primitive came from (DXF group code 8). Used for the
 * import layer picker (ADR-0088). SVG has no layers, so its primitives carry
 * the single default layer.
 */
export type ImportPrimitive =
  | { readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2; readonly layer?: string }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly r: number; readonly layer?: string }
  | {
      readonly kind: 'arc';
      readonly center: Vec2;
      readonly start: Vec2;
      readonly end: Vec2;
      readonly ccw: boolean;
      readonly layer?: string;
    }
  | {
      readonly kind: 'polyline';
      readonly points: readonly Vec2[];
      readonly closed: boolean;
      readonly layer?: string;
    };

export interface ImportResult {
  readonly primitives: readonly ImportPrimitive[];
  /** Non-fatal notes (unsupported elements skipped, etc.) for a toast. */
  readonly warnings: readonly string[];
}

/** A source layer and how many primitives it contributed (import layer picker). */
export interface ImportLayer {
  readonly name: string;
  readonly count: number;
}

/** Distinct source layers with primitive counts, sorted by name (blank layer → last). */
export function importLayers(primitives: readonly ImportPrimitive[]): ImportLayer[] {
  const counts = new Map<string, number>();
  for (const p of primitives) {
    const name = p.layer ?? '';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === '' ? 1 : b.name === '' ? -1 : a.name.localeCompare(b.name)));
}

/** Curve tessellation density for imported Béziers / ellipses / SVG arcs. */
export const IMPORT_CURVE_SEGMENTS = 24;
