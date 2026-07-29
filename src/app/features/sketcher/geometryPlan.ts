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

/** Spatial-hash cell size — a small multiple of the merge tolerance. */
const CELL_MM = MERGE_TOL_MM * 4;

export class GeometryPlan {
  private readonly newPoints: SketchPoint[] = [];
  readonly entities: SketchEntity[] = [];
  private readonly usedIds: Set<string>;
  /**
   * Spatial hash of every candidate point (existing + newly added), so
   * coordinate-merge lookups are O(1) instead of scanning the whole pool.
   * Without this an import of thousands of primitives is O(n²) and freezes the
   * UI for seconds; with it the same import is near-instant.
   */
  private readonly index = new Map<string, SketchPoint[]>();

  constructor(sketch: Sketch) {
    this.usedIds = new Set<string>([
      ...sketch.points.map((p) => p.id),
      ...sketch.entities.map((e) => e.id),
    ]);
    for (const point of sketch.points) this.addToIndex(point);
  }

  private cellKey(cx: number, cy: number): string {
    return `${String(cx)}:${String(cy)}`;
  }

  private addToIndex(point: SketchPoint): void {
    const cx = Math.round(point.x / CELL_MM);
    const cy = Math.round(point.y / CELL_MM);
    const key = this.cellKey(cx, cy);
    const bucket = this.index.get(key);
    if (bucket) bucket.push(point);
    else this.index.set(key, [point]);
  }

  /** Resolves a PointSpec to a pool id — existing ref, coordinate match, or a new point. */
  resolvePoint(spec: PointSpec): PointId {
    if (spec.existing) return spec.existing;
    // Scan the point's cell and its eight neighbours (a merge candidate may
    // straddle a cell boundary), then confirm with an exact distance check.
    const cx = Math.round(spec.p.x / CELL_MM);
    const cy = Math.round(spec.p.y / CELL_MM);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = this.index.get(this.cellKey(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const point of bucket) {
          if (distance(vec2(point.x, point.y), spec.p) <= MERGE_TOL_MM) return point.id;
        }
      }
    }
    const id = createId<'PointId'>(this.usedIds);
    this.usedIds.add(id);
    const point: SketchPoint = { id, x: spec.p.x, y: spec.p.y };
    this.newPoints.push(point);
    this.addToIndex(point);
    return id;
  }

  newEntityId(): EntityId {
    const id = createId<'EntityId'>(this.usedIds);
    this.usedIds.add(id);
    return id;
  }

  addLine(start: PointSpec, end: PointSpec, construction: boolean, axis = false): PointId {
    const startId = this.resolvePoint(start);
    const endId = this.resolvePoint(end);
    this.entities.push({
      type: 'line',
      id: this.newEntityId(),
      start: startId,
      end: endId,
      construction,
      axis,
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

  /** Fit-point spline through ≥2 points (Spline tool); `closed` loops it. */
  addSpline(fit: readonly PointSpec[], closed: boolean, construction: boolean): void {
    if (fit.length < 2) return;
    this.entities.push({
      type: 'spline',
      id: this.newEntityId(),
      points: fit.map((spec) => this.resolvePoint(spec)),
      closed,
      construction,
    });
  }

  get payload(): { points: readonly SketchPoint[]; entities: readonly SketchEntity[] } {
    return { points: this.newPoints, entities: this.entities };
  }
}
