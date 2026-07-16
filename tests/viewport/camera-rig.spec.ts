import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CameraRig,
  PERSPECTIVE_FOV_DEG,
  halfHeightAtDistance,
  orthoExtents,
} from '../../src/viewport/cameraRig';

/**
 * Projection rig (F11): the pure framing math plus the perspective↔ortho
 * toggle. A toggle must preserve eye/up and match apparent scale at the target
 * so the swap is visually seamless.
 */

describe('halfHeightAtDistance', () => {
  it('is distance · tan(fov/2)', () => {
    const d = 100;
    const expected = d * Math.tan((PERSPECTIVE_FOV_DEG * Math.PI) / 360);
    expect(halfHeightAtDistance(d)).toBeCloseTo(expected, 6);
  });

  it('scales linearly with distance', () => {
    expect(halfHeightAtDistance(200)).toBeCloseTo(2 * halfHeightAtDistance(100), 6);
  });
});

describe('orthoExtents', () => {
  it('is symmetric and widens with aspect', () => {
    const e = orthoExtents(10, 2);
    expect(e.top).toBe(10);
    expect(e.bottom).toBe(-10);
    expect(e.right).toBe(20);
    expect(e.left).toBe(-20);
  });
});

describe('CameraRig', () => {
  const target = () => new THREE.Vector3(0, 0, 0);

  it('starts as a perspective camera', () => {
    const rig = new CameraRig(new THREE.Vector3(0, -100, 0), new THREE.Vector3(0, 0, 1), target());
    expect(rig.mode).toBe('perspective');
    expect(rig.camera).toBeInstanceOf(THREE.PerspectiveCamera);
  });

  it('toggles to orthographic, preserving eye + up and matching scale', () => {
    const eye = new THREE.Vector3(0, -100, 0);
    const rig = new CameraRig(eye.clone(), new THREE.Vector3(0, 0, 1), target());
    rig.setAspect(16 / 9);

    const ortho = rig.toggle(target());
    expect(rig.mode).toBe('orthographic');
    expect(ortho).toBeInstanceOf(THREE.OrthographicCamera);
    expect(ortho.position.distanceTo(eye)).toBeCloseTo(0, 6);
    expect(ortho.up.z).toBeCloseTo(1, 6);

    // Vertical half-height matches the perspective view at the target distance.
    const half = halfHeightAtDistance(100);
    const o = ortho as THREE.OrthographicCamera;
    expect(o.top).toBeCloseTo(half, 4);
    expect(o.right / o.top).toBeCloseTo(16 / 9, 4);
  });

  it('toggles back to perspective, preserving the eye', () => {
    const eye = new THREE.Vector3(50, -50, 40);
    const rig = new CameraRig(eye.clone(), new THREE.Vector3(0, 0, 1), target());
    rig.toggle(target());
    const persp = rig.toggle(target());
    expect(rig.mode).toBe('perspective');
    expect(persp).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(persp.position.distanceTo(eye)).toBeCloseTo(0, 6);
  });

  it('setAspect updates the live camera for both projections', () => {
    const rig = new CameraRig(new THREE.Vector3(0, -100, 0), new THREE.Vector3(0, 0, 1), target());
    rig.setAspect(2);
    expect((rig.camera as THREE.PerspectiveCamera).aspect).toBeCloseTo(2, 6);
    rig.toggle(target());
    rig.setAspect(3);
    const o = rig.camera as THREE.OrthographicCamera;
    expect(o.right / o.top).toBeCloseTo(3, 6);
  });

  it('frames a box: perspective pulls back along the view direction', () => {
    const rig = new CameraRig(new THREE.Vector3(0, -10, 0), new THREE.Vector3(0, 0, 1), target());
    rig.setAspect(1);
    const box = new THREE.Box3(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
    const tgt = target();
    rig.frameBox(box, tgt);
    expect(tgt.length()).toBeCloseTo(0, 6); // centred on the box
    // Camera sits along -Y (its original view direction), pulled back well past the box.
    expect(rig.camera.position.y).toBeLessThan(-50);
    expect(Math.abs(rig.camera.position.x)).toBeLessThan(1e-6);
  });

  it('frames a box: orthographic sizes the frustum to the box', () => {
    const rig = new CameraRig(new THREE.Vector3(0, -10, 0), new THREE.Vector3(0, 0, 1), target());
    rig.setAspect(1);
    rig.toggle(target());
    const box = new THREE.Box3(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
    rig.frameBox(box, target());
    const o = rig.camera as THREE.OrthographicCamera;
    // Half-height must cover the box's bounding-sphere radius (~86.6).
    expect(o.top).toBeGreaterThanOrEqual(box.getBoundingSphere(new THREE.Sphere()).radius);
  });
});
