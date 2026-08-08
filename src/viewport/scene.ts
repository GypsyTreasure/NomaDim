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

const ORIGIN_MARKER_COLOR = 0xe5342e; // brand red — matches the logomark node
const ORIGIN_MARKER_RADIUS_MM = 1.4;

/**
 * The world-origin marker (graphic identity): a small unlit red ball at (0,0,0),
 * the 3D echo of the logomark's red node and the sketch-origin dot. Basic
 * (unlit) material so it reads as a fixed marker regardless of lighting/angle.
 */
export function createOriginMarker(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(ORIGIN_MARKER_RADIUS_MM, 16, 12);
  const material = new THREE.MeshBasicMaterial({ color: ORIGIN_MARKER_COLOR });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'OriginMarker';
  mesh.renderOrder = 2; // draw over the faint origin planes
  return mesh;
}

/** XY / XZ / YZ origin planes, keyed by id so callers can toggle visibility per plane. */
export function createOriginPlanes(): Record<OriginPlaneId, THREE.Group> {
  return {
    XY: makePlane('XY', AXIS_COLOR_Z, new THREE.Euler(0, 0, 0)),
    XZ: makePlane('XZ', AXIS_COLOR_Y, new THREE.Euler(Math.PI / 2, 0, 0)),
    YZ: makePlane('YZ', AXIS_COLOR_X, new THREE.Euler(0, Math.PI / 2, 0)),
  };
}

// --- Construction geometry (datum planes & axes) ---------------------------

const DATUM_PLANE_SIZE_MM = 120;
const DATUM_PLANE_OPACITY = 0.16;
const DATUM_COLOR = 0x1a6b5a; // MASTER_DOCUMENT §12 brand teal
const DATUM_GHOST_COLOR = 0xffa62b; // amber — matches op-preview ghosts
const DATUM_AXIS_HALF_LEN_MM = 90;
const DATUM_AXIS_RADIUS_MM = 0.6;

type Triple = readonly [number, number, number];
const vv = (t: Triple): THREE.Vector3 => new THREE.Vector3(t[0], t[1], t[2]);

/** Plain, serializable descriptor of a construction plane for rendering. */
export interface DatumPlaneRender {
  readonly id: string;
  readonly kind: 'plane';
  readonly origin: Triple;
  readonly xAxis: Triple;
  readonly yAxis: Triple;
  readonly normal: Triple;
  /** Amber preview styling for the in-progress creation ghost. */
  readonly ghost?: boolean;
}

/** Plain, serializable descriptor of a construction axis for rendering. */
export interface DatumAxisRender {
  readonly id: string;
  readonly kind: 'axis';
  readonly origin: Triple;
  readonly direction: Triple;
  readonly ghost?: boolean;
}

export type DatumRender = DatumPlaneRender | DatumAxisRender;

function makeDatumPlane(render: DatumPlaneRender): THREE.Group {
  const group = new THREE.Group();
  group.name = `Datum:${render.id}`;
  const color = render.ghost ? DATUM_GHOST_COLOR : DATUM_COLOR;

  const geometry = new THREE.PlaneGeometry(DATUM_PLANE_SIZE_MM, DATUM_PLANE_SIZE_MM);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: render.ghost ? 0.24 : DATUM_PLANE_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 })
  );
  // Orient the local plane frame (+X,+Y,+Z) onto (xAxis, yAxis, normal).
  group.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(vv(render.xAxis), vv(render.yAxis), vv(render.normal))
  );
  group.position.copy(vv(render.origin));
  group.add(mesh, border);
  return group;
}

function makeDatumAxis(render: DatumAxisRender): THREE.Group {
  const group = new THREE.Group();
  group.name = `Datum:${render.id}`;
  const color = render.ghost ? DATUM_GHOST_COLOR : DATUM_COLOR;
  const geometry = new THREE.CylinderGeometry(
    DATUM_AXIS_RADIUS_MM,
    DATUM_AXIS_RADIUS_MM,
    DATUM_AXIS_HALF_LEN_MM * 2,
    8
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
  // The cylinder's default axis is +Y; rotate it onto the datum direction.
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vv(render.direction).normalize());
  group.position.copy(vv(render.origin));
  group.add(mesh);
  return group;
}

/** Builds a renderable construction-geometry object (plane quad or axis rod). */
export function createDatumObject(render: DatumRender): THREE.Group {
  return render.kind === 'plane' ? makeDatumPlane(render) : makeDatumAxis(render);
}

