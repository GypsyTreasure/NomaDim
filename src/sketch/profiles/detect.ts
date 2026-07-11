import type { EntityId, ProfileId, Vec2 } from '../../core';
import { pointMap, type Sketch } from '../../document';
import { evaluateEntity } from '../entities/curves';
import { sampleCurve } from '../entities/queries';
import { profileIdFor } from './hash';
import { extractLoops, PROFILE_CHORD_TOL_MM, type TraversedLoop } from './loops';

/**
 * Profile detection (MASTER_DOCUMENT F2 "Finish Sketch", ARCHITECTURE R7):
 * every closed region becomes a profile; loops nested inside another loop
 * become that profile's inner boundaries (holes) — AND remain selectable
 * profiles of their own, exactly like Fusion (a plate with a circular
 * cutout offers both the ring and the disk). Runs on the main thread; the
 * worker receives resolved loops and never re-derives topology (R7).
 */

export interface SketchProfile {
  /** Entity-set hash id (R7a) — never a detection-order index. */
  readonly id: ProfileId;
  readonly outer: TraversedLoop;
  readonly inner: readonly TraversedLoop[];
}

export interface ProfileDetectionResult {
  readonly profiles: readonly SketchProfile[];
  /** Non-construction curve entities on no closed boundary (F2: flagged, allowed). */
  readonly openEntityIds: readonly EntityId[];
}

/** Even-odd ray-cast point-in-polygon. */
function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Interior probe: vertex average (adequate for the convex-ish loops sketches produce). */
function probePoint(loop: TraversedLoop): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of loop.polygon) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(loop.polygon.length, 1);
  return { x: x / n, y: y / n };
}

/** Circles are closed loops by themselves (construction ones excluded). */
function circleLoops(sketch: Sketch): TraversedLoop[] {
  const points = pointMap(sketch);
  const out: TraversedLoop[] = [];
  for (const entity of sketch.entities) {
    if (entity.type !== 'circle' || entity.construction) continue;
    const curve = evaluateEntity(entity, points);
    if (curve?.kind !== 'circle') continue;
    out.push({
      entityIds: [entity.id],
      polygon: sampleCurve(curve, PROFILE_CHORD_TOL_MM),
      area: Math.PI * curve.r * curve.r,
    });
  }
  return out;
}

export function detectProfiles(sketch: Sketch): ProfileDetectionResult {
  const extraction = extractLoops(sketch);
  const loops: TraversedLoop[] = [...extraction.loops, ...circleLoops(sketch)];

  // Immediate parent = smallest-area loop strictly containing the probe point.
  const parents: (number | null)[] = loops.map((loop, i) => {
    const probe = probePoint(loop);
    let parent: number | null = null;
    for (let j = 0; j < loops.length; j += 1) {
      if (j === i) continue;
      const candidate = loops[j];
      if (!candidate || candidate.area <= loop.area) continue;
      if (!pointInPolygon(probe, candidate.polygon)) continue;
      const current = parent === null ? null : loops[parent];
      if (current === undefined) continue;
      if (current === null || candidate.area < current.area) parent = j;
    }
    return parent;
  });

  const profiles: SketchProfile[] = loops.map((loop, i) => {
    const inner = loops.filter((_, j) => parents[j] === i);
    const contributing = [...loop.entityIds, ...inner.flatMap((l) => l.entityIds)];
    return { id: profileIdFor(sketch.id, contributing), outer: loop, inner };
  });

  profiles.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { profiles, openEntityIds: extraction.openEntityIds };
}
