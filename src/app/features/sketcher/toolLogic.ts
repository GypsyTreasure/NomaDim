import {
  add,
  angleOf,
  ccwSweep,
  distance,
  fromAngle,
  scale,
  sub,
  vec2,
  DEG_TO_RAD,
  type PointId,
  type Vec2,
} from '../../../core';
import type { Curve, SketchToolId } from '../../../sketch';
import type { GeometryPlan, PointSpec } from './geometryPlan';
import {
  arcIsCcw,
  circumcenter,
  directionBetween,
  lineEndFrom,
  polygonVertices,
  rectangleCorners,
} from './shapeMath';

/**
 * Sketch tool state machine (pure — the useSketcher hook feeds it clicks,
 * numeric commits, and cursor moves, and dispatches the resulting plans).
 * Rectangle/Polygon expand to line entities on commit (F2, Fusion-like);
 * chained Line keeps drawing from the last endpoint until Esc.
 */

export interface ToolState {
  readonly tool: SketchToolId;
  readonly constructionMode: boolean;
  /** Pending clicked points (tool-specific meaning). */
  readonly clicks: readonly PointSpec[];
  /** Line chain anchor + previous segment direction. */
  readonly chainAnchor: PointSpec | null;
  readonly prevDirection: Vec2 | null;
}

export function initialToolState(tool: SketchToolId): ToolState {
  return { tool, constructionMode: false, clicks: [], chainAnchor: null, prevDirection: null };
}

export interface ToolStep {
  readonly state: ToolState;
  /** When set, the hook builds a plan, invokes this, and dispatches the payload. */
  readonly commit: ((plan: GeometryPlan) => void) | null;
}

const noCommit = (state: ToolState): ToolStep => ({ state, commit: null });

function isLineLike(tool: SketchToolId): boolean {
  return tool === 'line' || tool === 'axis';
}

/** Line fields switch to the chained variant once a segment direction exists. */
export function isChained(state: ToolState): boolean {
  return isLineLike(state.tool) && state.prevDirection !== null;
}

export function toolEscape(state: ToolState): ToolState {
  return { ...state, clicks: [], chainAnchor: null, prevDirection: null };
}

/**
 * Nearest sketch point to `p` within `tolMm`, for the Change tool's grab
 * (F2 point drag). Pure — the closest point inside tolerance, or null.
 */
export function nearestPointId(
  points: readonly { readonly id: PointId; readonly x: number; readonly y: number }[],
  p: Vec2,
  tolMm: number
): PointId | null {
  let best: { id: PointId; d: number } | null = null;
  for (const pt of points) {
    const d = Math.hypot(pt.x - p.x, pt.y - p.y);
    if (d <= tolMm && (!best || d < best.d)) best = { id: pt.id, d };
  }
  return best?.id ?? null;
}

/**
 * Inject a typed start point as the tool's first anchor (F2 start-point
 * fields), equivalent to clicking there: sets the line chain anchor or the
 * first click when none exists yet, otherwise leaves the state untouched so a
 * placed point always wins over typed coordinates.
 */
export function withStartPoint(state: ToolState, p: Vec2): ToolState {
  const spec: PointSpec = { p };
  if (isLineLike(state.tool)) {
    return state.chainAnchor ? state : { ...state, chainAnchor: spec };
  }
  return state.clicks.length > 0 ? state : { ...state, clicks: [spec] };
}

export function setConstructionMode(state: ToolState, construction: boolean): ToolState {
  return { ...state, constructionMode: construction };
}

function commitLine(state: ToolState, anchor: PointSpec, end: Vec2): ToolStep {
  // An axis is always construction (reference geometry) and flagged as a
  // centerline so revolve can pick it and the overlay draws it distinctly.
  const axis = state.tool === 'axis';
  const construction = axis || state.constructionMode;
  return {
    state: {
      ...state,
      chainAnchor: { p: end },
      prevDirection: directionBetween(anchor.p, end),
    },
    commit: (plan) => {
      plan.addLine(anchor, { p: end }, construction, axis);
    },
  };
}

