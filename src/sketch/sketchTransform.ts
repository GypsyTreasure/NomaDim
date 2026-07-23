import {
  add,
  createId,
  dot,
  normalize,
  perp,
  rotate,
  scale,
  sub,
  vec2,
  type EntityId,
  type PointId,
  type Vec2,
} from '../core';
import {
  pointMap,
  referencedPointIds,
  type Sketch,
  type SketchEntity,
  type SketchPoint,
} from '../document';

/**
 * Sketch Mirror & Pattern (#2, solver-free): pure generation of NEW pool points
 * + entities that are transformed copies of a selection, ready to hand to the
 * `AddSketchGeometry` command. No timeline op — like Rectangle/Polygon these
 * expand to plain entities on commit. Every referenced point is copied once per
 * instance (shared endpoints among the selection stay shared in the copy), and a
 * reflection flips arc orientation so mirrored arcs bulge the right way.
 */

export interface SketchGeometryDelta {
  readonly points: readonly SketchPoint[];
  readonly entities: readonly SketchEntity[];
}

/** Reflects `p` across the infinite line through `a` with direction `d`. */
export function reflectPoint(p: Vec2, a: Vec2, d: Vec2): Vec2 {
  const n = normalize(perp(d)); // unit normal to the mirror line
  const v = sub(p, a);
  return sub(p, scale(n, 2 * dot(v, n)));
}

/** Rotates `p` about `center` by `angleRad`. */
export function rotateAbout(p: Vec2, center: Vec2, angleRad: number): Vec2 {
  return add(center, rotate(sub(p, center), angleRad));
}

/**
 * Applies one point-transform to `entityIds`, minting fresh point + entity ids
 * (accumulated into `taken` so repeated instances never collide). A reflection
 * passes `reverseArc = true` so copied arcs keep their visual sweep.
 */
function transformOnce(
  sketch: Sketch,
  entityIds: ReadonlySet<EntityId>,
  xform: (p: Vec2) => Vec2,
  reverseArc: boolean,
  taken: Set<string>
): SketchGeometryDelta {
  const points = pointMap(sketch);
  const selected = sketch.entities.filter((e) => entityIds.has(e.id));

  // Copy each referenced pool point once; map old id → new id.
  const idMap = new Map<PointId, PointId>();
  const newPoints: SketchPoint[] = [];
  for (const entity of selected) {
    for (const oldId of referencedPointIds(entity)) {
      if (idMap.has(oldId)) continue;
      const src = points.get(oldId);
      if (!src) continue;
      const moved = xform(vec2(src.x, src.y));
      const newId = createId<'PointId'>(taken);
      taken.add(newId);
      idMap.set(oldId, newId);
      newPoints.push({ id: newId, x: moved.x, y: moved.y });
    }
  }

  const newEntities: SketchEntity[] = [];
  for (const entity of selected) {
    const id = createId<'EntityId'>(taken);
    taken.add(id);
    const mapped = (pid: PointId): PointId => idMap.get(pid) ?? pid;
    switch (entity.type) {
      case 'line':
        newEntities.push({
          type: 'line',
          id,
          start: mapped(entity.start),
          end: mapped(entity.end),
          construction: entity.construction,
          ...(entity.axis ? { axis: true } : {}),
        });
        break;
      case 'circle':
        newEntities.push({
          type: 'circle',
          id,
          center: mapped(entity.center),
          r: entity.r,
          construction: entity.construction,
        });
        break;
      case 'arc':
        newEntities.push({
          type: 'arc',
          id,
          center: mapped(entity.center),
          start: mapped(entity.start),
          end: mapped(entity.end),
          // A reflection reverses orientation, so flip ccw to preserve the sweep.
          ccw: reverseArc ? !entity.ccw : entity.ccw,
          construction: entity.construction,
        });
        break;
      case 'point':
        newEntities.push({
          type: 'point',
          id,
          point: mapped(entity.point),
          construction: entity.construction,
        });
        break;
      default: {
        const exhaustive: never = entity;
        return exhaustive;
      }
    }
  }

  return { points: newPoints, entities: newEntities };
}

/** Every id already used in the sketch (points, entities, dimensions). */
function existingSketchIds(sketch: Sketch): Set<string> {
  const ids = new Set<string>();
  for (const p of sketch.points) ids.add(p.id);
  for (const e of sketch.entities) ids.add(e.id);
  for (const d of sketch.dimensions) ids.add(d.id);
  return ids;
}

/** Mirror the selected entities across the line through `a`→`b` (#2). */
export function mirrorEntities(
  sketch: Sketch,
  entityIds: ReadonlySet<EntityId>,
  a: Vec2,
  b: Vec2
): SketchGeometryDelta {
  const d = sub(b, a);
  const taken = existingSketchIds(sketch);
  return transformOnce(sketch, entityIds, (p) => reflectPoint(p, a, d), true, taken);
}

export interface LinearPatternSpec {
  readonly kind: 'linear';
  readonly count: number;
  /** Per-step offset (mm). */
  readonly dx: number;
  readonly dy: number;
}

export interface CircularPatternSpec {
  readonly kind: 'circular';
  readonly count: number;
  readonly center: Vec2;
  /** Total sweep (radians) across all instances. */
  readonly totalAngleRad: number;
}

export type SketchPatternSpec = LinearPatternSpec | CircularPatternSpec;

/** Array the selected entities linearly or circularly (#2). Position 0 is the
 * source; `count - 1` transformed copies are generated. */
export function patternEntities(
  sketch: Sketch,
  entityIds: ReadonlySet<EntityId>,
  spec: SketchPatternSpec
): SketchGeometryDelta {
  const taken = existingSketchIds(sketch);
  const points: SketchPoint[] = [];
  const entities: SketchEntity[] = [];
  const steps = Math.max(0, Math.floor(spec.count) - 1);
  for (let i = 1; i <= steps; i += 1) {
    const xform =
      spec.kind === 'linear'
        ? (p: Vec2): Vec2 => add(p, vec2(spec.dx * i, spec.dy * i))
        : (p: Vec2): Vec2 => rotateAbout(p, spec.center, (spec.totalAngleRad / steps) * i);
    const delta = transformOnce(sketch, entityIds, xform, false, taken);
    points.push(...delta.points);
    entities.push(...delta.entities);
  }
  return { points, entities };
}
