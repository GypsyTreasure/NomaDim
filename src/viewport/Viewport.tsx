import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { viewOrientation, VIEW_IDS, type ViewId } from './viewOrientation';
import { CameraRig, type ProjectionMode, type RigCamera } from './cameraRig';
import type { BodyId, Vec2 } from '../core';
import {
  edgeFingerprintKey,
  type BodyEdges,
  type EdgeFingerprint,
  type MeshTransfer,
} from '../kernel';
import {
  createBodyMesh,
  createGrid,
  createLighting,
  createOriginPlanes,
  disposeSceneObjects,
} from './scene';
import {
  mappingFromBasis,
  planeMapping,
  planeToWorld,
  pixelsPerMm,
  worldToPlane,
  type OriginPlaneId,
  type SketchPlaneBasis,
} from './planeMapping';
import { buildMeasureCandidates, type MeasureCandidate } from './measureSnap';
import { drawSketchOverlay, type SketchOverlayState } from './sketchOverlay';
import styles from './Viewport.module.css';

/** Keyboard shortcut per standard view, shown as a tooltip (master rule, ADR-0032). */
const VIEW_KEY_HINT: Record<ViewId, string> = {
  home: '0',
  front: '1',
  back: '2',
  left: '3',
  right: '4',
  top: '5',
  bottom: '6',
};
const CAMERA_INITIAL_POSITION = new THREE.Vector3(280, -280, 220); // Z-up isometric-ish
const SKETCH_CAMERA_LERP = 0.18;

export interface SketchModeProps {
  /** World-space basis of the sketch plane (origin plane or body face). */
  readonly basis: SketchPlaneBasis;
  readonly overlay: SketchOverlayState;
  /** Cursor moved over the sketch plane (sketch-local mm + current px/mm scale, R11). */
  readonly onCursor: (point: Vec2, pxPerMm: number) => void;
  /** Primary click on the sketch plane. */
  readonly onClickPoint: (point: Vec2, pxPerMm: number) => void;
  /** Change tool (F2): grab the nearest point for dragging; true if one was grabbed. */
  readonly onPointGrab?: (point: Vec2, pxPerMm: number) => boolean;
  /** A grabbed point is being dragged to `point`. */
  readonly onPointDrag?: (point: Vec2) => void;
  /** The grabbed point was released (commit the move). */
  readonly onPointDrop?: () => void;
}

/** Active while a Fillet/Chamfer dialog is picking edges (F4). */
export interface EdgePickProps {
  readonly bodyEdges: readonly BodyEdges[];
  readonly pickedKeys: ReadonlySet<string>;
  readonly onPick: (fingerprint: EdgeFingerprint) => void;
}

/** A measured pick (F10): a world point, plus a radius if a circular edge. */
export interface MeasurePick {
  readonly world: readonly [number, number, number];
  readonly circleRadius: number | null;
}

/** Active while Measure mode is on (F10). */
export interface MeasureProps {
  readonly bodyEdges: readonly BodyEdges[];
  readonly onPick: (pick: MeasurePick) => void;
}

/** Active while choosing a body face to sketch on (F2 sketch-on-face). */
export interface FacePickProps {
  readonly onPick: (bodyId: BodyId, point: readonly [number, number, number]) => void;
}

/** Per-body render style from the browser tree (F8). */
export interface BodyStyle {
  readonly color: string;
  readonly visible: boolean;
  readonly selected: boolean;
}

/**
 * A committed sketch drawn as reference geometry in 3D (Fusion parity: a
 * sketch's preview stays in the scene until a feature consumes it). The app
 * evaluates entities to sketch-local polylines (mm); the viewport maps them
 * onto the plane and owns the Three.js objects.
 */
export interface SketchPreview {
  readonly sketchId: string;
  /** World-space plane basis (origin plane OR body face), so face sketches show too. */
  readonly basis: SketchPlaneBasis;
  readonly polylines: readonly (readonly Vec2[])[];
}

