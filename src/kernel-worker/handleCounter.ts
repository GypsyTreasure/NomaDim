/**
 * R8: the worker maintains a live-handle counter; `stats` exposes it, and
 * dev builds assert it returns to baseline after cache clear. Scoped to
 * retained `TopoDS_Shape` handles (the `BodyStateMap` entries from M3
 * onward) — ephemeral extraction-scoped temporaries (TopLoc_Location,
 * TopExp_Explorer, Handle_Poly_Triangulation) are created and `.delete()`'d
 * within a single synchronous pass and are not part of this count.
 */

let liveShapeCount = 0;

export function trackShapeAllocation(): void {
  liveShapeCount += 1;
}

export function trackShapeDisposal(): void {
  liveShapeCount -= 1;
}

export function getLiveShapeCount(): number {
  return liveShapeCount;
}
