import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Vec2 } from '../core';
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
  zoomToFit,
} from './scene';
import { planeMapping, pixelsPerMm, worldToPlane, type OriginPlaneId } from './planeMapping';
import { drawSketchOverlay, type SketchOverlayState } from './sketchOverlay';
import styles from './Viewport.module.css';

const BACKGROUND_COLOR = 0xfaf7f0; // var(--color-canvas-bg), Three.js needs a numeric literal here.
const CAMERA_FOV_DEG = 50;
const CAMERA_INITIAL_POSITION = new THREE.Vector3(280, -280, 220); // Z-up isometric-ish
const SKETCH_CAMERA_LERP = 0.18;

export interface SketchModeProps {
  readonly plane: OriginPlaneId;
  readonly overlay: SketchOverlayState;
  /** Cursor moved over the sketch plane (sketch-local mm + current px/mm scale, R11). */
  readonly onCursor: (point: Vec2, pxPerMm: number) => void;
  /** Primary click on the sketch plane. */
  readonly onClickPoint: (point: Vec2, pxPerMm: number) => void;
}

/** Active while a Fillet/Chamfer dialog is picking edges (F4). */
export interface EdgePickProps {
  readonly bodyEdges: readonly BodyEdges[];
  readonly pickedKeys: ReadonlySet<string>;
  readonly onPick: (fingerprint: EdgeFingerprint) => void;
}

export interface ViewportProps {
  /** Label text for the zoom-to-fit button (translated by the caller — §3 viewport-scope). */
  zoomToFitLabel: string;
  bodies: MeshTransfer[];
  /** Non-null while a sketch is being edited; camera animates normal-to-plane. */
  sketchMode: SketchModeProps | null;
  /** Non-null while picking edges for a finishing op (F4). */
  edgePick?: EdgePickProps | null;
}

const EDGE_COLOR = 0x0d1b2a; // navy
const EDGE_PICKED_COLOR = 0x1a6b5a; // teal
const EDGE_HOVER_COLOR = 0x2fa78d; // bright teal
const EDGE_PICK_THRESHOLD_MM = 2;

/**
 * Owns the Three.js scene, camera/controls, picking, and the 2D sketch
 * overlay (ARCHITECTURE §3). No document mutation, no business rules —
 * sketch interactions surface as plane-space callbacks the app layer
 * interprets.
 */
export function Viewport({
  zoomToFitLabel,
  bodies,
  sketchMode,
  edgePick = null,
}: ViewportProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fitRequestRef = useRef<(() => void) | null>(null);
  const bodyGroupRef = useRef<THREE.Group | null>(null);
  const edgeGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  // Live props for the rAF loop (avoids rebuilding the loop on each render);
  // written post-commit in an effect, never during render.
  const sketchModeRef = useRef<SketchModeProps | null>(null);
  const edgePickRef = useRef<EdgePickProps | null>(null);
  useEffect(() => {
    sketchModeRef.current = sketchMode;
  }, [sketchMode]);
  useEffect(() => {
    edgePickRef.current = edgePick;
  }, [edgePick]);

  useEffect(() => {
    const host = hostRef.current;
    const overlayCanvas = overlayRef.current;
    if (!host || !overlayCanvas) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND_COLOR);

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, 10000);
    camera.up.set(0, 0, 1);
    camera.position.copy(CAMERA_INITIAL_POSITION);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
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
    const lighting = createLighting();
    const bodyGroup = new THREE.Group();
    bodyGroup.name = 'Bodies';
    bodyGroupRef.current = bodyGroup;
    const edgeGroup = new THREE.Group();
    edgeGroup.name = 'Edges';
    edgeGroup.visible = false;
    edgeGroupRef.current = edgeGroup;
    scene.add(
      grid,
      originPlanes.XY,
      originPlanes.XZ,
      originPlanes.YZ,
      lighting,
      bodyGroup,
      edgeGroup
    );

    let width = 0;
    let height = 0;
    const resize = (): void => {
      width = host.clientWidth;
      height = host.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      const dpr = window.devicePixelRatio;
      overlayCanvas.width = Math.round(width * dpr);
      overlayCanvas.height = Math.round(height * dpr);
      overlayCanvas.style.width = `${String(width)}px`;
      overlayCanvas.style.height = `${String(height)}px`;
    };

    fitRequestRef.current = () => {
      const box = new THREE.Box3().setFromObject(scene);
      zoomToFit({ camera, controlsTarget: controls.target, box });
      controls.update();
    };

    resize();
    fitRequestRef.current();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    // --- Sketch-mode camera animation state -------------------------------
    let animatedPlane: OriginPlaneId | null = null;
    let cameraTarget: { position: THREE.Vector3; up: THREE.Vector3 } | null = null;

    const updateSketchCamera = (): void => {
      const mode = sketchModeRef.current;
      // Orbit while free; lock rotation during sketch editing AND edge picking.
      controls.enableRotate = mode === null && edgePickRef.current === null;
      if (!mode) {
        animatedPlane = null;
        cameraTarget = null;
        return;
      }
      if (mode.plane !== animatedPlane) {
        animatedPlane = mode.plane;
        const mapping = planeMapping(mode.plane);
        const distance = Math.max(camera.position.length(), 120);
        cameraTarget = {
          position: mapping.normal.clone().multiplyScalar(distance),
          up: mapping.vAxis.clone(),
        };
        controls.target.set(0, 0, 0);
      }
      if (cameraTarget) {
        camera.position.lerp(cameraTarget.position, SKETCH_CAMERA_LERP);
        camera.up.lerp(cameraTarget.up, SKETCH_CAMERA_LERP).normalize();
        if (camera.position.distanceTo(cameraTarget.position) < 0.05) {
          camera.position.copy(cameraTarget.position);
          camera.up.copy(cameraTarget.up);
          cameraTarget = null;
        }
        camera.lookAt(0, 0, 0);
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
      const mapping = planeMapping(mode.plane);
      const plane = new THREE.Plane(mapping.normal, 0);
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return null;
      return {
        point: worldToPlane(mapping, hit),
        pxPerMm: pixelsPerMm(mapping, camera, width, height),
      };
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (edgePickRef.current) {
        highlightHover(raycastEdge(event));
        return;
      }
      const hit = pointerToPlane(event);
      if (hit) sketchModeRef.current?.onCursor(hit.point, hit.pxPerMm);
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
      const hit = pointerToPlane(event);
      if (hit) sketchModeRef.current?.onClickPoint(hit.point, hit.pxPerMm);
    };
    overlayCanvas.addEventListener('pointermove', onPointerMove);
    overlayCanvas.addEventListener('pointerdown', onPointerDown);

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
      overlayCanvas.removeEventListener('pointermove', onPointerMove);
      overlayCanvas.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      disposeSceneObjects(scene);
      bodyGroupRef.current = null;
      edgeGroupRef.current = null;
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
      bodyGroup.add(createBodyMesh(mesh));
    }
  }, [bodies]);

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

  return (
    <div className={styles.container}>
      <div ref={hostRef} className={styles.canvasHost}>
        <canvas ref={overlayRef} className={styles.overlayCanvas} data-testid="sketch-overlay" />
      </div>
      <div className={styles.overlay}>
        <button type="button" className={styles.button} onClick={() => fitRequestRef.current?.()}>
          {zoomToFitLabel}
        </button>
      </div>
    </div>
  );
}
