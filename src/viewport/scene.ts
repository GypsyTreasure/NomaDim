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
export function createBodyMesh(
  mesh: MeshTransfer,
  color?: string,
  selected = false,
  clippingPlanes?: THREE.Plane[]
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

  // Lambert (per-vertex lighting) over Standard (per-fragment PBR): visually
  // similar for opaque CAD bodies but far cheaper to shade, which keeps a
  // 100-body session at ≥ 30 fps even on software rendering (M5 acceptance).
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(color ?? BODY_COLOR),
    // Selection highlight (F8 tree ⇄ viewport sync): a subtle self-glow.
    emissive: new THREE.Color(selected ? 0x2fa78d : 0x000000),
    // Double-side when clipped (Intersect view #1, so the newly-open interior
    // shades rather than reading see-through) OR for a zero-thickness surface
    // body (ADR-0072), which would otherwise vanish edge-on / from the back.
    ...(mesh.open || (clippingPlanes && clippingPlanes.length > 0)
      ? { side: THREE.DoubleSide }
      : {}),
    ...(clippingPlanes && clippingPlanes.length > 0 ? { clippingPlanes } : {}),
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = `Body:${mesh.bodyId}`;
  return object;
}

const GHOST_COLOR = 0xffa62b; // amber — matches the op-selection highlight (F3)

/**
 * A translucent "ghost" of a body a pending op would produce (F3 live preview).
 * Amber, semi-transparent, double-sided with depth-write off so it reads as a
 * preview floating over the real geometry rather than a solid body.
 */
export function createGhostMesh(mesh: MeshTransfer): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(GHOST_COLOR),
    emissive: new THREE.Color(GHOST_COLOR),
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = 'PreviewGhost';
  object.renderOrder = 998; // over solids, under the op-highlight lines (999)
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

// Camera framing (zoom-to-fit) lives in `cameraRig.ts`, which owns projection
// state and frames both perspective and orthographic cameras.
