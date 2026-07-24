import type { DatumId } from '../../core';

/**
 * Construction geometry (datum planes & axes) — reusable, named reference
 * geometry created from the base origin, independent of any body or sketch
 * (Fusion "Construct"). Purely origin-parametric: it never touches the OCCT
 * kernel, so it lives in a plain document collection (like body/sketch
 * metadata) rather than the timeline. The world placement is DERIVED from
 * these params on demand (viewport `datumPlaneSnapshot`/`datumAxisSnapshot`),
 * so the document stores only the parameters and stays in sync by construction.
 *
 * Reused by: New Sketch (sketch on a construction plane) and Mirror (reflect a
 * body across a construction plane). Construction axes are display + reference
 * geometry now; consuming them as a revolve/pattern axis is a fast-follow.
 */

export type DatumBasePlane = 'XY' | 'XZ' | 'YZ';
export type DatumBaseAxis = 'X' | 'Y' | 'Z';

interface DatumBase {
  readonly id: DatumId;
  readonly name: string;
  readonly visible: boolean;
}

/**
 * A construction plane: a base origin plane offset along its normal by
 * `offsetMm` and tilted `tiltDeg` about the world `tiltAxis` — the same
 * parametrization as the (per-sketch) `DatumPlaneRef`, but reusable.
 */
export interface DatumPlane extends DatumBase {
  readonly kind: 'plane';
  readonly base: DatumBasePlane;
  /** Offset (mm) along the base plane's normal. */
  readonly offsetMm: number;
  /** Tilt (deg) of the plane frame about `tiltAxis`. */
  readonly tiltDeg: number;
  readonly tiltAxis: DatumBaseAxis;
}

/**
 * A construction axis: a base origin axis whose direction is rotated `angleDeg`
 * about `angleAxis`, passing through the world point `offset` (mm). Gives full
 * offset + angle control from the base origin.
 */
export interface DatumAxis extends DatumBase {
  readonly kind: 'axis';
  readonly base: DatumBaseAxis;
  /** Through-point of the axis line (mm from the world origin). */
  readonly offset: readonly [number, number, number];
  /** Rotation (deg) of the base direction about `angleAxis`. */
  readonly angleDeg: number;
  readonly angleAxis: DatumBaseAxis;
}

export type Datum = DatumPlane | DatumAxis;

export type DatumKind = Datum['kind'];

export function isDatumPlane(datum: Datum): datum is DatumPlane {
  return datum.kind === 'plane';
}

export function isDatumAxis(datum: Datum): datum is DatumAxis {
  return datum.kind === 'axis';
}
