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
import {
  pointMap,
  type Sketch,
  type SketchDimension,
  type SketchDimensionKind,
  type SketchEntity,
} from '../document';
import { evaluateSketch } from './entities/curves';
import { distanceToCurve } from './entities/queries';

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
  /** True when this dimension is the current selection (drawn highlighted). */
  readonly selected?: boolean;
}

/** Horizontal vs vertical from the span — AutoCAD's `auto` rule (dominant axis). */
export function linearKindFromSpan(a: Vec2, b: Vec2): 'horizontal' | 'vertical' {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'horizontal' : 'vertical';
}

/** The Dim tool's kind setting: `auto` (resolve to H/V) or a concrete kind. */
export type DimensionPickKind = 'auto' | SketchDimensionKind;

/**
 * Line-pick dimensioning (#6c): resolves the nearest straight line to `target`
 * (within `tolMm`) into a length dimension between its two endpoints. `kind` is
 * the tool setting; `auto` and the circle-only radius/diameter fall back to the
 * H/V span rule. Pure — the app mints the id and dispatches AddSketchDimension.
 */
export function pickLineDimension(
  sketch: Sketch,
  target: Vec2,
  tolMm: number,
  kind: DimensionPickKind
): { a: PointId; b: PointId; kind: SketchDimensionKind } | null {
  let lineId: EntityId | null = null;
  let best = tolMm;
  for (const ev of evaluateSketch(sketch)) {
    const ent = sketch.entities.find((e) => e.id === ev.entityId);
    if (ent?.type !== 'line') continue;
    const d = distanceToCurve(ev.curve, target);
    if (d <= best) {
      best = d;
      lineId = ev.entityId;
    }
  }
  const line = sketch.entities.find((e) => e.id === lineId);
  if (line?.type !== 'line') return null;
  const pts = pointMap(sketch);
  const a = pts.get(line.start);
  const b = pts.get(line.end);
  if (!a || !b) return null;
  const resolved =
    kind === 'auto' || kind === 'radius' || kind === 'diameter'
      ? linearKindFromSpan(vec2(a.x, a.y), vec2(b.x, b.y))
      : kind;
  return { a: line.start, b: line.end, kind: resolved };
}

/** Perpendicular distance (mm) from `p` to the segment a–b. */
function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Closest distance (mm) from a plane-space point to a rendered dimension — the
 * nearest of its lines or its label anchor. Used to click-select a dimension
 * for deletion (pure, DOM-free, R11).
 */
export function distanceToDimension(render: DimensionRender, p: Vec2): number {
  let best = distance(p, render.labelAnchor);
  for (const [a, b] of render.segments) best = Math.min(best, pointToSegment(p, a, b));
  return best;
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
