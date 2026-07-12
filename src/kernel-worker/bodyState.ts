import type { TopoDS_Shape } from 'opencascade.js';
import type { BodyId } from '../core';
import type { OpStatusReport } from '../kernel/protocol';
import { trackShapeDisposal } from './handleCounter';
import type { BodyStateMap } from './executors/types';

/**
 * Per-op delta cache (ARCHITECTURE §9): `deltas[i]` holds the map changes an
 * op made — bodies it CHANGED (their post-op shape) and bodies it REMOVED
 * (e.g. Combine consuming a tool). Replay-from-k folds deltas 0..k-1 (set the
 * changed, drop the removed) to restore the BodyStateMap cheaply. Every shape
 * in a `changed` map is owned by this cache: freeing deltas ≥ k `.delete()`s
 * those shapes and decrements the live-handle counter (R8). A `removed` id
 * carries no owned shape — that shape belongs to the delta that produced it.
 *
 * Op statuses are cached alongside deltas: an aborted regen (R6) leaves a
 * shorter valid prefix than the next request's fromIndex may assume — the
 * regen loop clamps to `length` and re-reports cached statuses for the
 * prefix, so no status is ever lost to a superseded generation.
 */

export interface OpDelta {
  readonly changed: ReadonlyMap<BodyId, TopoDS_Shape>;
  readonly removed: ReadonlySet<BodyId>;
}

export function emptyDelta(): OpDelta {
  return { changed: new Map(), removed: new Set() };
}

interface CacheEntry {
  readonly delta: OpDelta;
  readonly status: OpStatusReport;
}

export class ShapeCache {
  private entries: CacheEntry[] = [];

  /** Rebuilds the map state after ops 0..k-1 (last writer per body wins). */
  restoreTo(k: number): BodyStateMap {
    const bodies: BodyStateMap = new Map();
    for (let i = 0; i < Math.min(k, this.entries.length); i += 1) {
      const entry = this.entries[i];
      if (!entry) continue;
      for (const [bodyId, shape] of entry.delta.changed) bodies.set(bodyId, shape);
      for (const bodyId of entry.delta.removed) bodies.delete(bodyId);
    }
    return bodies;
  }

  /** Frees every cached shape from op k onward (stale after a dirty edit). */
  freeFrom(k: number): void {
    for (let i = k; i < this.entries.length; i += 1) {
      const entry = this.entries[i];
      if (!entry) continue;
      for (const shape of entry.delta.changed.values()) {
        shape.delete();
        trackShapeDisposal();
      }
    }
    this.entries = this.entries.slice(0, k);
  }

  /** Records op i's delta + status (every processed index records, contiguously). */
  record(i: number, delta: OpDelta, status: OpStatusReport): void {
    this.entries[i] = { delta, status };
  }

  statusAt(i: number): OpStatusReport | null {
    return this.entries[i]?.status ?? null;
  }

  /** Contiguous valid prefix — the highest index restore/replay may trust. */
  get length(): number {
    return this.entries.length;
  }
}

/** Snapshot map references so the regen loop can diff after an op runs. */
export function snapshotRefs(bodies: BodyStateMap): ReadonlyMap<BodyId, TopoDS_Shape> {
  return new Map(bodies);
}

/** Bodies whose shape reference changed (new/replaced) or were removed by the op. */
export function diffDelta(
  before: ReadonlyMap<BodyId, TopoDS_Shape>,
  after: BodyStateMap
): OpDelta {
  const changed = new Map<BodyId, TopoDS_Shape>();
  for (const [bodyId, shape] of after) {
    if (before.get(bodyId) !== shape) changed.set(bodyId, shape);
  }
  const removed = new Set<BodyId>();
  for (const bodyId of before.keys()) {
    if (!after.has(bodyId)) removed.add(bodyId);
  }
  return { changed, removed };
}
