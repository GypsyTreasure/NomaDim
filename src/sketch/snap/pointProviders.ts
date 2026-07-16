import { distance, vec2, type PointId, type Vec2 } from '../../core';
import type { SketchEntity } from '../../document';
import {
  closestPointOnCurve,
  curveMidpoint,
  intersectCurves,
  quadrantPoints,
} from '../entities/queries';
import type { EvaluatedEntity } from '../entities/curves';
import { SNAP_PRIORITY, type SnapCandidate, type SnapContext, type SnapProvider } from './types';

/** Point-snap providers (ARCHITECTURE §10 kinds). Each is independent and
 * returns every candidate within tolerance; the engine picks the winner. */

function within(ctx: SnapContext, p: Vec2): boolean {
  return distance(ctx.cursor, p) <= ctx.toleranceMm;
}

function make(
  p: Vec2,
  kind: SnapCandidate['kind'],
  sourceRef: SnapCandidate['sourceRef']
): SnapCandidate {
  return { point: p, kind, priority: SNAP_PRIORITY[kind], sourceRef };
}

function isExcluded(ctx: SnapContext, entity: EvaluatedEntity): boolean {
  return ctx.excludeEntityIds?.has(entity.entityId) ?? false;
}

/** Pool points playing an endpoint-like role (line/arc endpoints, point entities). */
function endpointPointIds(entities: readonly SketchEntity[]): ReadonlySet<PointId> {
  const ids = new Set<PointId>();
  for (const entity of entities) {
    switch (entity.type) {
      case 'line':
        ids.add(entity.start);
        ids.add(entity.end);
        break;
      case 'arc':
        ids.add(entity.start);
        ids.add(entity.end);
        break;
      case 'point':
        ids.add(entity.point);
        break;
      case 'circle':
        break;
      default: {
        const exhaustive: never = entity;
        return exhaustive;
      }
    }
  }
  return ids;
}

export const endpointProvider: SnapProvider = {
  name: 'endpoint',
  provide(ctx) {
    const excluded = ctx.excludeEntityIds;
    const relevant = excluded
      ? ctx.sketch.entities.filter((e) => !excluded.has(e.id))
      : ctx.sketch.entities;
    const ids = endpointPointIds(relevant);
    const out: SnapCandidate[] = [];
    for (const point of ctx.sketch.points) {
      if (!ids.has(point.id)) continue;
      const p = vec2(point.x, point.y);
      if (within(ctx, p)) {
        out.push(make(p, 'endpoint', { type: 'point', pointId: point.id }));
      }
    }
    return out;
  },
};

export const centerProvider: SnapProvider = {
  name: 'center',
  provide(ctx) {
    const out: SnapCandidate[] = [];
    for (const entity of ctx.sketch.entities) {
      if (entity.type !== 'circle' && entity.type !== 'arc') continue;
      if (ctx.excludeEntityIds?.has(entity.id)) continue;
      const point = ctx.sketch.points.find((p) => p.id === entity.center);
      if (!point) continue;
      const p = vec2(point.x, point.y);
      if (within(ctx, p)) {
        out.push(make(p, 'center', { type: 'point', pointId: point.id }));
      }
    }
    return out;
  },
};

export const midpointProvider: SnapProvider = {
  name: 'midpoint',
  provide(ctx) {
    const out: SnapCandidate[] = [];
    for (const entity of ctx.evaluated) {
      if (isExcluded(ctx, entity)) continue;
      const mid = curveMidpoint(entity.curve);
      if (mid && within(ctx, mid)) {
        out.push(make(mid, 'midpoint', { type: 'entity', entityId: entity.entityId }));
      }
    }
    return out;
  },
};

export const quadrantProvider: SnapProvider = {
  name: 'quadrant',
  provide(ctx) {
    const out: SnapCandidate[] = [];
    for (const entity of ctx.evaluated) {
      if (isExcluded(ctx, entity)) continue;
      for (const q of quadrantPoints(entity.curve)) {
        if (within(ctx, q)) {
          out.push(make(q, 'quadrant', { type: 'entity', entityId: entity.entityId }));
        }
      }
    }
    return out;
  },
};

export const intersectionProvider: SnapProvider = {
  name: 'intersection',
  provide(ctx) {
    const out: SnapCandidate[] = [];
    const list = ctx.evaluated.filter((e) => !isExcluded(ctx, e));
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (!a || !b) continue;
        for (const p of intersectCurves(a.curve, b.curve)) {
          if (within(ctx, p)) {
            out.push(
              make(p, 'intersection', {
                type: 'entities',
                entityIds: [a.entityId, b.entityId],
              })
            );
          }
        }
      }
    }
    return out;
  },
};

export const onEntityProvider: SnapProvider = {
  name: 'on-entity',
  provide(ctx) {
    const out: SnapCandidate[] = [];
    for (const entity of ctx.evaluated) {
      if (isExcluded(ctx, entity)) continue;
      const p = closestPointOnCurve(entity.curve, ctx.cursor);
      if (within(ctx, p)) {
        out.push(make(p, 'on-entity', { type: 'entity', entityId: entity.entityId }));
      }
    }
    return out;
  },
};

/**
 * The sketch origin (0,0) — the base datum every dimension can reference
 * (F2 "base point"). Always available, independent of drawn geometry; a
 * committed point landing here merges by coordinates like any other snap.
 */
export const originProvider: SnapProvider = {
  name: 'origin',
  provide(ctx) {
    const o = vec2(0, 0);
    return within(ctx, o) ? [make(o, 'origin', { type: 'free' })] : [];
  },
};

export const gridProvider: SnapProvider = {
  name: 'grid',
  provide(ctx) {
    if (!(ctx.gridSpacingMm > 0)) return [];
    const s = ctx.gridSpacingMm;
    const p = vec2(Math.round(ctx.cursor.x / s) * s, Math.round(ctx.cursor.y / s) * s);
    return within(ctx, p) ? [make(p, 'grid', { type: 'free' })] : [];
  },
};

/** Canonical provider order (highest-value kinds first; ties resolved by priority anyway). */
export const DEFAULT_POINT_PROVIDERS: readonly SnapProvider[] = [
  originProvider,
  endpointProvider,
  intersectionProvider,
  midpointProvider,
  centerProvider,
  quadrantProvider,
  onEntityProvider,
  gridProvider,
];
