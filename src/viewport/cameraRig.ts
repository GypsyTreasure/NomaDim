import * as THREE from 'three';

/**
 * Projection management for the viewport camera (F11): a single rig that owns
 * either a perspective or an orthographic camera and toggles between them while
 * preserving eye position, target, up vector, and apparent framing.
 *
 * The pure helpers (`halfHeightAtDistance`, `orthoExtents`) are DOM-free and
 * unit-tested; the `CameraRig` class wires them to real THREE cameras.
 */

export type ProjectionMode = 'perspective' | 'orthographic';

export const PERSPECTIVE_FOV_DEG = 50;

const NEAR = 0.1;
const FAR = 10_000;

/**
 * World half-height visible at `distance` in front of a perspective camera of
 * vertical field-of-view `fovDeg`. Deriving an orthographic frustum from this
 * makes a perspective→ortho toggle seamless at the target plane: both show the
 * same vertical extent there.
 */
export function halfHeightAtDistance(
  distance: number,
  fovDeg: number = PERSPECTIVE_FOV_DEG
): number {
  return distance * Math.tan((fovDeg * Math.PI) / 360);
}

export interface OrthoExtents {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Symmetric orthographic frustum extents for a world half-height and viewport aspect. */
export function orthoExtents(halfHeight: number, aspect: number): OrthoExtents {
  const halfWidth = halfHeight * aspect;
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight };
}

export type RigCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export class CameraRig {
  private cam: RigCamera;
  private projection: ProjectionMode = 'perspective';
  private aspect = 1;
  /** Current orthographic world half-height (vertical); tracked across resizes. */
  private orthoHalfHeight = 100;

  constructor(position: THREE.Vector3, up: THREE.Vector3, target: THREE.Vector3) {
    const cam = new THREE.PerspectiveCamera(PERSPECTIVE_FOV_DEG, this.aspect, NEAR, FAR);
    cam.up.copy(up);
    cam.position.copy(position);
    cam.lookAt(target);
    this.cam = cam;
  }

  get camera(): RigCamera {
    return this.cam;
  }

  get mode(): ProjectionMode {
    return this.projection;
  }

  /** Update the viewport aspect ratio, keeping the current vertical framing. */
  setAspect(aspect: number): void {
    if (aspect <= 0) return;
    this.aspect = aspect;
    if (this.cam instanceof THREE.PerspectiveCamera) {
      this.cam.aspect = aspect;
    } else {
      const e = orthoExtents(this.orthoHalfHeight, aspect);
      this.cam.left = e.left;
      this.cam.right = e.right;
      this.cam.top = e.top;
      this.cam.bottom = e.bottom;
    }
    this.cam.updateProjectionMatrix();
  }

  /**
   * Swap projection while preserving eye/target/up and apparent scale at the
   * target plane. Returns the new active camera so the caller can rebind
   * OrbitControls (`controls.object`) and any render pass.
   */
  toggle(target: THREE.Vector3): RigCamera {
    return this.setProjection(
      this.projection === 'perspective' ? 'orthographic' : 'perspective',
      target
    );
  }

  setProjection(mode: ProjectionMode, target: THREE.Vector3): RigCamera {
    if (mode === this.projection) return this.cam;
    const prev = this.cam;
    const distance = Math.max(prev.position.distanceTo(target), 1e-3);
    let next: RigCamera;
    if (mode === 'orthographic') {
      this.orthoHalfHeight = halfHeightAtDistance(distance);
      const e = orthoExtents(this.orthoHalfHeight, this.aspect);
      next = new THREE.OrthographicCamera(e.left, e.right, e.top, e.bottom, NEAR, FAR);
    } else {
      next = new THREE.PerspectiveCamera(PERSPECTIVE_FOV_DEG, this.aspect, NEAR, FAR);
    }
    next.up.copy(prev.up);
    next.position.copy(prev.position);
    next.quaternion.copy(prev.quaternion);
    next.zoom = 1;
    next.updateProjectionMatrix();
    this.cam = next;
    this.projection = mode;
    return next;
  }

  /**
   * Frame `box` in view along the current view direction, writing the new focus
   * point into `target`. Perspective uses the historical box-fit math; ortho
   * sizes its frustum to the box's bounding sphere so scale is distance-free.
   */
  frameBox(box: THREE.Box3, target: THREE.Vector3): void {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const direction = this.cam.position.clone().sub(target).normalize();
    if (direction.lengthSq() === 0) direction.set(1, 1, 1).normalize();

    if (this.cam instanceof THREE.PerspectiveCamera) {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fitHeightDistance = maxDim / (2 * Math.tan((Math.PI * this.cam.fov) / 360));
      const fitWidthDistance = fitHeightDistance / this.aspect;
      const distance = 1.2 * Math.max(fitHeightDistance, fitWidthDistance);
      this.cam.position.copy(center).addScaledVector(direction, distance);
      this.cam.near = Math.max(distance / 100, 0.01);
      this.cam.far = distance * 100;
      this.cam.updateProjectionMatrix();
    } else {
      const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1e-3);
      // Cover the sphere both vertically and horizontally regardless of aspect.
      this.orthoHalfHeight = 1.15 * Math.max(radius, radius / this.aspect);
      const distance = radius * 4;
      this.cam.position.copy(center).addScaledVector(direction, distance);
      this.cam.near = 0.01;
      this.cam.far = distance + radius * 4;
      this.cam.zoom = 1;
      this.setAspect(this.aspect); // rewrites extents from the new half-height
    }
    target.copy(center);
  }
}
