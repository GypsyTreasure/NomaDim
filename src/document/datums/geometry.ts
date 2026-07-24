import { DEG_TO_RAD } from '../../core';
import type { DatumAxis, DatumBaseAxis, DatumBasePlane, DatumPlane } from './types';

/**
 * Pure world-placement math for construction geometry — no THREE (document
 * layer purity, ARCHITECTURE §3), so both `services` (Mirror across a datum
 * plane) and `app`/`viewport` (rendering, sketch-on-plane) share one source of
 * truth. World is Z-up (Fusion convention).
 */

type Vec3 = readonly [number, number, number];

const PLANE_FRAME: Record<DatumBasePlane, { u: Vec3; v: Vec3; n: Vec3 }> = {
  XY: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  XZ: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  YZ: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};

const AXIS_VEC: Record<DatumBaseAxis, Vec3> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
};

/** Rodrigues rotation of `v` about the UNIT axis `k` by `angle` radians. */
function rotate(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
  const cross: Vec3 = [
    k[1] * v[2] - k[2] * v[1],
    k[2] * v[0] - k[0] * v[2],
    k[0] * v[1] - k[1] * v[0],
  ];
  return [
    v[0] * c + cross[0] * s + k[0] * dot * (1 - c),
    v[1] * c + cross[1] * s + k[1] * dot * (1 - c),
    v[2] * c + cross[2] * s + k[2] * dot * (1 - c),
  ];
}

export interface DatumPlaneWorld {
  readonly origin: Vec3;
  readonly xAxis: Vec3;
  readonly yAxis: Vec3;
  readonly normal: Vec3;
}

export interface DatumAxisWorld {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/**
 * World placement of a construction plane: base origin plane offset along its
 * (un-tilted) normal by `offsetMm`, with the in-plane frame tilted `tiltDeg`
 * about the world `tiltAxis`. `normal` = u × v (rotated with the frame).
 */
export function datumPlaneWorld(datum: DatumPlane): DatumPlaneWorld {
  const f = PLANE_FRAME[datum.base];
  const k = AXIS_VEC[datum.tiltAxis];
  const angle = datum.tiltDeg * DEG_TO_RAD;
  return {
    origin: [f.n[0] * datum.offsetMm, f.n[1] * datum.offsetMm, f.n[2] * datum.offsetMm],
    xAxis: rotate(f.u, k, angle),
    yAxis: rotate(f.v, k, angle),
    normal: rotate(f.n, k, angle),
  };
}

/**
 * World placement of a construction axis: the base origin direction rotated
 * `angleDeg` about `angleAxis`, passing through the point `offset` (mm).
 */
export function datumAxisWorld(datum: DatumAxis): DatumAxisWorld {
  return {
    origin: datum.offset,
    direction: rotate(AXIS_VEC[datum.base], AXIS_VEC[datum.angleAxis], datum.angleDeg * DEG_TO_RAD),
  };
}
