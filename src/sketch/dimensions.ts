import {
  RAD_TO_DEG,
  add,
  angleOf,
  distance,
  fromAngle,
  normalize,
  normalizeAngle,
  perp,
  scale,
  sub,
  vec2,
  type EntityId,
  type PointId,
  type Vec2,
} from '../core';
import type { SketchDimension, SketchDimensionKind, SketchEntity } from '../document';

/**
 * Reference-dimension geometry (solver-free, ADR-0002). Every value is
 * MEASURED from the two live point positions — dimensions annotate, they
 * never drive. Pure plane-space (mm) math: no DOM, no projection. The
 * viewport overlay projects the returned segments/anchor through the live
 * camera, so annotations stay correct under pan/zoom/orbit.
 */

/** Segment (plane-space mm) of a dimension's extension/dimension lines. */
export type DimensionSegment = readonly [Vec2, Vec2];

export interface DimensionRender {
  /** Extension + dimension lines (and, for `angle`, the sampled arc). */
  readonly segments: readonly DimensionSegment[];
  /** Where the label text is anchored (plane-space mm), centred by the drawer. */
  readonly labelAnchor: Vec2;
  readonly label: string;
}

/** Fallback dimension-line offset (mm) when a dimension has none stored. */
export const DEFAULT_DIMENSION_OFFSET_MM = 10;

/**
 * The two plane-space endpoints a dimension measures, resolved live (#1). For a
 * two-point dimension these are the referenced pool points; for a radial
 * dimension (`entityId` set) the first is the entity centre and the second is a
 * rim point synthesized from the entity's current radius — a full circle has no
 * rim pool point, so this is how radius/diameter dims annotate one. Pure: the
 * caller supplies point/entity lookups (no DOM, unit-testable, R11).
 */
export function dimensionEndpoints(
  dim: SketchDimension,
  pointById: (id: PointId) => Vec2 | undefined,
  entityById: (id: EntityId) => SketchEntity | undefined
): readonly [Vec2, Vec2] | null {
  if (dim.entityId !== undefined) {
    const entity = entityById(dim.entityId);
    if (!entity) return null;
    if (entity.type === 'circle') {
      const c = pointById(entity.center);
      return c ? [c, vec2(c.x + entity.r, c.y)] : null;
    }
    if (entity.type === 'arc') {
      const c = pointById(entity.center);
      const rim = pointById(entity.start);
      return c && rim ? [c, rim] : null;
    }
    return null;
  }
  const a = pointById(dim.a);
  const b = pointById(dim.b);
  return a && b ? [a, b] : null;
}

/**
 * The raw measured quantity: millimetres for length kinds, degrees for
 * `angle`. Always non-negative for the length kinds (a dimension has no
 * side); `angle` is the a→b inclination in [0, 360).
 */
export function dimensionMeasure(kind: SketchDimensionKind, a: Vec2, b: Vec2): number {
  switch (kind) {
    case 'linear':
    case 'radius':
      return distance(a, b);
    case 'diameter':
      return 2 * distance(a, b);
    case 'horizontal':
      return Math.abs(b.x - a.x);
    case 'vertical':
      return Math.abs(b.y - a.y);
    case 'angle':
      return normalizeAngle(angleOf(sub(b, a))) * RAD_TO_DEG;
    default: {
      const never: never = kind;
      return never;
    }
  }
}

function trimNumber(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/** User-facing annotation text, e.g. `42.5`, `R12`, `30°`. */
export function dimensionLabel(kind: SketchDimensionKind, a: Vec2, b: Vec2): string {
  const value = dimensionMeasure(kind, a, b);
  switch (kind) {
    case 'linear':
    case 'horizontal':
    case 'vertical':
      return trimNumber(value);
    case 'radius':
      return `R${trimNumber(value)}`;
    case 'diameter':
      return `⌀${trimNumber(value)}`;
    case 'angle':
      return `${trimNumber(value)}°`;
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** Base line coordinate offset outward past the extreme point on that axis. */
function outerOffset(lo: number, hi: number, offset: number): number {
  return (offset >= 0 ? hi : lo) + offset;
}

function renderAngle(a: Vec2, b: Vec2, offset: number, label: string): DimensionRender {
  const dir = normalize(sub(b, a));
  const startAngle = 0; // +X reference ray
  const endAngle = normalizeAngle(angleOf(dir));
  const radius = Math.max(Math.abs(offset), 1);
  const steps = Math.max(2, Math.ceil((endAngle / (Math.PI / 2)) * 8));
  const arc: DimensionSegment[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t0 = startAngle + ((endAngle - startAngle) * i) / steps;
    const t1 = startAngle + ((endAngle - startAngle) * (i + 1)) / steps;
    arc.push([add(a, scale(fromAngle(t0), radius)), add(a, scale(fromAngle(t1), radius))]);
  }
  const refRay: DimensionSegment = [a, add(a, scale(vec2(1, 0), radius))];
  const dirRay: DimensionSegment = [a, add(a, scale(dir, radius))];
  const labelAnchor = add(a, scale(fromAngle(endAngle / 2), radius * 1.25));
  return { segments: [refRay, dirRay, ...arc], labelAnchor, label };
}

/**
 * Full plane-space geometry for one dimension. `a`/`b` are the current
 * positions of the referenced pool points (measured live).
 */
export function dimensionRender(dim: SketchDimension, a: Vec2, b: Vec2): DimensionRender {
  const { kind, offset } = dim;
  const label = dimensionLabel(kind, a, b);

  if (kind === 'angle') return renderAngle(a, b, offset, label);

  if (kind === 'horizontal') {
    const y = outerOffset(Math.min(a.y, b.y), Math.max(a.y, b.y), offset);
    const p1 = vec2(a.x, y);
    const p2 = vec2(b.x, y);
    return {
      segments: [
        [a, p1],
        [b, p2],
        [p1, p2],
      ],
      labelAnchor: vec2((a.x + b.x) / 2, y),
      label,
    };
  }

  if (kind === 'vertical') {
    const x = outerOffset(Math.min(a.x, b.x), Math.max(a.x, b.x), offset);
    const p1 = vec2(x, a.y);
    const p2 = vec2(x, b.y);
    return {
      segments: [
        [a, p1],
        [b, p2],
        [p1, p2],
      ],
      labelAnchor: vec2(x, (a.y + b.y) / 2),
      label,
    };
  }

  if (kind === 'radius') {
    const dir = normalize(sub(b, a));
    const n = perp(dir);
    const anchor = add(scale(add(a, b), 0.5), scale(n, offset));
    return { segments: [[a, b]], labelAnchor: anchor, label };
  }

  if (kind === 'diameter') {
    // Full chord through the centre: from the rim point b through centre a to
    // the opposite rim, labelled ⌀ at the far end.
    const dir = normalize(sub(b, a));
    const far = sub(a, scale(dir, distance(a, b)));
    const anchor = add(b, scale(perp(dir), offset));
    return { segments: [[far, b]], labelAnchor: anchor, label };
  }

  // linear: dimension line parallel to a→b, offset perpendicular.
  const n = perp(normalize(sub(b, a)));
  const p1 = add(a, scale(n, offset));
  const p2 = add(b, scale(n, offset));
  return {
    segments: [
      [a, p1],
      [b, p2],
      [p1, p2],
    ],
    labelAnchor: scale(add(p1, p2), 0.5),
    label,
  };
}