const BODY_COLOR = 0x1a6b5a; // MASTER_DOCUMENT §12 brand teal — default body color.

/**
 * Shading rig (F11 "solid" shading). A single directional light left many faces
 * reading flat (#2); this is a small studio rig so a solid's orientation is
 * legible from any camera angle:
 *  - a Z-up hemisphere (sky/ground) so up- vs down-facing faces differ in tone,
 *  - a low ambient floor so shadowed faces never crush to black,
 *  - a key + a weaker fill from different directions for form definition.
 * Still cheap (4 lights, Lambert shading) — the 100-body ≥30 fps floor holds.
 */
export function createLighting(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lighting';
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa4ad, 0.55);
  hemi.position.set(0, 0, 1); // sky direction = world up (Z-up)
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(1.5, 1, 2);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-1.5, -1.2, 0.6);
  group.add(hemi, ambient, key, fill);
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

/**
 * A clipped body WITH a solid cross-section cap (Intersect view, ADR-0130).
 * A bare clipping plane just discards fragments, so a cut solid reads as a
 * hollow shell (you see its interior wall). This builds the standard stencil
 * cap: two colour-less passes write the solid's cut region into the stencil
 * buffer (back faces increment, front faces decrement, both clipped by the
 * plane), then a plane-aligned quad fills exactly that region — so the cut face
 * reads as solid material for ANY solid and ANY plane orientation. Returns a
 * Group (stencil writers + cap + the visible front-side shell).
 *
 * `order` spaces each body's stencil/cap passes apart so overlapping bodies
 * don't bleed (each cap resets the stencil to 0 as it draws).
 */
const SECTION_CAP_SIZE_MM = 100_000; // large quad; the stencil masks it to the cut

export function createSectionCappedBody(
  mesh: MeshTransfer,
  color: string | undefined,
  selected: boolean,
  plane: THREE.Plane,
  order = 0
): THREE.Group {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const col = new THREE.Color(color ?? BODY_COLOR);
  const group = new THREE.Group();
  group.name = `Body:${mesh.bodyId}`;

  // Stencil writers: no colour/depth, clipped by the plane, so only the kept
  // half's shell tallies. Back faces increment, front faces decrement → the net
  // non-zero region is exactly the solid's cross-section at the plane.
  const stencilBase = (): {
    depthWrite: boolean;
    colorWrite: boolean;
    clippingPlanes: THREE.Plane[];
    stencilWrite: boolean;
    stencilFunc: THREE.StencilFunc;
  } => ({
    depthWrite: false,
    colorWrite: false,
    clippingPlanes: [plane],
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
  });
  const back = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      ...stencilBase(),
      side: THREE.BackSide,
      stencilFail: THREE.IncrementWrapStencilOp,
      stencilZFail: THREE.IncrementWrapStencilOp,
      stencilZPass: THREE.IncrementWrapStencilOp,
    })
  );
  back.renderOrder = order + 1;
  const front = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      ...stencilBase(),
      side: THREE.FrontSide,
      stencilFail: THREE.DecrementWrapStencilOp,
      stencilZFail: THREE.DecrementWrapStencilOp,
      stencilZPass: THREE.DecrementWrapStencilOp,
    })
  );
  front.renderOrder = order + 1;

  // Cap quad on the plane: drawn where the stencil is non-zero, and resets it to
  // 0 so the next body starts clean. Shaded like the body so the cut face reads
  // as material. Not itself clipped (it lies on the plane).
  const capMat = new THREE.MeshLambertMaterial({
    color: col,
    emissive: new THREE.Color(selected ? 0x2fa78d : 0x101014),
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  const cap = new THREE.Mesh(
    new THREE.PlaneGeometry(SECTION_CAP_SIZE_MM, SECTION_CAP_SIZE_MM),
    capMat
  );
  cap.renderOrder = order + 2;
  // Orient the quad to the plane and sit it on the plane.
  cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal.clone());
  cap.position.copy(plane.normal).multiplyScalar(-plane.constant);

  // The visible shell: front-side only (no see-through interior) + clipped.
  const visible = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({
      color: col,
      emissive: new THREE.Color(selected ? 0x2fa78d : 0x000000),
      clippingPlanes: [plane],
    })
  );

  group.add(back, front, cap, visible);
  return group;
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
