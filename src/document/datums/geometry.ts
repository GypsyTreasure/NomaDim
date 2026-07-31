import { DEG_TO_RAD, type DatumId } from '../../core';
import type { Datum, DatumAxis, DatumBaseAxis, DatumBasePlane, DatumPlane } from './types';

/**
 * Pure world-placement math for construction geometry — no THREE (document
 * layer purity, ARCHITECTURE §3), so both `services` (Mirror across a datum
 * plane) and `app`/`viewport` (rendering, sketch-on-plane) share one source of
 * truth. World is Z-up (Fusion convention).
 *
 * A datum may be built on the origin (base 'XY'/'X'/…) OR on another
 * user-created datum (`baseDatumId`), and rotated about an origin axis OR a
 * user-created axis (`tiltAxisDatumId`/`angleAxisDatumId`) — ADR-0089. Those
 * references are resolved against the document's `datums` list, passed in by
 * the caller; a missing or cyclic reference safely degrades to the origin base.
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

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len < 1e-9 ? [0, 0, 1] : [v[0] / len, v[1] / len, v[2] / len];
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

function findDatum(datums: readonly Datum[], id: DatumId): Datum | undefined {
  return datums.find((d) => d.id === id);
}

/** The un-rotated frame of a plane's base — either an origin plane or a parent datum plane. */
function baseFrame(
  datum: DatumPlane,
  datums: readonly Datum[],
  visited: ReadonlySet<DatumId>
): { origin: Vec3; u: Vec3; v: Vec3; n: Vec3 } {
  if (datum.baseDatumId && !visited.has(datum.baseDatumId)) {
    const parent = findDatum(datums, datum.baseDatumId);
    if (parent?.kind === 'plane') {
      const w = planeWorld(parent, datums, new Set([...visited, datum.id]));
      return { origin: w.origin, u: w.xAxis, v: w.yAxis, n: w.normal };
    }
  }
  const f = PLANE_FRAME[datum.base];
  return { origin: [0, 0, 0], u: f.u, v: f.v, n: f.n };
}

/** The rotation axis for a datum: an origin axis, or a user-created axis by id. */
function rotationAxis(
  base: DatumBaseAxis,
  refId: DatumId | undefined,
  datums: readonly Datum[]
): Vec3 {
  if (refId) {
    const ref = findDatum(datums, refId);
    if (ref?.kind === 'axis') return normalize(axisWorld(ref, datums, new Set([refId])).direction);
  }
  return AXIS_VEC[base];
}

function planeWorld(
  datum: DatumPlane,
  datums: readonly Datum[],
  visited: ReadonlySet<DatumId>
): DatumPlaneWorld {
  const f = baseFrame(datum, datums, visited);
  const k = rotationAxis(datum.tiltAxis, datum.tiltAxisDatumId, datums);
  const angle = datum.tiltDeg * DEG_TO_RAD;
  return {
    origin: [
      f.origin[0] + f.n[0] * datum.offsetMm,
      f.origin[1] + f.n[1] * datum.offsetMm,
      f.origin[2] + f.n[2] * datum.offsetMm,
    ],
    xAxis: rotate(f.u, k, angle),
    yAxis: rotate(f.v, k, angle),
    normal: rotate(f.n, k, angle),
  };
}

function axisWorld(
  datum: DatumAxis,
  datums: readonly Datum[],
  visited: ReadonlySet<DatumId>
): DatumAxisWorld {
  let baseOrigin: Vec3 = [0, 0, 0];
  let baseDir: Vec3 = AXIS_VEC[datum.base];
  if (datum.baseDatumId && !visited.has(datum.baseDatumId)) {
    const parent = findDatum(datums, datum.baseDatumId);
    if (parent?.kind === 'axis') {
      const w = axisWorld(parent, datums, new Set([...visited, datum.id]));
      baseOrigin = w.origin;
      baseDir = w.direction;
    }
  }
  const k = rotationAxis(datum.angleAxis, datum.angleAxisDatumId, datums);
  return {
    origin: [
      baseOrigin[0] + datum.offset[0],
      baseOrigin[1] + datum.offset[1],
      baseOrigin[2] + datum.offset[2],
    ],
    direction: rotate(baseDir, k, datum.angleDeg * DEG_TO_RAD),
  };
}

/**
 * World placement of a construction plane. Base origin (or parent-datum) plane
 * offset along its normal by `offsetMm`, with the frame tilted `tiltDeg` about
 * `tiltAxis` (an origin axis, or a user axis via `tiltAxisDatumId`). `datums`
 * is the document's datum list, used to resolve those references.
 */
export function datumPlaneWorld(datum: DatumPlane, datums: readonly Datum[] = []): DatumPlaneWorld {
  return planeWorld(datum, datums, new Set());
}

/**
 * World placement of a construction axis: the base direction (origin axis or a
 * parent datum axis) rotated `angleDeg` about `angleAxis`, through the point
 * `offset` (mm, relative to the base's origin).
 */
export function datumAxisWorld(datum: DatumAxis, datums: readonly Datum[] = []): DatumAxisWorld {
  return axisWorld(datum, datums, new Set());
}
