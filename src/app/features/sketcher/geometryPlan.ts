import { createId, distance, vec2, type EntityId, type PointId, type Vec2 } from '../../../core';
import type { Sketch, SketchEntity, SketchPoint } from '../../../document';

/**
 * Commit-plan assembly for sketch tools: turns tool geometry into the
 * `AddSketchGeometry` payload (new pool points + entities), merging
 * endpoints with existing pool points so shared corners are ONE point —
 * real topology, not coincident coordinates (ARCHITECTURE §8). Merging by
 * coordinates matters for keyboard-only drawing, where the closing segment
 * lands exactly on the start point without ever snapping.
 */

/** Coordinate-merge tolerance: typed values reproduce coordinates exactly. */
const MERGE_TOL_MM = 1e-6;

export interface PointSpec {
  readonly p: Vec2;
  /** Set when a snap already resolved this to an existing pool point. */
  readonly existing?: PointId;
}

export class GeometryPlan {
  private readonly newPoints: SketchPoint[] = [];
  readonly entities: SketchEntity[] = [];
  private readonly usedIds: Set<string>;

  constructor(private readonly sketch: Sketch) {
    this.usedIds = new Set<string>([
      ...sketch.points.map((p) => p.id),
      ...sketch.entities.map((e) => e.id),
    ]);
  }

  /** Resolves a PointSpec to a pool id — existing ref, coordinate match, or a new point. */
  resolvePoint(spec: PointSpec): PointId {
    if (spec.existing) return spec.existing;
    for (const point of [...this.sketch.points, ...this.newPoints]) {
      if (distance(vec2(point.x, point.y), spec.p) <= MERGE_TOL_MM) return point.id;
    }
    const id = createId<'PointId'>(this.usedIds);
    this.usedIds.add(id);
    this.newPoints.push({ id, x: spec.p.x, y: spec.p.y });
    return id;
  }

  newEntityId(): EntityId {
    const id = createId<'EntityId'>(this.usedIds);
    this.usedIds.add(id);
    return id;
  }

  addLine(start: PointSpec, end: PointSpec, construction: boolean): PointId {
    const startId = this.resolvePoint(start);
    const endId = this.resolvePoint(end);
    this.entities.push({
      type: 'line',
      id: this.newEntityId(),
      start: startId,
      end: endId,
      construction,
    });
    return endId;
  }

  addCircle(center: PointSpec, r: number, construction: boolean): void {
    this.entities.push({
      type: 'circle',
      id: this.newEntityId(),
      center: this.resolvePoint(center),
      r,
      construction,
    });
  }

  addArc(
    center: PointSpec,
    start: PointSpec,
    end: PointSpec,
    ccw: boolean,
    construction: boolean
  ): void {
    this.entities.push({
      type: 'arc',
      id: this.newEntityId(),
      center: this.resolvePoint(center),
      start: this.resolvePoint(start),
      end: this.resolvePoint(end),
      ccw,
      construction,
    });
  }

  addPointEntity(at: PointSpec, construction: boolean): void {
    this.entities.push({
      type: 'point',
      id: this.newEntityId(),
      point: this.resolvePoint(at),
      construction,
    });
  }

  get payload(): { points: readonly SketchPoint[]; entities: readonly SketchEntity[] } {
    return { points: this.newPoints, entities: this.entities };
  }
}