function rect2pStep(state: ToolState, c1: PointSpec, c2: Vec2): ToolStep {
  const corners = rectangleCorners(c1.p, c2);
  if (!corners) return noCommit(state);
  const construction = state.constructionMode;
  return {
    state: { ...state, clicks: [] },
    commit: (plan) => {
      const [a, b, c, d] = corners;
      plan.addLine(c1, { p: b }, construction);
      plan.addLine({ p: b }, { p: c }, construction);
      plan.addLine({ p: c }, { p: d }, construction);
      plan.addLine({ p: d }, { p: a }, construction);
    },
  };
}

function polygonStep(
  state: ToolState,
  center: Vec2,
  sides: number,
  diameter: number,
  startAngle: number
): ToolStep {
  const vertices = polygonVertices(center, sides, diameter, startAngle);
  if (!vertices) return noCommit(state);
  const construction = state.constructionMode;
  return {
    state: { ...state, clicks: [] },
    commit: (plan) => {
      for (let i = 0; i < vertices.length; i += 1) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        if (a && b) plan.addLine({ p: a }, { p: b }, construction);
      }
    },
  };
}

function arcCommit(
  state: ToolState,
  center: Vec2,
  start: PointSpec,
  end: Vec2,
  ccw: boolean
): ToolStep {
  const construction = state.constructionMode;
  return {
    state: { ...state, clicks: [] },
    commit: (plan) => {
      plan.addArc({ p: center }, start, { p: end }, ccw, construction);
    },
  };
}

/** Primary click on the sketch plane. */
export function toolClick(state: ToolState, spec: PointSpec): ToolStep {
  switch (state.tool) {
    case 'line':
    case 'axis': {
      if (!state.chainAnchor) {
        return noCommit({ ...state, chainAnchor: spec });
      }
      return commitLine(state, state.chainAnchor, spec.p);
    }
    case 'rectangle-2p': {
      const first = state.clicks[0];
      if (!first) return noCommit({ ...state, clicks: [spec] });
      return rect2pStep(state, first, spec.p);
    }
    case 'rectangle-center': {
      const center = state.clicks[0];
      if (!center) return noCommit({ ...state, clicks: [spec] });
      const half = { x: Math.abs(spec.p.x - center.p.x), y: Math.abs(spec.p.y - center.p.y) };
      return rect2pStep(state, { p: sub(center.p, half) }, add(center.p, half));
    }
    case 'circle-center-diameter': {
      const center = state.clicks[0];
      if (!center) return noCommit({ ...state, clicks: [spec] });
      const r = distance(center.p, spec.p);
      if (!(r > 0)) return noCommit(state);
      const construction = state.constructionMode;
      return {
        state: { ...state, clicks: [] },
        commit: (plan) => {
          plan.addCircle(center, r, construction);
        },
      };
    }
    case 'arc-center': {
      const [center, start] = state.clicks;
      if (!center) return noCommit({ ...state, clicks: [spec] });
      if (!start) return noCommit({ ...state, clicks: [center, spec] });
      const r = distance(center.p, start.p);
      const endAngle = angleOf(sub(spec.p, center.p));
      const end = add(center.p, scale(fromAngle(endAngle), r));
      const ccw = arcIsCcw(center.p, start.p, spec.p, end);
      return arcCommit(state, center.p, start, end, ccw);
    }
    case 'arc-3p': {
      const [p1, p2] = state.clicks;
      if (!p1) return noCommit({ ...state, clicks: [spec] });
      if (!p2) return noCommit({ ...state, clicks: [p1, spec] });
      const center = circumcenter(p1.p, spec.p, p2.p);
      if (!center) return noCommit(state);
      return arcCommit(state, center, p1, p2.p, arcIsCcw(center, p1.p, spec.p, p2.p));
    }
    case 'polygon': {
      const center = state.clicks[0];
      if (!center) return noCommit({ ...state, clicks: [spec] });
      // Click sets first vertex: diameter + start angle from it (sides typed or default 6).
      return polygonStep(
        state,
        center.p,
        6,
        2 * distance(center.p, spec.p),
        angleOf(sub(spec.p, center.p))
      );
    }
    case 'point': {
      const construction = state.constructionMode;
      return {
        state,
        commit: (plan) => {
          plan.addPointEntity(spec, construction);
        },
      };
    }
    case 'change':
      // Editing tool: clicks select/drag existing points (handled in the hook),
      // never place geometry.
      return noCommit(state);
    default: {
      const exhaustive: never = state.tool;
      return exhaustive;
    }
  }
}

