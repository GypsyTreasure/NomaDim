import { angleOf, normalizeAngle, sub, type EntityId, type PointId, type Vec2 } from '../../core';
import { pointMap, type Sketch } from '../../document';
import { evaluateEntity, type ArcCurve } from '../entities/curves';
import { sampleCurve } from '../entities/queries';

/**
 * Closed-loop extraction over shared-endpoint connectivity (ARCHITECTURE
 * R7, MASTER_DOCUMENT F2 "Finish Sketch"). Standard planar half-edge face
 * traversal: outgoing half-edges are sorted by exact tangent departure
 * angle at each node; walking `next = clockwise-neighbor of the twin`
 * traces every bounded face counterclockwise (positive shoelace area) and
 * the unbounded face clockwise (skipped). Entities are assumed to meet only
 * at shared pool points — crossing entities do not split regions in v1
 * (ADR-0012).
 */

export interface TraversedLoop {
  /** Contributing entities in traversal order (deduped — a slit edge counts once). */
  readonly entityIds: readonly EntityId[];
  /** CCW polyline approximation (arcs sampled), closed implicitly. */
  readonly polygon: readonly Vec2[];
  /** Enclosed area (positive). */
  readonly area: number;
}

export interface LoopExtraction {
  readonly loops: readonly TraversedLoop[];
  /** Curve entities on no closed region boundary: dangling chains, bridges. */
  readonly openEntityIds: readonly EntityId[];
}

/** Chord tolerance for polygon approximation of arcs (containment/area tests). */
export const PROFILE_CHORD_TOL_MM = 0.05;

const AREA_EPS_MM2 = 1e-9;

interface GraphEdge {
  readonly entityId: EntityId;
  readonly aId: PointId;
  readonly bId: PointId;
  /** Samples ordered a→b. */
  readonly samplesAB: readonly Vec2[];
  /** Exact tangent departure angle at a, traveling a→b. */
  readonly depA: number;
  /** Exact tangent departure angle at b, traveling b→a. */
  readonly depB: number;
}

/** Wraps into (-PI, PI] so sorting is total and stable. */
function wrapAngle(angle: number): number {
  const a = normalizeAngle(angle);
  return a > Math.PI ? a - 2 * Math.PI : a;
}

function arcDepartures(curve: ArcCurve, entityCcw: boolean): { depA: number; depB: number } {
  const thetaStart = curve.startAngle;
  const thetaEnd = curve.startAngle + curve.sweep;
  // CCW travel tangent at angle θ points along θ + π/2; CW travel along θ - π/2.
  if (entityCcw) {
    // a = curve start, b = curve end.
    return { depA: wrapAngle(thetaStart + Math.PI / 2), depB: wrapAngle(thetaEnd - Math.PI / 2) };
  }
  // a = curve end (travel CW toward curve start), b = curve start.
  return { depA: wrapAngle(thetaEnd - Math.PI / 2), depB: wrapAngle(thetaStart + Math.PI / 2) };
}

function buildEdges(sketch: Sketch): GraphEdge[] {
  const points = pointMap(sketch);
  const edges: GraphEdge[] = [];
  for (const entity of sketch.entities) {
    if (entity.construction) continue;
    if (entity.type !== 'line' && entity.type !== 'arc') continue;
    const curve = evaluateEntity(entity, points);
    if (!curve) continue;

    if (entity.type === 'line' && curve.kind === 'segment') {
      edges.push({
        entityId: entity.id,
        aId: entity.start,
        bId: entity.end,
        samplesAB: [curve.a, curve.b],
        depA: angleOf(sub(curve.b, curve.a)),
        depB: angleOf(sub(curve.a, curve.b)),
      });
    } else if (entity.type === 'arc' && curve.kind === 'arc') {
      const samples = sampleCurve(curve, PROFILE_CHORD_TOL_MM);
      const samplesAB = entity.ccw ? [...samples] : [...samples].reverse();
      const { depA, depB } = arcDepartures(curve, entity.ccw);
      edges.push({
        entityId: entity.id,
        aId: entity.start,
        bId: entity.end,
        samplesAB,
        depA,
        depB,
      });
    }
  }
  return edges;
}

