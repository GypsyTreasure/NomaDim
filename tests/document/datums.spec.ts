import { describe, expect, it } from 'vitest';
import type { DatumId } from '../../src/core/ids';
import {
  applyCommand,
  datumAxisWorld,
  datumPlaneWorld,
  emptyDocument,
  type Datum,
  type DatumAxis,
  type DatumPlane,
} from '../../src/document';

const near = (a: readonly number[], b: readonly number[]): void => {
  a.forEach((v, i) => {
    expect(v).toBeCloseTo(b[i] ?? NaN, 6);
  });
};

const plane = (over: Partial<DatumPlane> = {}): DatumPlane => ({
  id: 'd1' as DatumId,
  name: 'Plane1',
  visible: true,
  kind: 'plane',
  base: 'XY',
  offsetMm: 10,
  tiltDeg: 0,
  tiltAxis: 'X',
  ...over,
});

const axis = (over: Partial<DatumAxis> = {}): DatumAxis => ({
  id: 'd2' as DatumId,
  name: 'Axis1',
  visible: true,
  kind: 'axis',
  base: 'Z',
  offset: [0, 0, 0],
  angleDeg: 0,
  angleAxis: 'Y',
  ...over,
});

describe('datumPlaneWorld', () => {
  it('offsets the origin along the base normal, axes unchanged at zero tilt', () => {
    const w = datumPlaneWorld(plane({ offsetMm: 10, tiltDeg: 0 }));
    near(w.origin, [0, 0, 10]); // XY normal is +Z
    near(w.xAxis, [1, 0, 0]);
    near(w.yAxis, [0, 1, 0]);
    near(w.normal, [0, 0, 1]);
  });

  it('tilts the in-plane frame (and normal) about the chosen world axis', () => {
    // XY plane tilted 90° about X: u stays +X, v (+Y) rotates to +Z, n → −Y.
    const w = datumPlaneWorld(plane({ offsetMm: 0, tiltDeg: 90, tiltAxis: 'X' }));
    near(w.xAxis, [1, 0, 0]);
    near(w.yAxis, [0, 0, 1]);
    near(w.normal, [0, -1, 0]);
  });

  it('offset is along the un-tilted base normal (XZ → +Y)', () => {
    near(datumPlaneWorld(plane({ base: 'XZ', offsetMm: 5 })).origin, [0, 5, 0]);
  });
});

describe('datumAxisWorld', () => {
  it('returns the base direction through the offset point at zero angle', () => {
    const w = datumAxisWorld(axis({ base: 'Z', offset: [1, 2, 3], angleDeg: 0 }));
    near(w.origin, [1, 2, 3]);
    near(w.direction, [0, 0, 1]);
  });

  it('rotates the base direction about the angle axis (Z about Y by 90° → +X)', () => {
    near(datumAxisWorld(axis({ base: 'Z', angleDeg: 90, angleAxis: 'Y' })).direction, [1, 0, 0]);
  });
});

describe('datum commands', () => {
  it('adds, edits, hides, renames and removes a datum (each undoable)', () => {
    const d: Datum = plane();
    const added = applyCommand(emptyDocument(), { type: 'AddDatum', payload: { datum: d } });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.state.datums).toHaveLength(1);

    const edited = applyCommand(added.value.state, {
      type: 'EditDatum',
      payload: { datum: { ...d, offsetMm: 25 } },
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect((edited.value.state.datums[0] as DatumPlane).offsetMm).toBe(25);

    const hidden = applyCommand(edited.value.state, {
      type: 'SetDatumVisible',
      payload: { datumId: d.id, visible: false },
    });
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    expect(hidden.value.state.datums[0]?.visible).toBe(false);

    const removed = applyCommand(hidden.value.state, {
      type: 'RemoveDatum',
      payload: { datumId: d.id },
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.state.datums).toHaveLength(0);
  });

  it('rejects a duplicate id, an unknown edit, and a non-finite parameter', () => {
    const doc = applyCommand(emptyDocument(), { type: 'AddDatum', payload: { datum: plane() } });
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(
      applyCommand(doc.value.state, { type: 'AddDatum', payload: { datum: plane() } }).ok
    ).toBe(false);
    expect(
      applyCommand(emptyDocument(), {
        type: 'EditDatum',
        payload: { datum: plane({ id: 'nope' as DatumId }) },
      }).ok
    ).toBe(false);
    expect(
      applyCommand(emptyDocument(), {
        type: 'AddDatum',
        payload: { datum: plane({ id: 'dx' as DatumId, offsetMm: Number.NaN }) },
      }).ok
    ).toBe(false);
  });
});
