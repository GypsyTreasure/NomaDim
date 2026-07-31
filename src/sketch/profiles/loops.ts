import { angleOf, normalizeAngle, sub, type EntityId, type PointId, type Vec2 } from '../../core';
import { pointMap, type LoopGeometry, type LoopSegment, type Sketch } from '../../document';
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
  /** Travel-ordered oriented segments — the worker builds wires from these (R7). */
  readonly segments: LoopGeometry;
}

/** A connected chain of open (non-loop) entities — the input for a surface
 * body swept from open geometry (#12, ADR-0097). Ordered a→…→b; NOT closed. */
export interface OpenChain {
  readonly entityIds: readonly EntityId[];
  /** Ordered polyline of the whole chain (arcs sampled) — display/preview only. */
  readonly polygon: readonly Vec2[];
  /** Travel-ordered oriented segments — the worker builds an open wire from these. */
  readonly segments: LoopGeometry;
}

export interface LoopExtraction {
  readonly loops: readonly TraversedLoop[];
  /** Curve entities on no closed region boundary: dangling chains, bridges. */
  readonly openEntityIds: readonly EntityId[];
  /** Open entities grouped into ordered connected chains (#12). */
  readonly openChains: readonly OpenChain[];
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
  /** Oriented segment for travel a→b (reverse for b→a). */
  readonly segmentAB: LoopSegment;
}