/** Enter pressed with (possibly partial) typed values — typed overrides cursor (F2). */
export function toolEnter(
  state: ToolState,
  values: readonly (number | null)[],
  cursor: Vec2
): ToolStep {
  switch (state.tool) {
    case 'line':
    case 'axis': {
      // Keyboard-only start: the first chain anchor defaults to the origin (ADR-0012).
      const anchor = state.chainAnchor ?? { p: vec2(0, 0) };
      const end = lineEndFrom(
        anchor.p,
        cursor,
        values[0] ?? null,
        values[1] ?? null,
        values[2] ?? null,
        state.prevDirection
      );
      if (!end) return noCommit(state);
      return commitLine(state, anchor, end);
    }
    case 'rectangle-2p': {
      const first = state.clicks[0];
      if (!first) return noCommit(state);
      const w = values[0] ?? Math.abs(cursor.x - first.p.x);
      const h = values[1] ?? Math.abs(cursor.y - first.p.y);
      const sx = cursor.x >= first.p.x ? 1 : -1;
      const sy = cursor.y >= first.p.y ? 1 : -1;
      return rect2pStep(state, first, add(first.p, vec2(w * sx, h * sy)));
    }
    case 'rectangle-center': {
      const center = state.clicks[0];
      if (!center) return noCommit(state);
      const w = values[0] ?? 2 * Math.abs(cursor.x - center.p.x);
      const h = values[1] ?? 2 * Math.abs(cursor.y - center.p.y);
      if (!(w > 0 && h > 0)) return noCommit(state);
      return rect2pStep(
        state,
        { p: sub(center.p, vec2(w / 2, h / 2)) },
        add(center.p, vec2(w / 2, h / 2))
      );
    }
    case 'circle-center-diameter': {
      const center = state.clicks[0] ?? { p: vec2(0, 0) };
      const r =
        values[0] !== null && values[0] !== undefined ? values[0] / 2 : distance(center.p, cursor);
      if (!(r > 0)) return noCommit(state);
      const construction = state.constructionMode;
      return {
        state: { ...state, clicks: [] },
        commit: (plan) => {
          plan.addCircle(center, r, construction);
        },
      };
    }
    case 'arc-center': {
      const [center, start] = state.clicks;
      if (!center || !start) return noCommit(state);
      const r = values[0] ?? distance(center.p, start.p);
      if (!(r > 0)) return noCommit(state);
      const startDir = directionBetween(center.p, start.p) ?? vec2(1, 0);
      const startP = add(center.p, scale(startDir, r));
      const sweepDeg = values[1];
      let end: Vec2;
      let ccw: boolean;
      if (sweepDeg !== null && sweepDeg !== undefined && sweepDeg !== 0) {
        ccw = sweepDeg > 0;
        end = add(center.p, scale(fromAngle(angleOf(startDir) + sweepDeg * DEG_TO_RAD), r));
      } else {
        const endAngle = angleOf(sub(cursor, center.p));
        end = add(center.p, scale(fromAngle(endAngle), r));
        ccw = ccwSweep(angleOf(startDir), endAngle) <= Math.PI;
      }
      return arcCommit(state, center.p, { p: startP }, end, ccw);
    }
    case 'arc-3p': {
      const [p1, p2] = state.clicks;
      if (!p1 || !p2) return noCommit(state);
      const center = circumcenter(p1.p, cursor, p2.p);
      if (!center) return noCommit(state);
      return arcCommit(state, center, p1, p2.p, arcIsCcw(center, p1.p, cursor, p2.p));
    }
    case 'polygon': {
      const center = state.clicks[0] ?? { p: vec2(0, 0) };
      const sides = values[0] ?? 6;
      const diameter = values[1] ?? 2 * distance(center.p, cursor);
      const startAngle = distance(center.p, cursor) > 0 ? angleOf(sub(cursor, center.p)) : 0;
      return polygonStep(state, center.p, sides, diameter, startAngle);
    }
    case 'point': {
      // Keyboard placement: a typed start point (injected as clicks[0]) commits
      // a point at exact coordinates; otherwise Enter does nothing (click-only).
      const p = state.clicks[0];
      if (!p) return noCommit(state);
      const construction = state.constructionMode;
      return {
        state: { ...state, clicks: [] },
        commit: (plan) => {
          plan.addPointEntity(p, construction);
        },
      };
    }
    case 'change':
      return noCommit(state);
    default: {
      const exhaustive: never = state.tool;
      return exhaustive;
    }
  }
}

