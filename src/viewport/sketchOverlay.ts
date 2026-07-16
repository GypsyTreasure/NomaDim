import type * as THREE from 'three';
import type { Vec2 } from '../core';
import {
  sampleCurve,
  type Curve,
  type EvaluatedEntity,
  type Guide,
  type SnapCandidate,
} from '../sketch';
import { planeMapping, planeToScreen, pixelsPerMm, type OriginPlaneId } from './planeMapping';

/**
 * Sketch canvas overlay rendering (ARCHITECTURE §3: viewport/ draws, the
 * snap engine computes). Everything arrives sketch-local; curves are
 * sampled and projected through the live camera so the overlay stays
 * correct under pan/zoom/orbit.
 *
 * Colors are literal constants mirroring `app/ui-tokens/tokens.css` — the
 * 2D canvas API cannot read CSS custom properties (same exception as
 * Three.js materials; stylelint's no-hardcoded-color governs stylesheets).
 */

const COLOR_ENTITY = '#0d1b2a'; // navy
const COLOR_CONSTRUCTION = '#8a94a0';
const COLOR_AXIS = '#1a6b5a'; // teal — centerline (axis) lines
const COLOR_SELECTED = '#1a6b5a'; // teal
const COLOR_PREVIEW = '#1a6b5a';
const COLOR_GUIDE = '#4fae63';
const COLOR_SNAP = '#e0554f';
const COLOR_POINT = '#0d1b2a';

export interface SketchOverlayState {
  /** Pre-evaluated curves (app evaluates once per document change — never per frame). */
  readonly entities: readonly EvaluatedEntity[];
  /** Pool point positions (sketch-local mm). */
  readonly points: readonly Vec2[];
  readonly plane: OriginPlaneId;
  readonly previewCurves: readonly Curve[];
  readonly snap: SnapCandidate | null;
  readonly guides: readonly Guide[];
  readonly selectedEntityIds: ReadonlySet<string>;
}

function strokePolyline(ctx: CanvasRenderingContext2D, points: readonly Vec2[]): void {
  if (points.length < 2) return;
  ctx.beginPath();
  const first = points[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    if (p) ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

export function drawSketchOverlay(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  width: number,
  height: number,
  state: SketchOverlayState
): void {
  ctx.clearRect(0, 0, width, height);
  const mapping = planeMapping(state.plane);
  const pxPerMm = pixelsPerMm(mapping, camera, width, height);
  const chordTolMm = pxPerMm > 0 ? 0.5 / pxPerMm : 0.1;
  const toScreen = (p: Vec2): Vec2 => planeToScreen(mapping, p, camera, width, height);
  const project = (curve: Curve): Vec2[] => sampleCurve(curve, chordTolMm).map(toScreen);

  // Committed entities. Axis (centerline) lines get a distinct dash-dot in
  // teal so they read as reference axes, not drawn geometry.
  for (const entity of state.entities) {
    const selected = state.selectedEntityIds.has(entity.entityId);
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.strokeStyle = selected
      ? COLOR_SELECTED
      : entity.axis
        ? COLOR_AXIS
        : entity.construction
          ? COLOR_CONSTRUCTION
          : COLOR_ENTITY;
    ctx.setLineDash(entity.axis ? [10, 3, 2, 3] : entity.construction ? [6, 4] : []);
    const screen = project(entity.curve);
    if (entity.curve.kind === 'circle') screen.push(screen[0] ?? { x: 0, y: 0 });
    strokePolyline(ctx, screen);
  }
  ctx.setLineDash([]);

  // Pool points.
  ctx.fillStyle = COLOR_POINT;
  for (const point of state.points) {
    const s = toScreen(point);
    ctx.fillRect(s.x - 2.5, s.y - 2.5, 5, 5);
  }

  // Inference guides — dashed, extended far beyond the viewport.
  ctx.strokeStyle = COLOR_GUIDE;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const guide of state.guides) {
    const a = toScreen({
      x: guide.through.x - guide.direction.x * 1e4,
      y: guide.through.y - guide.direction.y * 1e4,
    });
    const b = toScreen({
      x: guide.through.x + guide.direction.x * 1e4,
      y: guide.through.y + guide.direction.y * 1e4,
    });
    strokePolyline(ctx, [a, b]);
  }

  // Tool preview.
  ctx.strokeStyle = COLOR_PREVIEW;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  for (const curve of state.previewCurves) {
    const screen = project(curve);
    if (curve.kind === 'circle') screen.push(screen[0] ?? { x: 0, y: 0 });
    strokePolyline(ctx, screen);
  }
  ctx.setLineDash([]);

  // Snap glyph.
  if (state.snap) {
    const s = toScreen(state.snap.point);
    ctx.strokeStyle = COLOR_SNAP;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const kind = state.snap.kind;
    if (kind === 'endpoint') {
      ctx.rect(s.x - 5, s.y - 5, 10, 10);
    } else if (kind === 'intersection') {
      ctx.moveTo(s.x - 5, s.y - 5);
      ctx.lineTo(s.x + 5, s.y + 5);
      ctx.moveTo(s.x - 5, s.y + 5);
      ctx.lineTo(s.x + 5, s.y - 5);
    } else if (kind === 'midpoint' || kind === 'center' || kind === 'quadrant') {
      ctx.moveTo(s.x, s.y - 6);
      ctx.lineTo(s.x + 6, s.y);
      ctx.lineTo(s.x, s.y + 6);
      ctx.lineTo(s.x - 6, s.y);
      ctx.closePath();
    } else {
      // on-entity, grid, and every guide kind share the circle glyph.
      ctx.arc(s.x, s.y, 5, 0, 2 * Math.PI);
    }
    ctx.stroke();
  }
}
