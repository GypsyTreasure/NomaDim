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

/** Mean distance of the first `count` points to their centroid + its variance. */
function radiusStats(polyline: Float32Array, count: number): { mean: number; stddev: number } {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i += 1) {
    const p = pointAt(polyline, i);
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= count;
  cy /= count;
  cz /= count;

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < count; i += 1) {
    const p = pointAt(polyline, i);
    const r = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
    sum += r;
    sumSq += r * r;
  }
  const mean = sum / count;
  return { mean, stddev: Math.sqrt(Math.max(sumSq / count - mean * mean, 0)) };
}

/** Radius of a closed, near-circular polyline, or null if it isn't one. */
export function detectCircleRadius(polyline: Float32Array): number | null {
  const n = Math.floor(polyline.length / 3);
  if (n < 8) return null;
  const first = pointAt(polyline, 0);
  const last = pointAt(polyline, n - 1);
  const span = Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]);

  // A rough scale to judge closure, then drop the duplicated closing point so
  // it doesn't skew the centroid (which would inflate the radius variance).
  const scale = radiusStats(polyline, n).mean;
  if (scale < 1e-6) return null;
  const closed = span < scale * 0.05;
  const { mean, stddev } = radiusStats(polyline, closed ? n - 1 : n);
  if (!closed || mean < 1e-6) return null;
  if (stddev / mean > 0.02) return null;
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
