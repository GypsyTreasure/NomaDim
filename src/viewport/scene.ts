import * as THREE from 'three';

/**
 * Scene-construction helpers for the M0 viewport: grid, origin planes,
 * zoom-to-fit. Pure Three.js — no React, no application state. The
 * `viewport/` layer owns all scene mutation (ARCHITECTURE §3); nothing
 * outside this layer touches these objects directly.
 */

const GRID_SIZE_MM = 500;
const GRID_DIVISIONS = 50;
const GRID_COLOR_CENTER = 0x5a6b78;
const GRID_COLOR_LINES = 0x2e3a44;

const ORIGIN_PLANE_SIZE_MM = 200;
const ORIGIN_PLANE_OPACITY = 0.06;

// Fusion 360 axis convention: X = red, Y = green, Z = blue.
const AXIS_COLOR_X = 0xe0554f;
const AXIS_COLOR_Y = 0x4fae63;
const AXIS_COLOR_Z = 0x3f7fbf;

export function createGrid(): THREE.GridHelper {
  const grid = new THREE.GridHelper(
    GRID_SIZE_MM,
    GRID_DIVISIONS,
    GRID_COLOR_CENTER,
    GRID_COLOR_LINES
  );
  grid.name = 'ReferenceGrid';
  return grid;
}

export type OriginPlaneId = 'XY' | 'XZ' | 'YZ';

function makePlane(id: OriginPlaneId, color: number, rotation: THREE.Euler): THREE.Group {
  const group = new THREE.Group();
  group.name = `OriginPlane:${id}`;

  const geometry = new THREE.PlaneGeometry(ORIGIN_PLANE_SIZE_MM, ORIGIN_PLANE_SIZE_MM);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: ORIGIN_PLANE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.copy(rotation);

  const edges = new THREE.EdgesGeometry(geometry);
  const border = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })
  );
  border.rotation.copy(rotation);

  group.add(mesh, border);
  return group;
}

/** XY / XZ / YZ origin planes, keyed by id so callers can toggle visibility per plane. */
export function createOriginPlanes(): Record<OriginPlaneId, THREE.Group> {
  return {
    XY: makePlane('XY', AXIS_COLOR_Z, new THREE.Euler(0, 0, 0)),
    XZ: makePlane('XZ', AXIS_COLOR_Y, new THREE.Euler(Math.PI / 2, 0, 0)),
    YZ: makePlane('YZ', AXIS_COLOR_X, new THREE.Euler(0, Math.PI / 2, 0)),
  };
}

/**
 * Frees GPU buffers for every disposable object in `scene` (ARCHITECTURE R8
 * discipline extends to viewport resources, not just OCCT handles).
 *
 * Re-casts after the `instanceof` check: @types/three's `Mesh`/`LineSegments`
 * take 2-3 generic params with defaults, and TS does not apply those
 * defaults through `instanceof` narrowing on a generic class — the narrowed
 * type resolves to `Mesh<any, any, any>` without the cast.
 */
export function disposeSceneObjects(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return;
    const disposable = object as THREE.Mesh | THREE.LineSegments;
    disposable.geometry.dispose();
    const material = disposable.material;
    if (Array.isArray(material)) {
      material.forEach((m) => {
        m.dispose();
      });
    } else {
      material.dispose();
    }
  });
}

export interface FitTarget {
  camera: THREE.PerspectiveCamera;
  controlsTarget: THREE.Vector3;
  box: THREE.Box3;
}

/** Frames `box` in view by repositioning the camera along its current view direction. */
export function zoomToFit({ camera, controlsTarget, box }: FitTarget): void {
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fitHeightDistance = maxDim / (2 * Math.tan((Math.PI * camera.fov) / 360));
  const fitWidthDistance = fitHeightDistance / camera.aspect;
  const distance = 1.2 * Math.max(fitHeightDistance, fitWidthDistance);

  const direction = camera.position.clone().sub(controlsTarget).normalize();
  if (direction.lengthSq() === 0) {
    direction.set(1, 1, 1).normalize();
  }

  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  controlsTarget.copy(center);
}
