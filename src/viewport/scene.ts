import * as THREE from 'three';
import type { MeshTransfer } from '../kernel';
import type { OriginPlaneId } from './planeMapping';

/**
 * Scene-construction helpers for the viewport: grid, origin planes, body
 * meshes, lighting, zoom-to-fit. Pure Three.js — no React, no application
 * state. The `viewport/` layer owns all scene mutation (ARCHITECTURE §3);
 * nothing outside this layer touches these objects directly.
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
  // World is Z-up (CAD convention); GridHelper spans XZ by default → rotate into XY.
  grid.rotation.x = Math.PI / 2;
  return grid;
}

export type { OriginPlaneId };

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

const BODY_COLOR = 0x1a6b5a; // MASTER_DOCUMENT §12 brand teal — default body color.

/** Basic shading rig (F11 "solid" shading) — plain ambient + one directional light. */
export function createLighting(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lighting';
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const directional = new THREE.DirectionalLight(0xffffff, 1.2);
  directional.position.set(1, 2, 1.5);
  group.add(ambient, directional);
  return group;
}

/** Builds a shaded body mesh from a worker-tessellated MeshTransfer (R5 Transferable buffers). */
export function createBodyMesh(mesh: MeshTransfer, color?: string, selected = false): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color ?? BODY_COLOR),
    metalness: 0.1,
    roughness: 0.6,
    // Selection highlight (F8 tree ⇄ viewport sync): a subtle self-glow.
    emissive: new THREE.Color(selected ? 0x2fa78d : 0x000000),
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = `Body:${mesh.bodyId}`;
  return object;
}

/**
 * Frees GPU buffers for every disposable object under `root` (ARCHITECTURE
 * R8 discipline extends to viewport resources, not just OCCT handles).
 *
 * Re-casts after the `instanceof` check: @types/three's `Mesh`/`Line` take
 * 2-3 generic params with defaults, and TS does not apply those defaults
 * through `instanceof` narrowing on a generic class — the narrowed type
 * resolves to `Mesh<any, any, any>` without the cast. `THREE.Line` also
 * covers `LineSegments` (a subclass) and the F4 pickable edge lines.
 */
export function disposeSceneObjects(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
    const disposable = object as THREE.Mesh | THREE.Line;
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
