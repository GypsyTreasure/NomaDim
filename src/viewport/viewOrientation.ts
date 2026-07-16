/**
 * Standard CAD view orientations (F11), world Z-up (Fusion convention). Each
 * gives the unit direction FROM the target TO the camera, plus the camera up
 * vector; the viewport places the camera at `target + dir · distance`. Pure
 * data — unit-tested without Three.js.
 */

export type ViewId = 'home' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface ViewOrientation {
  /** Unit direction from the target to the camera. */
  readonly dir: readonly [number, number, number];
  /** Camera up vector. */
  readonly up: readonly [number, number, number];
}

const ISO = Math.SQRT1_2 * 0.8; // matches the initial isometric-ish framing
const HOME_LEN = Math.hypot(ISO, ISO, 0.8);

export const VIEW_ORIENTATIONS: Record<ViewId, ViewOrientation> = {
  // Isometric home (normalized (1,-1,0.8)/…), Z-up.
  home: { dir: [ISO / HOME_LEN, -ISO / HOME_LEN, 0.8 / HOME_LEN], up: [0, 0, 1] },
  front: { dir: [0, -1, 0], up: [0, 0, 1] },
  back: { dir: [0, 1, 0], up: [0, 0, 1] },
  right: { dir: [1, 0, 0], up: [0, 0, 1] },
  left: { dir: [-1, 0, 0], up: [0, 0, 1] },
  top: { dir: [0, 0, 1], up: [0, 1, 0] },
  bottom: { dir: [0, 0, -1], up: [0, 1, 0] },
};

export function viewOrientation(id: ViewId): ViewOrientation {
  return VIEW_ORIENTATIONS[id];
}

export const VIEW_IDS: readonly ViewId[] = [
  'home',
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
];
