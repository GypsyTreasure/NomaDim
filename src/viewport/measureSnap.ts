import type { BodyEdges } from '../kernel';

/**
 * Measure snap candidates (MASTER_DOCUMENT F10): each body edge contributes
 * its endpoints and midpoint as snap points; a circular edge additionally
 * carries its radius so a single pick reports radius/diameter. Pure geometry
 * over the worker-emitted edge polylines — no Three.js, no camera.
 */

export interface MeasureCandidate {
  readonly world: readonly [number, number, number];
  /** Non-null when this candidate lies on a circular edge (F10 radius pick). */
  readonly circleRadius: number | null;
}

function pointAt(polyline: Float32Array, i: number): [number, number, number] {
  return [polyline[i * 3] ?? 0, polyline[i * 3 + 1] ?? 0, polyline[i * 3 + 2] ?? 0];
}

/** Radius of a closed, near-circular polyline, or null if it isn't one. */
export function detectCircleRadius(polyline: Float32Array): number | null {
  const n = Math.floor(polyline.length / 3);
  if (n < 8) return null;
  const first = pointAt(polyline, 0);
  const last = pointAt(polyline, n - 1);
  const span = Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]);

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i += 1) {
    const p = pointAt(polyline, i);
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= n;
  cy /= n;
  cz /= n;

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i += 1) {
    const p = pointAt(polyline, i);
    const r = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
    sum += r;
    sumSq += r * r;
  }
  const mean = sum / n;
  if (mean < 1e-6) return null;
  // Closed (endpoints coincide relative to size) and low radius variance.
  if (span > mean * 0.25) return null;
  const variance = sumSq / n - mean * mean;
  if (Math.sqrt(Math.max(variance, 0)) / mean > 0.02) return null;
  return mean;
}

export function buildMeasureCandidates(bodyEdges: readonly BodyEdges[]): MeasureCandidate[] {
  const out: MeasureCandidate[] = [];
  for (const body of bodyEdges) {
    for (const edge of body.edges) {
      const line = edge.polyline;
      const n = Math.floor(line.length / 3);
      if (n < 2) continue;
      const radius = detectCircleRadius(line);
      if (radius !== null) {
        // Circular edge: sample four points around it, each reporting radius.
        for (const frac of [0, 0.25, 0.5, 0.75]) {
          out.push({ world: pointAt(line, Math.floor(frac * (n - 1))), circleRadius: radius });
        }
        continue;
      }
      out.push({ world: pointAt(line, 0), circleRadius: null });
      out.push({ world: pointAt(line, n - 1), circleRadius: null });
      out.push({ world: pointAt(line, Math.floor((n - 1) / 2)), circleRadius: null });
    }
  }
  return out;
}
