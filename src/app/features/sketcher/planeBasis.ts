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
  // Face and datum planes both carry an explicit placement snapshot (#5).
  const plane = sketch.plane;
  const s = plane.planeSnapshot;
  const [ax, ay, az] = s.xAxis;
  const [bx, by, bz] = s.yAxis;
  const normal: readonly [number, number, number] = [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
  const key =
    plane.kind === 'face'
      ? `face:${plane.fingerprint}`
      : `datum:${plane.base}:${String(plane.offsetMm)}:${String(plane.tiltDeg)}:${plane.tiltAxis}`;
  return { key, origin: s.origin, uAxis: s.xAxis, vAxis: s.yAxis, normal };
}
