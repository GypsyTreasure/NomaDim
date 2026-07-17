import { describe, expect, it } from 'vitest';
import type { EntityId, PointId, SketchId } from '../../src/core/ids';
import type { Sketch } from '../../src/document';
import { buildSketchPreviews } from '../../src/app/features/sketcher/sketchPreviews';

/**
 * Committed-sketch previews (bug #6): a body-face sketch must produce reference
 * geometry immediately, exactly like an origin-plane sketch — it used to be
 * dropped, so a face sketch was invisible until a feature consumed it.
 */

const sk = (id: string): SketchId => id as SketchId;
const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

const originSketch: Sketch = {
  id: sk('s1'),
  name: 'Sketch1',
  plane: { kind: 'origin', plane: 'XY' },
  points: [{ id: pid('c'), x: 0, y: 0 }],
  entities: [{ type: 'circle', id: eid('e0'), center: pid('c'), r: 5, construction: false }],
  constraints: [],
  dimensions: [],
};

const faceSketch: Sketch = {
  id: sk('s2'),
  name: 'Sketch2',
  plane: {
    kind: 'face',
    fingerprint: 'face:0,0,10:0,0,1:400',
    planeSnapshot: { origin: [0, 0, 10], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
  },
  points: [{ id: pid('q'), x: 0, y: 0 }],
  entities: [{ type: 'circle', id: eid('e1'), center: pid('q'), r: 5, construction: false }],
  constraints: [],
  dimensions: [],
};

describe('buildSketchPreviews', () => {
  it('includes a body-face sketch, mapped by its face basis', () => {
    const previews = buildSketchPreviews([faceSketch], [], null);
    expect(previews).toHaveLength(1);
    const preview = previews[0];
    expect(preview?.sketchId).toBe('s2');
    // Basis carries the face snapshot; its key marks it as a face plane.
    expect(preview?.basis.key).toContain('face:');
    expect(preview?.basis.origin).toEqual([0, 0, 10]);
    // The circle produced a closed polyline (>= a couple of points, looped).
    expect(preview?.polylines[0]?.length ?? 0).toBeGreaterThan(2);
  });

  it('includes both origin and face sketches', () => {
    const previews = buildSketchPreviews([originSketch, faceSketch], [], null);
    expect(previews.map((p) => p.sketchId).sort()).toEqual(['s1', 's2']);
  });

  it('excludes the active sketch and hidden sketches', () => {
    expect(buildSketchPreviews([faceSketch], [], sk('s2'))).toHaveLength(0);
    expect(
      buildSketchPreviews([faceSketch], [{ id: sk('s2'), visible: false }], null)
    ).toHaveLength(0);
  });
});