/**
 * Geometry a 3D-op dialog will act on, highlighted bright over everything
 * (F3): the selected profile loops (closed) and an optional revolve axis, in
 * sketch-local mm on the given plane. Drawn depth-test-free so it reads even
 * through a solid body.
 */
export interface OpHighlight {
  readonly plane: OriginPlaneId;
  readonly loops: readonly (readonly Vec2[])[];
  readonly axis: readonly Vec2[] | null;
}

export interface ViewportProps {
  /** Label text for the zoom-to-fit button (translated by the caller — §3 viewport-scope). */
  zoomToFitLabel: string;
  /** Translated labels for the standard view buttons (F11); absent → no view bar. */
  viewLabels?: Partial<Record<ViewId, string>>;
  /** Translated labels for the projection toggle (F11); absent → no toggle. */
  projectionLabels?: Readonly<Record<ProjectionMode, string>>;
  /** Whether the floating view bar is shown (collapsed behind the View menu). */
  viewBarOpen?: boolean;
  bodies: MeshTransfer[];
  /** Non-null while a sketch is being edited; camera animates normal-to-plane. */
  sketchMode: SketchModeProps | null;
  /** Non-null while picking edges for a finishing op (F4). */
  edgePick?: EdgePickProps | null;
  /** Non-null while Measure mode is on (F10). */
  measure?: MeasureProps | null;
  /** Per-body colour/visibility/selection (F8); absent id → default style. */
  bodyStyles?: ReadonlyMap<BodyId, BodyStyle>;
  /** Origin plane visibility (F8). */
  planeVisibility?: Readonly<Record<OriginPlaneId, boolean>>;
  /** Committed sketches shown as 3D reference geometry (visible + not being edited). */
  sketchPreviews?: readonly SketchPreview[];
  /** Geometry an open Extrude/Revolve dialog will act on, highlighted (F3). */
  opHighlight?: OpHighlight | null;
  /** A body was clicked in the viewport (null = empty space) — tree sync (F8). */
  onSelectBody?: (bodyId: BodyId | null) => void;
  /** Non-null while picking a body face to sketch on (F2). */
  facePick?: FacePickProps | null;
}

const EDGE_COLOR = 0x0d1b2a; // navy
const EDGE_PICKED_COLOR = 0x1a6b5a; // teal
const EDGE_HOVER_COLOR = 0x2fa78d; // bright teal
const EDGE_PICK_THRESHOLD_MM = 2;
const SKETCH_PREVIEW_COLOR = 0x1a6b5a; // teal — sketch reference geometry (tokens brand teal)
const OP_HIGHLIGHT_COLOR = 0xffa62b; // amber — op selection highlight, reads over teal + bodies

/**
 * Owns the Three.js scene, camera/controls, picking, and the 2D sketch
 * overlay (ARCHITECTURE §3). No document mutation, no business rules —
 * sketch interactions surface as plane-space callbacks the app layer
 * interprets.
 */
