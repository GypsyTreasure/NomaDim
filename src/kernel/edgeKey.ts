import type { EdgeFingerprint } from '../document';

/**
 * Stable string key for an edge fingerprint within a single regen's body
 * edges — used by the viewport + dialogs to track which edges are picked.
 * Not a persisted reference (that is the fingerprint itself, resolved at
 * regen); just a UI identity for the current tessellation.
 */
export function edgeFingerprintKey(fp: EdgeFingerprint): string {
  const r = (n: number): string => n.toFixed(3);
  return `${fp.midpoint.map(r).join(',')}|${fp.direction.map(r).join(',')}|${fp.adjFaceKinds.join('+')}`;
}