/** Reverses an oriented loop segment. */
function reverseSegment(segment: LoopSegment): LoopSegment {
  switch (segment.kind) {
    case 'line':
      return { kind: 'line', a: segment.b, b: segment.a };
    case 'arc':
      return { kind: 'arc', a: segment.b, b: segment.a, center: segment.center, ccw: !segment.ccw };
    case 'circle':
      return segment;
    case 'polyline':
      return { kind: 'polyline', points: [...segment.points].reverse() };
    default: {
      const exhaustive: never = segment;
      return exhaustive;
    }
  }
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
    if (entity.type !== 'line' && entity.type !== 'arc' && entity.type !== 'spline') continue;
    const curve = evaluateEntity(entity, points);
    if (!curve) continue;

    // Open spline: an edge between its first & last fit point, geometry = its
    // tessellated polyline (a closed spline is a standalone loop, handled in
    // detect.ts alongside circles).
    if (entity.type === 'spline' && curve.kind === 'spline' && !entity.closed) {
      const samplesAB = curve.samples;
      const first = samplesAB[0];
      const second = samplesAB[1];
      const last = samplesAB[samplesAB.length - 1];
      const penultimate = samplesAB[samplesAB.length - 2];
      const aId = entity.points[0];
      const bId = entity.points[entity.points.length - 1];
      if (!first || !second || !last || !penultimate || !aId || !bId) continue;
      edges.push({
        entityId: entity.id,
        aId,
        bId,
        samplesAB,
        depA: angleOf(sub(second, first)),
        depB: angleOf(sub(penultimate, last)),
        segmentAB: { kind: 'polyline', points: samplesAB },
      });
      continue;
    }

    if (entity.type === 'line' && curve.kind === 'segment') {
      edges.push({
        entityId: entity.id,
        aId: entity.start,
        bId: entity.end,
        samplesAB: [curve.a, curve.b],
        depA: angleOf(sub(curve.b, curve.a)),
        depB: angleOf(sub(curve.a, curve.b)),
        segmentAB: { kind: 'line', a: curve.a, b: curve.b },
      });
    } else if (entity.type === 'arc' && curve.kind === 'arc') {
      const samples = sampleCurve(curve, PROFILE_CHORD_TOL_MM);
      const samplesAB = entity.ccw ? [...samples] : [...samples].reverse();
      const { depA, depB } = arcDepartures(curve, entity.ccw);
      const first = samplesAB[0];
      const last = samplesAB[samplesAB.length - 1];
      if (!first || !last) continue;
      edges.push({
        entityId: entity.id,
        aId: entity.start,
        bId: entity.end,
        samplesAB,
        depA,
        depB,
        // Traveling entity.start→entity.end runs along the canonical CCW
        // curve exactly when the entity itself is CCW.
        segmentAB: { kind: 'arc', a: first, b: last, center: curve.center, ccw: entity.ccw },
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
 * Groups the open (non-loop) edges into ordered connected chains (#12). Each
 * chain is a maximal walk over shared endpoints: we start from a free end
 * (degree 1) where possible so a simple polyline yields one correctly ordered
 * chain, and consume every open edge (a branch point splits into more chains).
 */
function buildOpenChains(
  edges: readonly GraphEdge[],
  closedEntities: ReadonlySet<EntityId>
): OpenChain[] {
  const openIdx = edges
    .map((_, i) => i)
    .filter((i) => !closedEntities.has(edges[i]?.entityId ?? ('' as EntityId)));
  const incident = new Map<PointId, number[]>();
  for (const i of openIdx) {
    const e = edges[i];
    if (!e) continue;
    incident.set(e.aId, [...(incident.get(e.aId) ?? []), i]);
    incident.set(e.bId, [...(incident.get(e.bId) ?? []), i]);
  }
  const used = new Set<number>();
  const unusedDegree = (node: PointId): number =>
    (incident.get(node) ?? []).filter((i) => !used.has(i)).length;

  const chains: OpenChain[] = [];
  while (used.size < openIdx.length) {
    // Prefer a free end (degree 1) so the chain runs end-to-end; else any node.
    let node: PointId | null = null;
    for (const i of openIdx) {
      if (used.has(i)) continue;
      const e = edges[i];
      if (!e) continue;
      if (unusedDegree(e.aId) === 1) {
        node = e.aId;
        break;
      }
      if (unusedDegree(e.bId) === 1) {
        node = e.bId;
        break;
      }
    }
    if (node === null) {
      const seed = openIdx.find((i) => !used.has(i));
      if (seed === undefined) break;
      node = edges[seed]?.aId ?? null;
    }
    if (node === null) break;

    const segments: LoopSegment[] = [];
    const entityIds: EntityId[] = [];
    const polygon: Vec2[] = [];
    let current: PointId = node;
    let first = true;
    for (;;) {
      const nextEdge = (incident.get(current) ?? []).find((i) => !used.has(i));
      if (nextEdge === undefined) break;
      used.add(nextEdge);
      const e = edges[nextEdge];
      if (!e) break;
      const forward = e.aId === current;
      const travel = forward ? e.samplesAB : [...e.samplesAB].reverse();
      for (let s = first ? 0 : 1; s < travel.length; s += 1) {
        const p = travel[s];
        if (p) polygon.push(p);
      }
      segments.push(forward ? e.segmentAB : reverseSegment(e.segmentAB));
      entityIds.push(e.entityId);
      current = forward ? e.bId : e.aId;
      first = false;
    }
    if (segments.length > 0) chains.push({ entityIds: [...new Set(entityIds)], polygon, segments });
  }
  return chains;
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

      // Assemble polygon + oriented segments in travel order.
      const polygon: Vec2[] = [];
      const faceEntities: EntityId[] = [];
      const segments: LoopSegment[] = [];
      for (const he of face) {
        const edge = edges[he >> 1];
        if (!edge) continue;
        const travel = he % 2 === 0 ? edge.samplesAB : [...edge.samplesAB].reverse();
        for (let s = 0; s < travel.length - 1; s += 1) {
          const p = travel[s];
          if (p) polygon.push(p);
        }
        segments.push(he % 2 === 0 ? edge.segmentAB : reverseSegment(edge.segmentAB));
        faceEntities.push(edge.entityId);
      }

      const area = shoelace(polygon);
      if (area > AREA_EPS_MM2) {
        const entityIds = [...new Set(faceEntities)];
        loops.push({ entityIds, polygon, area, segments });
        for (const id of entityIds) closedEntities.add(id);
      }
    }
  }

  const openEntityIds = edges.map((edge) => edge.entityId).filter((id) => !closedEntities.has(id));
  const openChains = buildOpenChains(edges, closedEntities);

  return { loops, openEntityIds: [...new Set(openEntityIds)], openChains };
}