/** Iteratively removes edges with a degree-1 endpoint; returns surviving edge indices. */
function peelDanglingChains(edges: readonly GraphEdge[]): Set<number> {
  const alive = new Set<number>(edges.map((_, i) => i));
  let changed = true;
  while (changed) {
    changed = false;
    const degree = new Map<PointId, number>();
    for (const i of alive) {
      const edge = edges[i];
      if (!edge) continue;
      degree.set(edge.aId, (degree.get(edge.aId) ?? 0) + 1);
      degree.set(edge.bId, (degree.get(edge.bId) ?? 0) + 1);
    }
    for (const i of [...alive]) {
      const edge = edges[i];
      if (!edge) continue;
      if ((degree.get(edge.aId) ?? 0) < 2 || (degree.get(edge.bId) ?? 0) < 2) {
        alive.delete(i);
        changed = true;
      }
    }
  }
  return alive;
}

function shoelace(polygon: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    if (!p || !q) continue;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/**
 * Extracts closed loops from a sketch's line/arc connectivity.
 * Half-edge encoding: edge i → half-edges 2i (a→b) and 2i+1 (b→a).
 */
export function extractLoops(sketch: Sketch): LoopExtraction {
  const edges = buildEdges(sketch);
  const alive = peelDanglingChains(edges);

  const from = (h: number): PointId => {
    const edge = edges[h >> 1];
    if (!edge) throw new Error('half-edge out of range');
    return h % 2 === 0 ? edge.aId : edge.bId;
  };
  const departure = (h: number): number => {
    const edge = edges[h >> 1];
    if (!edge) throw new Error('half-edge out of range');
    return h % 2 === 0 ? edge.depA : edge.depB;
  };
  const twin = (h: number): number => h ^ 1;

  // Outgoing half-edges per node, sorted by departure angle ascending.
  const outgoing = new Map<PointId, number[]>();
  for (const i of alive) {
    for (const h of [2 * i, 2 * i + 1]) {
      const node = from(h);
      const list = outgoing.get(node) ?? [];
      list.push(h);
      outgoing.set(node, list);
    }
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => departure(a) - departure(b));
  }

  const nextHalfEdge = (h: number): number => {
    const t = twin(h);
    const list = outgoing.get(from(t));
    if (!list || list.length === 0) throw new Error('inconsistent half-edge graph');
    const idx = list.indexOf(t);
    return list[(idx - 1 + list.length) % list.length] ?? t;
  };

  const visited = new Set<number>();
  const loops: TraversedLoop[] = [];
  const closedEntities = new Set<EntityId>();

  for (const i of alive) {
    for (const start of [2 * i, 2 * i + 1]) {
      if (visited.has(start)) continue;
      const face: number[] = [];
      let h = start;
      do {
        visited.add(h);
        face.push(h);
        h = nextHalfEdge(h);
      } while (h !== start && face.length <= 4 * edges.length);

      // Assemble the polygon in travel order (skip each half-edge's last sample).
      const polygon: Vec2[] = [];
      const faceEntities: EntityId[] = [];
      for (const he of face) {
        const edge = edges[he >> 1];
        if (!edge) continue;
        const travel = he % 2 === 0 ? edge.samplesAB : [...edge.samplesAB].reverse();
        for (let s = 0; s < travel.length - 1; s += 1) {
          const p = travel[s];
          if (p) polygon.push(p);
        }
        faceEntities.push(edge.entityId);
      }

      const area = shoelace(polygon);
      if (area > AREA_EPS_MM2) {
        const entityIds = [...new Set(faceEntities)];
        loops.push({ entityIds, polygon, area });
        for (const id of entityIds) closedEntities.add(id);
      }
    }
  }

  const openEntityIds = edges.map((edge) => edge.entityId).filter((id) => !closedEntities.has(id));

  return { loops, openEntityIds: [...new Set(openEntityIds)] };
}
