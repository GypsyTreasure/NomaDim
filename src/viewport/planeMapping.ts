import * as THREE from 'three';
import type { Vec2 } from '../core';

/**
 * Origin-plane ↔ world mapping. World is Z-up (CAD convention, matching
 * Fusion): the model XY plane is the horizontal ground. Sketch-local (u,v)
 * axes map per plane; `upAxis` is the world direction of sketch +v, used to
 * orient the camera when entering a sketch.
 */

export type OriginPlaneId = 'XY' | 'XZ' | 'YZ';

export interface PlaneMapping {
  readonly plane: OriginPlaneId;
  readonly normal: THREE.Vector3;
  readonly uAxis: THREE.Vector3;
  readonly vAxis: THREE.Vector3;
}

export function planeMapping(plane: OriginPlaneId): PlaneMapping {
  switch (plane) {
    case 'XY':
      return {
        plane,
        normal: new THREE.Vector3(0, 0, 1),
        uAxis: new THREE.Vector3(1, 0, 0),
        vAxis: new THREE.Vector3(0, 1, 0),
      };
    case 'XZ':
      return {
        plane,
        normal: new THREE.Vector3(0, 1, 0),
        uAxis: new THREE.Vector3(1, 0, 0),
        vAxis: new THREE.Vector3(0, 0, 1),
      };
    case 'YZ':
      return {
        plane,
        normal: new THREE.Vector3(1, 0, 0),
        uAxis: new THREE.Vector3(0, 1, 0),
        vAxis: new THREE.Vector3(0, 0, 1),
      };
    default: {
      const exhaustive: never = plane;
      return exhaustive;
    }
  }
}

export function planeToWorld(mapping: PlaneMapping, p: Vec2): THREE.Vector3 {
  return new THREE.Vector3()
    .addScaledVector(mapping.uAxis, p.x)
    .addScaledVector(mapping.vAxis, p.y);
}

export function worldToPlane(mapping: PlaneMapping, world: THREE.Vector3): Vec2 {
  return { x: world.dot(mapping.uAxis), y: world.dot(mapping.vAxis) };
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