export function Viewport({
  zoomToFitLabel,
  viewLabels,
  projectionLabels,
  viewBarOpen = true,
  bodies,
  sketchMode,
  edgePick = null,
  measure = null,
  bodyStyles,
  planeVisibility,
  sketchPreviews,
  opHighlight,
  onSelectBody,
  facePick = null,
}: ViewportProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fitRequestRef = useRef<(() => void) | null>(null);
  const viewRequestRef = useRef<((id: ViewId) => void) | null>(null);
  const projectionRequestRef = useRef<(() => void) | null>(null);
  const [projectionMode, setProjectionMode] = useState<ProjectionMode>('perspective');
  const bodyGroupRef = useRef<THREE.Group | null>(null);
  const edgeGroupRef = useRef<THREE.Group | null>(null);
  const sketchGroupRef = useRef<THREE.Group | null>(null);
  const highlightGroupRef = useRef<THREE.Group | null>(null);
  const originPlanesRef = useRef<Record<OriginPlaneId, THREE.Group> | null>(null);
  const cameraRef = useRef<RigCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  // Live props for the rAF loop (avoids rebuilding the loop on each render);
  // written post-commit in an effect, never during render.
  const sketchModeRef = useRef<SketchModeProps | null>(null);
  const edgePickRef = useRef<EdgePickProps | null>(null);
  const measureRef = useRef<MeasureProps | null>(null);
  const measureCandidatesRef = useRef<MeasureCandidate[]>([]);
  const onSelectBodyRef = useRef<((bodyId: BodyId | null) => void) | undefined>(undefined);
  const facePickRef = useRef<FacePickProps | null>(null);
  useEffect(() => {
    sketchModeRef.current = sketchMode;
  }, [sketchMode]);
  useEffect(() => {
    edgePickRef.current = edgePick;
  }, [edgePick]);
  useEffect(() => {
    measureRef.current = measure;
    measureCandidatesRef.current = measure ? buildMeasureCandidates(measure.bodyEdges) : [];
  }, [measure]);
  useEffect(() => {
    onSelectBodyRef.current = onSelectBody;
  }, [onSelectBody]);
  useEffect(() => {
    facePickRef.current = facePick;
  }, [facePick]);

  useEffect(() => {
    const host = hostRef.current;
    const overlayCanvas = overlayRef.current;
    if (!host || !overlayCanvas) return;

    const scene = new THREE.Scene();
    // No solid scene background: the renderer clears to transparent so the
    // container's irregular light-grey CSS gradient shows through (#1).

    // The rig owns projection: `camera` is reassigned (not a fresh const) when
    // it toggles perspective↔ortho so every closure below sees the live camera.
    const rig = new CameraRig(
      CAMERA_INITIAL_POSITION,
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, 0)
    );
    let camera = rig.camera;
    cameraRef.current = camera;

    // Anti-aliasing stays off (ADR-0015/ADR-0027): the M5 acceptance guard
    // measures fps in software rasterization, where MSAA multiplies fragment
    // cost and full-screen FXAA is even worse — both drop a 100-body session
    // to single-digit fps. On a real GPU neither matters, but the guard can't
    // tell the two apart, so edge smoothing is deferred to a GPU/body-count-
    // gated quality toggle rather than shipped globally.
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setClearColor(0x000000, 0); // transparent → CSS gradient backdrop shows
    renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(renderer.domElement);
    host.appendChild(overlayCanvas); // keep overlay above the WebGL canvas
    const ctx = overlayCanvas.getContext('2d');

    const controls = new OrbitControls(camera, overlayCanvas);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    const grid = createGrid();
    const originPlanes = createOriginPlanes();
    originPlanesRef.current = originPlanes;
    const lighting = createLighting();
    const bodyGroup = new THREE.Group();
    bodyGroup.name = 'Bodies';
    bodyGroupRef.current = bodyGroup;
    const edgeGroup = new THREE.Group();
    edgeGroup.name = 'Edges';
    edgeGroup.visible = false;
    edgeGroupRef.current = edgeGroup;
    const sketchGroup = new THREE.Group();
    sketchGroup.name = 'SketchPreviews';
    sketchGroupRef.current = sketchGroup;
    const highlightGroup = new THREE.Group();
    highlightGroup.name = 'OpHighlight';
    highlightGroup.renderOrder = 999; // drawn last, over bodies (depth-test off)
    highlightGroupRef.current = highlightGroup;
    scene.add(
      grid,
      originPlanes.XY,
      originPlanes.XZ,
      originPlanes.YZ,
      lighting,
      bodyGroup,
      edgeGroup,
      sketchGroup,
      highlightGroup
    );

    let width = 0;
    let height = 0;
    const resize = (): void => {
      width = host.clientWidth;
      height = host.clientHeight;
      if (width === 0 || height === 0) return;
      rig.setAspect(width / height);
      renderer.setSize(width, height);
      const dpr = window.devicePixelRatio;
      overlayCanvas.width = Math.round(width * dpr);
      overlayCanvas.height = Math.round(height * dpr);
      overlayCanvas.style.width = `${String(width)}px`;
      overlayCanvas.style.height = `${String(height)}px`;
    };

    fitRequestRef.current = () => {
      const box = new THREE.Box3().setFromObject(scene);
      rig.frameBox(box, controls.target);
      controls.update();
    };

    // Toggle perspective↔orthographic (F11): rebind controls + render loop to
    // the new camera and surface the mode so the button label follows.
    projectionRequestRef.current = () => {
      camera = rig.toggle(controls.target);
      controls.object = camera;
      cameraRef.current = camera;
      setProjectionMode(rig.mode);
      controls.update();
    };

    // Snap the camera to a standard CAD view (F11): keep the current distance
    // to the target, place it along the view direction, set the up vector.
    viewRequestRef.current = (id: ViewId) => {
      if (sketchModeRef.current) return; // camera is plane-locked while sketching
      const o = viewOrientation(id);
      const distance = Math.max(camera.position.distanceTo(controls.target), 1);
      camera.up.set(o.up[0], o.up[1], o.up[2]);
      camera.position
        .copy(controls.target)
        .addScaledVector(new THREE.Vector3(o.dir[0], o.dir[1], o.dir[2]), distance);
      camera.lookAt(controls.target);
      controls.update();
    };

    resize();
    fitRequestRef.current();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    // Viewport navigation shortcuts (master rule, ADR-0032): Z zoom-to-fit,
    // O projection toggle, 0 Home, 1–6 the six standard faces. Inert while
    // sketching (camera plane-locked) or typing.
    const viewKeys: Record<string, ViewId> = {
      '0': 'home',
      '1': 'front',
      '2': 'back',
      '3': 'left',
      '4': 'right',
      '5': 'top',
      '6': 'bottom',
    };
    const onViewKey = (event: KeyboardEvent): void => {
      if (sketchModeRef.current || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      const key = event.key.toLowerCase();
      const view = viewKeys[event.key];
      if (key === 'z') {
        fitRequestRef.current?.();
      } else if (key === 'o') {
        projectionRequestRef.current?.();
      } else if (view) {
        viewRequestRef.current?.(view);
      }
    };
    window.addEventListener('keydown', onViewKey);

    // --- Sketch-mode camera animation state -------------------------------
    let animatedPlaneKey: string | null = null;
    let cameraTarget: { position: THREE.Vector3; up: THREE.Vector3; look: THREE.Vector3 } | null =
      null;

    const updateSketchCamera = (): void => {
      const mode = sketchModeRef.current;
      // Orbit while free; lock rotation during sketch editing, edge picking,
      // and measuring so a click resolves to a pick, not an orbit.
      controls.enableRotate =
        mode === null && edgePickRef.current === null && measureRef.current === null;
      if (!mode) {
        animatedPlaneKey = null;
        cameraTarget = null;
        return;
      }
      if (mode.basis.key !== animatedPlaneKey) {
        animatedPlaneKey = mode.basis.key;
        const mapping = mappingFromBasis(mode.basis);
        const distance = Math.max(camera.position.length(), 120);
        // Look at the plane origin (0,0,0 for origin planes, the face for a
        // body-face sketch) from along the plane normal.
        cameraTarget = {
          position: mapping.origin.clone().addScaledVector(mapping.normal, distance),
          up: mapping.vAxis.clone(),
          look: mapping.origin.clone(),
        };
        controls.target.copy(mapping.origin);
      }
      if (cameraTarget) {
        camera.position.lerp(cameraTarget.position, SKETCH_CAMERA_LERP);
        camera.up.lerp(cameraTarget.up, SKETCH_CAMERA_LERP).normalize();
        if (camera.position.distanceTo(cameraTarget.position) < 0.05) {
          camera.position.copy(cameraTarget.position);
          camera.up.copy(cameraTarget.up);
          cameraTarget = null;
        }
        camera.lookAt(controls.target);
      }
    };

    // --- Edge picking (F4) -------------------------------------------------
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: EDGE_PICK_THRESHOLD_MM };

    const ndcOf = (event: PointerEvent): THREE.Vector2 => {
      const rect = overlayCanvas.getBoundingClientRect();
      return new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
    };

    const raycastEdge = (event: PointerEvent): THREE.Line | null => {
      const group = edgeGroupRef.current;
      if (!group?.visible) return null;
      raycaster.setFromCamera(ndcOf(event), camera);
      const hits = raycaster.intersectObjects(group.children, false);
      const line = hits[0]?.object;
      return line instanceof THREE.Line ? line : null;
    };

    const highlightHover = (hovered: THREE.Line | null): void => {
      const group = edgeGroupRef.current;
      const picked = edgePickRef.current?.pickedKeys;
      if (!group) return;
      for (const child of group.children) {
        if (!(child instanceof THREE.Line)) continue;
        const key = typeof child.userData.key === 'string' ? child.userData.key : '';
        const material = child.material as THREE.LineBasicMaterial;
        const isPicked = picked?.has(key) ?? false;
        material.color.setHex(
          child === hovered ? EDGE_HOVER_COLOR : isPicked ? EDGE_PICKED_COLOR : EDGE_COLOR
        );
      }
    };

    // --- Pointer → sketch plane -------------------------------------------
    const pointerToPlane = (event: PointerEvent): { point: Vec2; pxPerMm: number } | null => {
      const mode = sketchModeRef.current;
      if (!mode || width === 0 || height === 0) return null;
      const rect = overlayCanvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      const mapping = mappingFromBasis(mode.basis);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(mapping.normal, mapping.origin);
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return null;
      return {
        point: worldToPlane(mapping, hit),
        pxPerMm: pixelsPerMm(mapping, camera, width, height),
      };
    };

    // Raycast a body mesh → its BodyId (from the `Body:<id>` name).
    const raycastBody = (event: PointerEvent): BodyId | null => {
      const group = bodyGroupRef.current;
      if (!group) return null;
      raycaster.setFromCamera(ndcOf(event), camera);
      const hits = raycaster.intersectObjects(group.children, false);
      const name = hits[0]?.object.name ?? '';
      return name.startsWith('Body:') ? (name.slice('Body:'.length) as BodyId) : null;
    };

    // Raycast a body mesh → its BodyId AND the world hit point (face picking).
    const raycastBodyHit = (
      event: PointerEvent
    ): { bodyId: BodyId; point: [number, number, number] } | null => {
      const group = bodyGroupRef.current;
      if (!group) return null;
      raycaster.setFromCamera(ndcOf(event), camera);
      const hit = raycaster.intersectObjects(group.children, false)[0];
      const name = hit?.object.name ?? '';
      if (!hit || !name.startsWith('Body:')) return null;
      return {
        bodyId: name.slice('Body:'.length) as BodyId,
        point: [hit.point.x, hit.point.y, hit.point.z],
      };
    };

    // Measure pick (F10): nearest vertex/midpoint snap, else body surface.
    const MEASURE_SNAP_PX = 14;
    const measurePick = (event: PointerEvent): MeasurePick | null => {
      const rect = overlayCanvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const v = new THREE.Vector3();
      let best: MeasureCandidate | null = null;
      let bestDist = MEASURE_SNAP_PX;
      for (const cand of measureCandidatesRef.current) {
        v.set(cand.world[0], cand.world[1], cand.world[2]).project(camera);
        if (v.z > 1) continue; // behind the camera
        const sx = ((v.x + 1) / 2) * rect.width;
        const sy = ((1 - v.y) / 2) * rect.height;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestDist) {
          bestDist = d;
          best = cand;
        }
      }
      if (best) return { world: best.world, circleRadius: best.circleRadius };
      raycaster.setFromCamera(ndcOf(event), camera);
      const hits = raycaster.intersectObjects(bodyGroupRef.current?.children ?? [], false);
      const hit = hits[0]?.point;
      return hit ? { world: [hit.x, hit.y, hit.z], circleRadius: null } : null;
    };

    // Distinguish a body-select click from an orbit drag (F8 tree sync).
    let downX = 0;
    let downY = 0;
    let idleDown = false;
    let sketchDragging = false;

    const onPointerMove = (event: PointerEvent): void => {
      if (edgePickRef.current) {
        highlightHover(raycastEdge(event));
        return;
      }
      const hit = pointerToPlane(event);
      if (!hit) return;
      if (sketchDragging) {
        sketchModeRef.current?.onPointDrag?.(hit.point);
        return;
      }
      sketchModeRef.current?.onCursor(hit.point, hit.pxPerMm);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      const pick = edgePickRef.current;
      if (pick) {
        const line = raycastEdge(event);
        const fp = line?.userData.fingerprint as EdgeFingerprint | undefined;
        if (fp) pick.onPick(fp);
        return;
      }
      const meas = measureRef.current;
      if (meas) {
        const measured = measurePick(event);
        if (measured) meas.onPick(measured);
        return;
      }
      const mode = sketchModeRef.current;
      if (mode) {
        const hit = pointerToPlane(event);
        if (!hit) return;
        // Change tool: grab a nearby point to drag; otherwise a normal click.
        if (mode.onPointGrab?.(hit.point, hit.pxPerMm)) {
          sketchDragging = true;
          overlayCanvas.setPointerCapture(event.pointerId);
          return;
        }
        mode.onClickPoint(hit.point, hit.pxPerMm);
        return;
      }
      // Idle: arm a possible body-select, resolved on pointerup if not dragged.
      downX = event.clientX;
      downY = event.clientY;
      idleDown = true;
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (sketchDragging) {
        sketchDragging = false;
        if (overlayCanvas.hasPointerCapture(event.pointerId)) {
          overlayCanvas.releasePointerCapture(event.pointerId);
        }
        sketchModeRef.current?.onPointDrop?.();
        return;
      }
      if (!idleDown) return;
      idleDown = false;
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 4) return; // a drag
      const face = facePickRef.current;
      if (face) {
        const hit = raycastBodyHit(event);
        if (hit) face.onPick(hit.bodyId, hit.point);
        return;
      }
      onSelectBodyRef.current?.(raycastBody(event));
    };
    overlayCanvas.addEventListener('pointermove', onPointerMove);
    overlayCanvas.addEventListener('pointerdown', onPointerDown);
    overlayCanvas.addEventListener('pointerup', onPointerUp);

    let animationFrame = 0;
    const animate = (): void => {
      updateSketchCamera();
      controls.update();
      renderer.render(scene, camera);
      const mode = sketchModeRef.current;
      if (ctx) {
        const dpr = window.devicePixelRatio;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (mode) {
          drawSketchOverlay(ctx, camera, width, height, mode.overlay);
        } else {
          ctx.clearRect(0, 0, width, height);
        }
        ctx.restore();
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onViewKey);
      overlayCanvas.removeEventListener('pointermove', onPointerMove);
      overlayCanvas.removeEventListener('pointerdown', onPointerDown);
      overlayCanvas.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      disposeSceneObjects(scene);
      bodyGroupRef.current = null;
      edgeGroupRef.current = null;
      sketchGroupRef.current = null;
      highlightGroupRef.current = null;
      originPlanesRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const bodyGroup = bodyGroupRef.current;
    if (!bodyGroup) return;
    disposeSceneObjects(bodyGroup);
    bodyGroup.clear();
    for (const mesh of bodies) {
      const style = bodyStyles?.get(mesh.bodyId);
      if (style && !style.visible) continue; // F8 hidden body
      bodyGroup.add(createBodyMesh(mesh, style?.color, style?.selected ?? false));
    }
  }, [bodies, bodyStyles]);

  // Apply origin plane visibility (F8 Origin section).
  useEffect(() => {
    const planes = originPlanesRef.current;
    if (!planes || !planeVisibility) return;
    planes.XY.visible = planeVisibility.XY;
    planes.XZ.visible = planeVisibility.XZ;
    planes.YZ.visible = planeVisibility.YZ;
  }, [planeVisibility]);

  // Rebuild the pickable edge lines when edge-pick state changes (F4).
  useEffect(() => {
    const group = edgeGroupRef.current;
    if (!group) return;
    disposeSceneObjects(group);
    group.clear();
    group.visible = edgePick !== null;
    if (!edgePick) return;
    for (const body of edgePick.bodyEdges) {
      for (const edge of body.edges) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(edge.polyline, 3));
        const key = edgeFingerprintKey(edge.fingerprint);
        const material = new THREE.LineBasicMaterial({
          color: edgePick.pickedKeys.has(key) ? EDGE_PICKED_COLOR : EDGE_COLOR,
        });
        const line = new THREE.Line(geometry, material);
        line.userData = { key, fingerprint: edge.fingerprint };
        group.add(line);
      }
    }
  }, [edgePick]);

  // Rebuild committed-sketch preview lines (visible sketches not being edited).
  useEffect(() => {
    const group = sketchGroupRef.current;
    if (!group) return;
    disposeSceneObjects(group);
    group.clear();
    for (const preview of sketchPreviews ?? []) {
      const mapping = mappingFromBasis(preview.basis);
      for (const polyline of preview.polylines) {
        if (polyline.length < 2) continue;
        const positions = new Float32Array(polyline.length * 3);
        polyline.forEach((p, i) => {
          const world = planeToWorld(mapping, p);
          positions[i * 3] = world.x;
          positions[i * 3 + 1] = world.y;
          positions[i * 3 + 2] = world.z;
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({ color: SKETCH_PREVIEW_COLOR });
        group.add(new THREE.Line(geometry, material));
      }
    }
  }, [sketchPreviews]);

  // Rebuild the op-selection highlight (F3): selected profile loops + axis,
  // drawn amber over everything while an Extrude/Revolve dialog is open.
  useEffect(() => {
    const group = highlightGroupRef.current;
    if (!group) return;
    disposeSceneObjects(group);
    group.clear();
    if (!opHighlight) return;
    const mapping = planeMapping(opHighlight.plane);
    const addPolyline = (polyline: readonly Vec2[], close: boolean): void => {
      if (polyline.length < 2) return;
      const pts = close ? [...polyline, polyline[0]] : [...polyline];
      const positions = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => {
        const world = planeToWorld(mapping, p ?? { x: 0, y: 0 });
        positions[i * 3] = world.x;
        positions[i * 3 + 1] = world.y;
        positions[i * 3 + 2] = world.z;
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: OP_HIGHLIGHT_COLOR,
        depthTest: false, // read even through a solid body
      });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 999;
      group.add(line);
    };
    for (const loop of opHighlight.loops) addPolyline(loop, true);
    if (opHighlight.axis) addPolyline(opHighlight.axis, false);
  }, [opHighlight]);

  return (
    <div className={styles.container}>
      <div ref={hostRef} className={styles.canvasHost}>
        <canvas ref={overlayRef} className={styles.overlayCanvas} data-testid="sketch-overlay" />
      </div>
      {viewBarOpen && (
        <div className={styles.overlay}>
          <button
            type="button"
            className={styles.button}
            title="Z"
            onClick={() => fitRequestRef.current?.()}
          >
            {zoomToFitLabel}
          </button>
          {viewLabels &&
            VIEW_IDS.map((id) => {
              const label = viewLabels[id];
              if (label === undefined) return null;
              return (
                <button
                  key={id}
                  type="button"
                  className={styles.button}
                  title={VIEW_KEY_HINT[id]}
                  data-testid={`view-${id}`}
                  onClick={() => viewRequestRef.current?.(id)}
                >
                  {label}
                </button>
              );
            })}
          {projectionLabels && (
            <button
              type="button"
              className={styles.button}
              title="O"
              data-testid="projection-toggle"
              onClick={() => projectionRequestRef.current?.()}
            >
              {projectionLabels[projectionMode]}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
