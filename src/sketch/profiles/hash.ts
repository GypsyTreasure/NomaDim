import type { EntityId, ProfileId, SketchId } from '../../core';

/**
 * Profile identity (ARCHITECTURE R7a): a ProfileId is a stable hash of the
 * SORTED set of contributing entity ids (outer + inner) — never a
 * detection-order index. Geometric edits keep the id; adding/removing a
 * boundary entity changes it, so dependent ops error explicitly instead of
 * silently extruding a different region.
 */

/** FNV-1a 32-bit over a string, hex-encoded (stable across sessions/platforms). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function profileIdFor(sketchId: SketchId, entityIds: readonly EntityId[]): ProfileId {
  const canonical = [...entityIds].sort().join(',');
  return `${sketchId}:p-${fnv1a(canonical)}` as ProfileId;
}
