import type { Sketch } from '../../../document';
import { originPlaneBasis, type SketchPlaneBasis } from '../../../viewport';

/**
 * World-space basis of a sketch's plane — an origin plane or a body face.
 * Shared by the active-sketch camera/overlay (useSketcher) and the committed
 * preview geometry (App), so a face-plane sketch shows as 3D reference lines
 * exactly like an origin-plane one, before any feature consumes it.
 */
export function sketchPlaneBasis(sketch: Sketch): SketchPlaneBasis {
  if (sketch.plane.kind === 'origin') return originPlaneBasis(sketch.plane.plane);
  const s = sketch.plane.planeSnapshot;
  const [ax, ay, az] = s.xAxis;
  const [bx, by, bz] = s.yAxis;
  const normal: readonly [number, number, number] = [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
  return {
    key: `face:${sketch.plane.fingerprint}`,
    origin: s.origin,
    uAxis: s.xAxis,
    vAxis: s.yAxis,
    normal,
  };
}
