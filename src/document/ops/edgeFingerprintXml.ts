import type { XmlElement } from '../xml/xmlWriter';
import { numAttr, strAttr, type Raw } from '../xml/xmlRaw';
import type { EdgeFingerprint } from './types';

/**
 * `<edge>` element codec for EdgeFingerprint (shared by Fillet + Chamfer).
 * Adjacent face kinds serialize as a comma-joined string; the empty list is
 * an empty attribute. Kept private to the op codecs (ARCHITECTURE §11).
 */

export function edgeFingerprintToXml(fp: EdgeFingerprint): XmlElement {
  return {
    tag: 'edge',
    attrs: {
      mx: fp.midpoint[0],
      my: fp.midpoint[1],
      mz: fp.midpoint[2],
      dx: fp.direction[0],
      dy: fp.direction[1],
      dz: fp.direction[2],
      kinds: fp.adjFaceKinds.join(','),
      tol: fp.tolMm,
    },
  };
}

export function edgeFingerprintFromRaw(raw: Raw): EdgeFingerprint | null {
  const nums = ['mx', 'my', 'mz', 'dx', 'dy', 'dz', 'tol'].map((n) => numAttr(raw, n));
  if (nums.some((n) => n === null)) return null;
  const [mx, my, mz, dx, dy, dz, tol] = nums as number[];
  const kindsText = strAttr(raw, 'kinds');
  if (kindsText === null) return null;
  const adjFaceKinds = kindsText === '' ? [] : kindsText.split(',');
  return {
    midpoint: [mx ?? 0, my ?? 0, mz ?? 0],
    direction: [dx ?? 0, dy ?? 0, dz ?? 0],
    adjFaceKinds,
    tolMm: tol ?? 0,
  };
}
