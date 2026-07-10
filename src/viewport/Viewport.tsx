import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createGrid, createOriginPlanes, disposeSceneObjects, zoomToFit } from './scene';
import styles from './Viewport.module.css';

const BACKGROUND_COLOR = 0xfaf7f0; // var(--color-canvas-bg), Three.js needs a numeric literal here.
const CAMERA_FOV_DEG = 50;
const CAMERA_INITIAL_POSITION = new THREE.Vector3(300, 250, 300);

export interface ViewportProps {
  /** Label text for the zoom-to-fit button. Translated by the caller —
   * viewport/ must not import app/i18n (ARCHITECTURE §3 viewport-scope). */
  zoomToFitLabel: string;
}

/**
 * Mounts the Three.js scene: grid, origin planes, orbit controls,
 * zoom-to-fit. All scene mutation stays inside this layer (ARCHITECTURE §3)
 * — nothing here dispatches commands or touches the document.
 */
export function Viewport({ zoomToFitLabel }: ViewportProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRequestRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND_COLOR);

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
    scene.add(grid, originPlanes.XY, originPlanes.XZ, originPlanes.YZ);

    const fittableBox = new THREE.Box3().setFromObject(grid);

    const resize = (): void => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    fitRequestRef.current = () => {
      zoomToFit({ camera, controlsTarget: controls.target, box: fittableBox });
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
    };
  }, []);

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
