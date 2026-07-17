import type { SketchId } from '../../../core';
import type { Sketch, SketchMeta } from '../../../document';
import { evaluateSketch, sampleCurve } from '../../../sketch';
import type { SketchPreview } from '../../../viewport';
import { sketchPlaneBasis } from './planeBasis';

/** Chord tolerance (mm) for tessellating sketch preview curves into 3D lines. */
export const SKETCH_PREVIEW_TOL_MM = 0.1;

/**
 * Committed-sketch previews (Fusion parity): every visible sketch NOT currently
 * being edited becomes 3D reference geometry, keyed by its plane basis so an
 * origin-plane sketch and a body-face sketch both show immediately — not only
 * once a feature consumes them (the face case was previously dropped). The
 * active sketch is excluded (the 2D overlay already draws it); an auto-hidden
 * sketch (consumed, or hidden from the tree) falls out.
 */
export function buildSketchPreviews(
  sketches: readonly Sketch[],
  sketchMeta: readonly SketchMeta[],
  activeSketchId: SketchId | null
): SketchPreview[] {
  const previews: SketchPreview[] = [];
  for (const sketch of sketches) {
    if (sketch.id === activeSketchId) continue;
    const meta = sketchMeta.find((m) => m.id === sketch.id);
    if (meta && !meta.visible) continue; // hidden; default (no entry) is visible
    const polylines = evaluateSketch(sketch).map((entity) => {
      const points = [...sampleCurve(entity.curve, SKETCH_PREVIEW_TOL_MM)];
      // Close full circles so the preview reads as a loop, not an arc.
      if (entity.curve.kind === 'circle' && points[0]) points.push(points[0]);
      return points;
    });
    previews.push({ sketchId: sketch.id, basis: sketchPlaneBasis(sketch), polylines });
  }
  return previews;
}
