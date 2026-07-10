import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshTransfer } from '../kernel';
import {
  createBodyMesh,
  createGrid,
  createLighting,
  createOriginPlanes,
  disposeSceneObjects,
  zoomToFit,
} from './scene';
import styles from './Viewport.module.css';

const BACKGROUND_COLOR = 0xfaf7f0; // var(--color-canvas-bg), Three.js needs a numeric literal here.
const CAMERA_FOV_DEG = 50;
const CAMERA_INITIAL_POSITION = new THREE.Vector3(300, 250, 300);

export interface ViewportProps {
  /** Label text for the zoom-to-fit button. Translated by the caller —
   * viewport/ must not import app/i18n (ARCHITECTURE §3 viewport-scope). */
  zoomToFitLabel: string;
  /** Tessellated bodies to render (from kernel/, R5 Transferable buffers). */
  bodies: MeshTransfer[];
}

/**
 * Mounts the Three.js scene: grid, origin planes, lighting, body meshes,
 * orbit controls, zoom-to-fit. All scene mutation stays inside this layer
 * (ARCHITECTURE §3) — nothing here dispatches commands or touches the
 * document; body meshes are supplied declaratively via the `bodies` prop.
 */
export function Viewport({ zoomToFitLabel, bodies }: ViewportProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRequestRef = useRef<(() => void) | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const bodyGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND_COLOR);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, 10000);
    camera.position.copy(CAMERA_INITIAL_POSITION);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    const grid = createGrid();
    const originPlanes = createOriginPlanes();
    const lighting = createLighting();
    const bodyGroup = new THREE.Group();
    bodyGroup.name = 'Bodies';
    bodyGroupRef.current = bodyGroup;
    scene.add(grid, originPlanes.XY, originPlanes.XZ, originPlanes.YZ, lighting, bodyGroup);

    const resize = (): void => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
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

    let animationFrame = 0;
    const animate = (): void => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      disposeSceneObjects(scene);
      sceneRef.current = null;
      bodyGroupRef.current = null;
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

  return (
    <div className={styles.container}>
      <div ref={hostRef} className={styles.canvasHost} />
      <div className={styles.overlay}>
        <button type="button" className={styles.button} onClick={() => fitRequestRef.current?.()}>
          {zoomToFitLabel}
        </button>
      </div>
    </div>
  );
}
