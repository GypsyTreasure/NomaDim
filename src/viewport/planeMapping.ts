import * as THREE from 'three';
import type { Vec2 } from '../core';

/**
 * Sketch-plane ↔ world mapping. World is Z-up (CAD convention, matching
 * Fusion): the model XY plane is the horizontal ground. A plane has a world
 * `origin` and orthonormal sketch axes (u,v); origin planes sit at the world
 * origin, a body-face plane sits on the face. Sketch-local (u,v) map through
 * `origin + u·x + v·y`, so the same math serves both.
 */

export type OriginPlaneId = 'XY' | 'XZ' | 'YZ';

export interface PlaneMapping {
  /** Stable identity for change detection (origin-plane id or 'face:<fingerprint>'). */
  readonly key: string;
  readonly origin: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly uAxis: THREE.Vector3;
  readonly vAxis: THREE.Vector3;
}

/** Plain, serializable plane basis passed between app and viewport (no THREE types). */
export interface SketchPlaneBasis {
  readonly key: string;
  readonly origin: readonly [number, number, number];
  readonly uAxis: readonly [number, number, number];
  readonly vAxis: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
}

type Triple = readonly [number, number, number];

const ORIGIN_AXES: Record<OriginPlaneId, { u: Triple; v: Triple; n: Triple }> = {
  XY: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  XZ: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  YZ: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};

/** Basis for an origin plane (at the world origin). */
export function originPlaneBasis(plane: OriginPlaneId): SketchPlaneBasis {
  const a = ORIGIN_AXES[plane];
  return { key: plane, origin: [0, 0, 0], uAxis: a.u, vAxis: a.v, normal: a.n };
}

const AXIS_VEC: Record<'X' | 'Y' | 'Z', Triple> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
};

/**
 * Snapshot (origin + in-plane axes) for a datum plane (#5): a base origin
 * plane offset along its normal by `offsetMm`, with its in-plane frame tilted
 * `tiltDeg` about the world `tiltAxis`. Pure THREE vector math; the result is
 * stored on the DatumPlaneRef so it reuses the face-plane world-placement path.
 */
export function datumPlaneSnapshot(
  base: OriginPlaneId,
  offsetMm: number,
  tiltDeg: number,
  tiltAxis: 'X' | 'Y' | 'Z'
): { origin: Triple; xAxis: Triple; yAxis: Triple } {
  const a = ORIGIN_AXES[base];
  const origin = v3(a.n).multiplyScalar(offsetMm);
  const axis = v3(AXIS_VEC[tiltAxis]);
  const angle = (tiltDeg * Math.PI) / 180;
  const u = v3(a.u).applyAxisAngle(axis, angle);
  const w = v3(a.v).applyAxisAngle(axis, angle);
  return {
    origin: [origin.x, origin.y, origin.z],
    xAxis: [u.x, u.y, u.z],
    yAxis: [w.x, w.y, w.z],
  };
}

const v3 = (t: Triple): THREE.Vector3 => new THREE.Vector3(t[0], t[1], t[2]);

/** Builds the THREE-typed mapping used for projection/picking from a plain basis. */
export function mappingFromBasis(basis: SketchPlaneBasis): PlaneMapping {
  return {
    key: basis.key,
    origin: v3(basis.origin),
    normal: v3(basis.normal),
    uAxis: v3(basis.uAxis),
    vAxis: v3(basis.vAxis),
  };
}

/** Convenience: the THREE-typed mapping for an origin plane. */
export function planeMapping(plane: OriginPlaneId): PlaneMapping {
  return mappingFromBasis(originPlaneBasis(plane));
}

export function planeToWorld(mapping: PlaneMapping, p: Vec2): THREE.Vector3 {
  return mapping.origin
    .clone()
    .addScaledVector(mapping.uAxis, p.x)
    .addScaledVector(mapping.vAxis, p.y);
}

export function worldToPlane(mapping: PlaneMapping, world: THREE.Vector3): Vec2 {
  const d = world.clone().sub(mapping.origin);
  return { x: d.dot(mapping.uAxis), y: d.dot(mapping.vAxis) };
}

/** Projects a sketch-plane point to CSS pixels for the given camera/viewport. */
export function planeToScreen(
  mapping: PlaneMapping,
  p: Vec2,
  camera: THREE.Camera,
  width: number,
  height: number
): Vec2 {
  const ndc = planeToWorld(mapping, p).project(camera);
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
}

/** Screen pixels per sketch millimetre at the plane origin (R11 tolerance conversion). */
export function pixelsPerMm(
  mapping: PlaneMapping,
  camera: THREE.Camera,
  width: number,
  height: number
): number {
  const a = planeToScreen(mapping, { x: 0, y: 0 }, camera, width, height);
  const b = planeToScreen(mapping, { x: 1, y: 0 }, camera, width, height);
  return Math.hypot(b.x - a.x, b.y - a.y);
}
