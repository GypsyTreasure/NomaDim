import { describe, expect, it } from 'vitest';
import { sliceMesh, MAX_SECTION_SEGMENTS, type Triple } from '../../src/viewport/section';

const XY_ORIGIN: Triple = [0, 0, 0];
const Z_NORMAL: Triple = [0, 0, 1];

describe('sliceMesh', () => {
  it('cuts a straddling triangle into one segment on the plane', () => {
    // Triangle with two vertices below z=0 and one above → a single crossing.
    const positions = new Float32Array([
      -1,
      0,
      -1, // a (below)
      1,
      0,
      -1, // b (below)
      0,
      0,
      1, // c (above)
    ]);
    const indices = new Uint32Array([0, 1, 2]);
    const seg = sliceMesh(positions, indices, XY_ORIGIN, Z_NORMAL);
    expect(seg).toHaveLength(6); // exactly one segment (2 points × 3 coords)
    // Both endpoints lie on the plane z = 0.
    expect(seg[2]).toBeCloseTo(0);
    expect(seg[5]).toBeCloseTo(0);
    // The crossings are the midpoints of edges a→c and b→c (at z=0, x=±0.5).
    const xs = [seg[0], seg[3]].sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(xs[0]).toBeCloseTo(-0.5);
    expect(xs[1]).toBeCloseTo(0.5);
  });

  it('emits nothing for a triangle entirely on one side', () => {
    const positions = new Float32Array([0, 0, 1, 1, 0, 2, 0, 1, 1.5]);
    const indices = new Uint32Array([0, 1, 2]);
    expect(sliceMesh(positions, indices, XY_ORIGIN, Z_NORMAL)).toHaveLength(0);
  });

  it('skips a triangle lying in the plane (no filled band)', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    expect(sliceMesh(positions, indices, XY_ORIGIN, Z_NORMAL)).toHaveLength(0);
  });

  it('sections a two-triangle quad spanning the plane into two segments', () => {
    // A unit square in the XZ plane (y=0), z from -1..1, sliced by z=0.
    const positions = new Float32Array([
      -1,
      0,
      -1, // 0
      1,
      0,
      -1, // 1
      1,
      0,
      1, // 2
      -1,
      0,
      1, // 3
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const seg = sliceMesh(positions, indices, XY_ORIGIN, Z_NORMAL);
    expect(seg).toHaveLength(12); // two triangles each contribute one segment
    // Every endpoint sits on z = 0.
    for (let i = 2; i < seg.length; i += 3) expect(seg[i]).toBeCloseTo(0);
  });

  it('respects the segment cap on a pathological mesh', () => {
    // Many straddling triangles; ensure the output never exceeds the bound.
    const n = MAX_SECTION_SEGMENTS + 500;
    const positions = new Float32Array(n * 9);
    const indices = new Uint32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      positions[i * 9 + 0] = -1;
      positions[i * 9 + 2] = -1;
      positions[i * 9 + 3] = 1;
      positions[i * 9 + 5] = -1;
      positions[i * 9 + 6] = 0;
      positions[i * 9 + 8] = 1;
      indices[i * 3] = i * 3;
      indices[i * 3 + 1] = i * 3 + 1;
      indices[i * 3 + 2] = i * 3 + 2;
    }
    const seg = sliceMesh(positions, indices, XY_ORIGIN, Z_NORMAL);
    expect(seg.length).toBeLessThanOrEqual(MAX_SECTION_SEGMENTS * 6);
  });
});
