import type * as THREE from 'three';
import type { Vec2 } from '../core';
import {
  sampleCurve,
  type Curve,
  type DimensionRender,
  type EvaluatedEntity,
  type Guide,
  type SnapCandidate,
} from '../sketch';
import {
  mappingFromBasis,
  planeToScreen,
  pixelsPerMm,
  type SketchPlaneBasis,
} from './planeMapping';

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
const COLOR_DIMENSION = '#1a6b5a'; // teal — reference-dimension annotations
const COLOR_DIMENSION_HALO = '#f4f5f6'; // light halo so labels read over geometry

export interface SketchOverlayState {
  /** Pre-evaluated curves (app evaluates once per document change — never per frame). */
  readonly entities: readonly EvaluatedEntity[];
  /** Pool point positions (sketch-local mm). */
  readonly points: readonly Vec2[];
  readonly basis: SketchPlaneBasis;
  readonly previewCurves: readonly Curve[];
  readonly snap: SnapCandidate | null;
  readonly guides: readonly Guide[];
  readonly selectedEntityIds: ReadonlySet<string>;
  /** Reference dimensions (associative, solver-free) as plane-space geometry + label. */
  readonly dimensions: readonly DimensionRender[];
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
  const mapping = mappingFromBasis(state.basis);
  const pxPerMm = pixelsPerMm(mapping, camera, width, height);
  const chordTolMm = pxPerMm > 0 ? 0.5 / pxPerMm : 0.1;
  const toScreen = (p: Vec2): Vec2 => planeToScreen(mapping, p, camera, width, height);
  const project = (curve: Curve): Vec2[] => sampleCurve(curve, chordTolMm).map(toScreen);

  // Committed entities. Axis (centerline) lines get a distinct dash-dot in
  // teal so they read as reference axes, not drawn geometry.
  for (const entity of state.entities) {
    const selected = state.selectedEntityIds.has(entity.entityId);
    // Fatter strokes so sketch geometry reads clearly, incl. on a phone (#4).
    ctx.lineWidth = selected ? 4 : 2.75;
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

  // Sketch origin (0,0) — the base dimensioning datum, always marked.
  const origin = toScreen({ x: 0, y: 0 });
  ctx.strokeStyle = COLOR_AXIS;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(origin.x - 7, origin.y);
  ctx.lineTo(origin.x + 7, origin.y);
  ctx.moveTo(origin.x, origin.y - 7);
  ctx.lineTo(origin.x, origin.y + 7);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, 3.5, 0, 2 * Math.PI);
  ctx.stroke();

  // Reference dimensions (associative, solver-free): extension/dimension lines
  // plus a haloed measured-value label. Everything arrives plane-space and is
  // projected through the live camera like the rest of the overlay.
  ctx.strokeStyle = COLOR_DIMENSION;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '12px Barlow, system-ui, sans-serif';
  for (const dim of state.dimensions) {
    ctx.beginPath();
    for (const [a, b] of dim.segments) {
      const sa = toScreen(a);
      const sb = toScreen(b);
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
    ctx.stroke();
    const anchor = toScreen(dim.labelAnchor);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR_DIMENSION_HALO;
    ctx.strokeText(dim.label, anchor.x, anchor.y);
    ctx.fillStyle = COLOR_DIMENSION;
    ctx.fillText(dim.label, anchor.x, anchor.y);
    ctx.strokeStyle = COLOR_DIMENSION;
    ctx.lineWidth = 1;
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';

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
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]);
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
    if (kind === 'origin') {
      ctx.rect(s.x - 6, s.y - 6, 12, 12);
      ctx.moveTo(s.x - 6, s.y);
      ctx.lineTo(s.x + 6, s.y);
      ctx.moveTo(s.x, s.y - 6);
      ctx.lineTo(s.x, s.y + 6);
    } else if (kind === 'endpoint') {
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
