import type { BodyId } from '../../core';

/**
 * Persisted per-body metadata (MASTER_DOCUMENT F7/F8): name, colour, and
 * visibility. Keyed by the stable `BodyId` an op mints at creation, so it
 * survives regeneration. Bodies without an explicit entry fall back to
 * `defaultBodyMeta` — metadata is lazily materialized only when the user
 * renames/recolours/hides a body (keeps the document minimal).
 */
export interface BodyMeta {
  readonly id: BodyId;
  readonly name: string;
  /** Hex colour string (serialized in XML per F7). */
  readonly color: string;
  readonly visible: boolean;
}

/** MASTER_DOCUMENT §12 brand teal — the default body colour. */
export const DEFAULT_BODY_COLOR = '#1A6B5A';

export function defaultBodyMeta(id: BodyId): BodyMeta {
  return { id, name: id, color: DEFAULT_BODY_COLOR, visible: true };
}
