import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  mappingFromBasis,
  originPlaneBasis,
  planeToWorld,
  worldToPlane,
  type SketchPlaneBasis,
} from '../../src/viewport/planeMapping';

/**
 * Generalized sketch-plane mapping (#1b foundation): a plane has a world
 * origin plus orthonormal (u,v) axes, so an offset body-face plane and an
 * origin plane share the same projection math. Origin planes stay at (0,0,0)
 * — a zero-behavior-change generalization.
 */

describe('plane mapping with origin offset', () => {
  it('origin planes sit at the world origin', () => {
    const m = mappingFromBasis(originPlaneBasis('XY'));
    expect(m.origin.equals(new THREE.Vector3(0, 0, 0))).toBe(true);
    expect(planeToWorld(m, { x: 3, y: 4 })).toEqual(new THREE.Vector3(3, 4, 0));
  });

  it('XZ maps sketch v to world +Z', () => {
    const m = mappingFromBasis(originPlaneBasis('XZ'));
    expect(planeToWorld(m, { x: 2, y: 5 })).toEqual(new THREE.Vector3(2, 0, 5));
  });

  it('an offset face plane translates by its origin and round-trips', () => {
    // A plane parallel to XY but lifted to z = 10 (e.g. the top of a box).
    const basis: SketchPlaneBasis = {
      key: 'face:test',
      origin: [1, 2, 10],
      uAxis: [1, 0, 0],
      vAxis: [0, 1, 0],
      normal: [0, 0, 1],
    };
    const m = mappingFromBasis(basis);
    const world = planeToWorld(m, { x: 4, y: 5 });
    expect(world).toEqual(new THREE.Vector3(5, 7, 10));
    const back = worldToPlane(m, world);
    expect(back.x).toBeCloseTo(4, 9);
    expect(back.y).toBeCloseTo(5, 9);
  });
});
