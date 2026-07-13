import { describe, expect, it } from 'vitest';
import type { BodyEdges } from '../../src/kernel';
import { buildMeasureCandidates, detectCircleRadius } from '../../src/viewport/measureSnap';

/**
 * Measure snap geometry (F10): circular-edge detection reports the radius so a
 * single pick shows radius/diameter, and each edge yields snap candidates
 * (endpoints/midpoint, or samples around a circle). Pure math over the
 * worker-emitted polylines — no Three.js.
 */

function circlePolyline(cx: number, cy: number, r: number, n = 32): Float32Array {
  const out = new Float32Array((n + 1) * 3);
  for (let i = 0; i <= n; i += 1) {
    const a = (2 * Math.PI * i) / n;
    out[i * 3] = cx + r * Math.cos(a);
    out[i * 3 + 1] = cy + r * Math.sin(a);
    out[i * 3 + 2] = 0;
  }
  return out;
}

function segmentPolyline(): Float32Array {
  // As the worker emits it — several samples along the edge (endpoints + mid).
  return new Float32Array([0, 0, 0, 2.5, 0, 0, 5, 0, 0, 7.5, 0, 0, 10, 0, 0]);
}

describe('detectCircleRadius', () => {
  it('recovers the radius of a closed circular polyline', () => {
    const r = detectCircleRadius(circlePolyline(3, 4, 7.5));
    expect(r).not.toBeNull();
    if (r !== null) expect(r).toBeCloseTo(7.5, 3);
  });

  it('rejects a straight segment', () => {
    expect(detectCircleRadius(segmentPolyline())).toBeNull();
  });
});

describe('buildMeasureCandidates', () => {
  it('emits endpoint + midpoint candidates for a straight edge', () => {
    const bodyEdges: BodyEdges[] = [
      {
        bodyId: 'b1' as never,
        edges: [
          {
            fingerprint: { midpoint: [5, 0, 0], direction: [1, 0, 0], adjFaceKinds: [], tolMm: 5 },
            polyline: segmentPolyline(),
          },
        ],
      },
    ];
    const candidates = buildMeasureCandidates(bodyEdges);
    expect(candidates.length).toBe(3);
    expect(candidates.every((c) => c.circleRadius === null)).toBe(true);
    // Endpoints are (0,0,0) and (10,0,0).
    expect(candidates.map((c) => c.world[0]).sort((a, b) => a - b)).toEqual([0, 5, 10]);
  });

  it('emits radius-carrying candidates for a circular edge', () => {
    const bodyEdges: BodyEdges[] = [
      {
        bodyId: 'b1' as never,
        edges: [
          {
            fingerprint: {
              midpoint: [0, 0, 0],
              direction: [1, 0, 0],
              adjFaceKinds: ['cylinder', 'plane'],
              tolMm: 5,
            },
            polyline: circlePolyline(0, 0, 6),
          },
        ],
      },
    ];
    const candidates = buildMeasureCandidates(bodyEdges);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.circleRadius !== null)).toBe(true);
    if (candidates[0]?.circleRadius != null) expect(candidates[0].circleRadius).toBeCloseTo(6, 3);
  });
});
