import { describe, expect, it } from 'vitest';
import {
  sliceMesh,
  sectionPlanePoints,
  sectionPlaneSegments,
  assembleSectionLoops,
  pointInArea,
  MAX_SECTION_SEGMENTS,
  type PlaneBasisLite,
  type SectionPt,
  type Triple,
} from '../../src/viewport/section';

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

  it('outlines a coplanar face — its boundary, not a filled band (#1)', () => {
    // A unit square on z=0 as two triangles sharing the diagonal (0,0)-(1,1).
    // The diagonal is interior (used twice) → dropped; the 4 outer edges remain.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const seg = sliceMesh(positions, indices, XY_ORIGIN, Z_NORMAL);
    expect(seg).toHaveLength(24); // 4 boundary edges × 2 points × 3 coords
    // Every emitted point lies on z = 0.
    for (let i = 2; i < seg.length; i += 3) expect(seg[i]).toBeCloseTo(0);
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

describe('sectionPlanePoints (snap targets, #5)', () => {
  it('projects the section vertices into plane (u, v) coordinates', () => {
    // Triangle straddling z=0 → one segment at x=±0.5, z=0. On the XY plane
    // (u=X, v=Y) that maps to (±0.5, 0).
    const positions = new Float32Array([-1, 0, -1, 1, 0, -1, 0, 0, 1]);
    const indices = new Uint32Array([0, 1, 2]);
    const basis: PlaneBasisLite = {
      origin: [0, 0, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 1, 0],
      normal: [0, 0, 1],
    };
    const pts = sectionPlanePoints(positions, indices, basis);
    expect(pts).toHaveLength(2);
    for (const p of pts) expect(p.y).toBeCloseTo(0);
    const xs = pts.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-0.5);
    expect(xs[1]).toBeCloseTo(0.5);
  });
});

describe('coplanarFaceOutline (#10 face-pick preview)', () => {
  // A unit square on the plane z=0, two triangles sharing the diagonal.
  const positions = new Float32Array([
    0,
    0,
    0, // 0
    2,
    0,
    0, // 1
    2,
    2,
    0, // 2
    0,
    2,
    0, // 3
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

  it('outlines the square perimeter (shared diagonal dropped)', async () => {
    const { coplanarFaceOutline } = await import('../../src/viewport/section');
    const segs = coplanarFaceOutline(positions, indices, [0, 0, 0], [0, 0, 1]);
    // 4 perimeter edges × 2 points × 3 coords = 24; the interior diagonal
    // (used by both triangles) is excluded.
    expect(segs).toHaveLength(24);
  });

  it('returns nothing when the plane misses the face', async () => {
    const { coplanarFaceOutline } = await import('../../src/viewport/section');
    expect(coplanarFaceOutline(positions, indices, [0, 0, 5], [0, 0, 1])).toHaveLength(0);
  });

  it('outlines only the picked face, not a disconnected coplanar region', async () => {
    const { coplanarFaceOutline } = await import('../../src/viewport/section');
    // Two separate unit squares on z=0: A near the origin, B far away (a step or
    // the original surface). Same infinite plane, but not connected.
    const twoSquares = new Float32Array([
      // Square A: (0,0)–(2,2)
      0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0,
      // Square B: (10,10)–(12,12)
      10, 10, 0, 12, 10, 0, 12, 12, 0, 10, 12, 0,
    ]);
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    // Pick inside square A only.
    const segs = coplanarFaceOutline(twoSquares, idx, [1, 1, 0], [0, 0, 1]);
    // Only A's 4 perimeter edges (24 coords); B is excluded even though coplanar.
    expect(segs).toHaveLength(24);
    // Every emitted coordinate must belong to square A (x,y ≤ 2), never B.
    for (let i = 0; i < segs.length; i += 3) {
      expect(segs[i]).toBeLessThanOrEqual(2 + 1e-6);
      expect(segs[i + 1]).toBeLessThanOrEqual(2 + 1e-6);
    }
  });
});

describe('pointInArea (#11 click-to-pick)', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const hole = [
    { x: 4, y: 4 },
    { x: 6, y: 4 },
    { x: 6, y: 6 },
    { x: 4, y: 6 },
  ];

  it('is inside the outer loop', () => {
    expect(pointInArea(5, 2, square, [])).toBe(true);
  });

  it('is outside the outer loop', () => {
    expect(pointInArea(-1, 5, square, [])).toBe(false);
    expect(pointInArea(11, 5, square, [])).toBe(false);
  });

  it('excludes points inside a hole', () => {
    expect(pointInArea(5, 5, square, [hole])).toBe(false);
  });

  it('includes points between the hole and the outer boundary', () => {
    expect(pointInArea(1, 1, square, [hole])).toBe(true);
  });
});

describe('assembleSectionLoops (#3 solid cap / #2 project)', () => {
  const p = (x: number, y: number): SectionPt => ({ x, y });

  it('welds four shared-endpoint segments into one closed loop', () => {
    // A unit square given as 4 segments sharing corners (order shuffled).
    const segs: (readonly [SectionPt, SectionPt])[] = [
      [p(0, 0), p(10, 0)],
      [p(10, 10), p(0, 10)],
      [p(10, 0), p(10, 10)],
      [p(0, 10), p(0, 0)],
    ];
    const loops = assembleSectionLoops(segs);
    expect(loops).toHaveLength(1);
    expect(loops[0]?.length).toBeGreaterThanOrEqual(4);
  });

  it('returns two loops for two disjoint squares (e.g. an outer + a hole ring)', () => {
    const ring = (o: number): (readonly [SectionPt, SectionPt])[] => [
      [p(o, o), p(o + 4, o)],
      [p(o + 4, o), p(o + 4, o + 4)],
      [p(o + 4, o + 4), p(o, o + 4)],
      [p(o, o + 4), p(o, o)],
    ];
    const loops = assembleSectionLoops([...ring(0), ...ring(20)]);
    expect(loops).toHaveLength(2);
  });

  it('ignores a lone open segment (no loop of ≥3 points)', () => {
    expect(assembleSectionLoops([[p(0, 0), p(5, 0)]])).toEqual([]);
  });
});

describe('sectionPlaneSegments', () => {
  it('projects each world segment to a plane-space endpoint pair', () => {
    // Two triangles straddling z=0 → two section segments.
    const positions = new Float32Array([
      -1,
      0,
      -1,
      1,
      0,
      -1,
      0,
      0,
      1, // tri 1
      2,
      0,
      -1,
      4,
      0,
      -1,
      3,
      0,
      1, // tri 2
    ]);
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
    const basis: PlaneBasisLite = {
      origin: [0, 0, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 1, 0],
      normal: [0, 0, 1],
    };
    const segs = sectionPlaneSegments(positions, indices, basis);
    expect(segs).toHaveLength(2);
    for (const [a, b] of segs) {
      expect(typeof a.x).toBe('number');
      expect(typeof b.y).toBe('number');
    }
  });
});