/** Ghost curves for the overlay (dashed preview while the tool is armed). */
export function toolPreview(
  state: ToolState,
  cursor: Vec2,
  values: readonly (number | null)[]
): Curve[] {
  switch (state.tool) {
    case 'line':
    case 'axis': {
      if (!state.chainAnchor) return [];
      const end =
        lineEndFrom(
          state.chainAnchor.p,
          cursor,
          values[0] ?? null,
          values[1] ?? null,
          values[2] ?? null,
          state.prevDirection
        ) ?? cursor;
      return [{ kind: 'segment', a: state.chainAnchor.p, b: end }];
    }
    case 'rectangle-2p':
    case 'rectangle-center': {
      const first = state.clicks[0];
      if (!first) return [];
      const corners =
        state.tool === 'rectangle-2p'
          ? rectangleCorners(first.p, cursor)
          : rectangleCorners(
              sub(first.p, vec2(Math.abs(cursor.x - first.p.x), Math.abs(cursor.y - first.p.y))),
              add(first.p, vec2(Math.abs(cursor.x - first.p.x), Math.abs(cursor.y - first.p.y)))
            );
      if (!corners) return [];
      const [a, b, c, d] = corners;
      return [
        { kind: 'segment', a, b },
        { kind: 'segment', a: b, b: c },
        { kind: 'segment', a: c, b: d },
        { kind: 'segment', a: d, b: a },
      ];
    }
    case 'circle-center-diameter': {
      const center = state.clicks[0];
      if (!center) return [];
      const r =
        values[0] !== null && values[0] !== undefined ? values[0] / 2 : distance(center.p, cursor);
      return r > 0 ? [{ kind: 'circle', center: center.p, r }] : [];
    }
    case 'arc-center': {
      const [center, start] = state.clicks;
      if (!center) return [];
      if (!start) return [{ kind: 'segment', a: center.p, b: cursor }];
      const r = distance(center.p, start.p);
      const a0 = angleOf(sub(start.p, center.p));
      const a1 = angleOf(sub(cursor, center.p));
      return [{ kind: 'arc', center: center.p, r, startAngle: a0, sweep: ccwSweep(a0, a1) }];
    }
    case 'arc-3p': {
      const [p1, p2] = state.clicks;
      if (!p1) return [];
      if (!p2) return [{ kind: 'segment', a: p1.p, b: cursor }];
      const center = circumcenter(p1.p, cursor, p2.p);
      if (!center) return [{ kind: 'segment', a: p1.p, b: p2.p }];
      const r = distance(center, p1.p);
      const ccw = arcIsCcw(center, p1.p, cursor, p2.p);
      const aStart = angleOf(sub(ccw ? p1.p : p2.p, center));
      const aEnd = angleOf(sub(ccw ? p2.p : p1.p, center));
      return [{ kind: 'arc', center, r, startAngle: aStart, sweep: ccwSweep(aStart, aEnd) }];
    }
    case 'polygon': {
      const center = state.clicks[0];
      if (!center) return [];
      const sides = values[0] ?? 6;
      const diameter = values[1] ?? 2 * distance(center.p, cursor);
      const startAngle = distance(center.p, cursor) > 0 ? angleOf(sub(cursor, center.p)) : 0;
      const vertices = polygonVertices(center.p, sides, diameter, startAngle);
      if (!vertices) return [];
      return vertices.map((a, i) => ({
        kind: 'segment' as const,
        a,
        b: vertices[(i + 1) % vertices.length] ?? a,
      }));
    }
    case 'point':
    case 'change':
      return [];
    default: {
      const exhaustive: never = state.tool;
      return exhaustive;
    }
  }
}
