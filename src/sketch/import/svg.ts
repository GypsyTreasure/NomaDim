import { XMLParser } from 'fast-xml-parser';
import { vec2, type Vec2 } from '../../core';
import { IMPORT_CURVE_SEGMENTS, type ImportPrimitive, type ImportResult } from './types';

/**
 * Minimal SVG → neutral primitives (ADR-0076). Supports the common vector-art
 * subset: line, rect, polyline, polygon, circle, ellipse, and path (M/L/H/V/C/
 * S/Q/T/A/Z). Béziers, elliptical arcs, and ellipses are sampled to polylines;
 * circles stay analytic. `transform` attributes are ignored (noted as a
 * warning). SVG Y is down → flipped about the viewBox/height so imported art is
 * upright in the (Y-up) sketch. 1 user unit = 1 mm.
 */

const SHAPE_TAGS = new Set(['line', 'rect', 'polyline', 'polygon', 'circle', 'ellipse', 'path']);

type Attrs = Record<string, string>;

function num(attrs: Attrs, name: string, fallback = 0): number {
  const v = Number.parseFloat(attrs[name] ?? '');
  return Number.isFinite(v) ? v : fallback;
}

/** Splits an SVG number list ("1,2 3-4" etc.) into floats. */
function numbers(text: string): number[] {
  const out: number[] = [];
  const re = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(Number.parseFloat(m[0]));
  return out;
}

function samplePoints(points: readonly Vec2[]): Vec2[] {
  return points.map((p) => vec2(p.x, p.y));
}

function cubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
    const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
    out.push(vec2(x, y));
  }
  return out;
}

function quad(p0: Vec2, p1: Vec2, p2: Vec2, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    out.push(
      vec2(
        u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
      )
    );
  }
  return out;
}

/** SVG endpoint-arc → sampled points (center parametrization, W3C impl notes). */
function svgArc(
  p0: Vec2,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Vec2,
  n: number
): Vec2[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [p1];
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * (rx * y1p)) / ry;
  const cyp = (co * -(ry * x1p)) / rx;
  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i += 1) {
    const th = theta1 + (delta * i) / n;
    const x = cosP * rx * Math.cos(th) - sinP * ry * Math.sin(th) + cx;
    const y = sinP * rx * Math.cos(th) + cosP * ry * Math.sin(th) + cy;
    out.push(vec2(x, y));
  }
  return out;
}

/** Parses a path `d` string into one or more polylines (subpaths). */
function parsePath(d: string): { points: Vec2[]; closed: boolean }[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const subpaths: { points: Vec2[]; closed: boolean }[] = [];
  let pts: Vec2[] = [];
  let cur = vec2(0, 0);
  let startPt = vec2(0, 0);
  let prevCubicCtrl: Vec2 | null = null;
  let prevQuadCtrl: Vec2 | null = null;
  let i = 0;
  let cmd = '';
  const readNum = (): number => Number.parseFloat(tokens[i++] ?? '0');
  const flush = (closed: boolean): void => {
    if (pts.length >= 2) subpaths.push({ points: pts, closed });
    pts = [];
  };
  while (i < tokens.length) {
    const tok = tokens[i] ?? '';
    if (/[a-zA-Z]/.test(tok)) {
      cmd = tok;
      i += 1;
      if (cmd === 'Z' || cmd === 'z') {
        pts.push(vec2(startPt.x, startPt.y));
        flush(true);
        cur = startPt;
        continue;
      }
    }
    const rel = cmd === cmd.toLowerCase();
    const base = rel ? cur : vec2(0, 0);
    const up = cmd.toUpperCase();
    if (up === 'M') {
      cur = vec2(base.x + readNum(), base.y + readNum());
      if (pts.length >= 2) flush(false);
      pts = [vec2(cur.x, cur.y)];
      startPt = cur;
      cmd = rel ? 'l' : 'L';
    } else if (up === 'L') {
      cur = vec2(base.x + readNum(), base.y + readNum());
      pts.push(vec2(cur.x, cur.y));
    } else if (up === 'H') {
      cur = vec2((rel ? cur.x : 0) + readNum(), cur.y);
      pts.push(vec2(cur.x, cur.y));
    } else if (up === 'V') {
      cur = vec2(cur.x, (rel ? cur.y : 0) + readNum());
      pts.push(vec2(cur.x, cur.y));
    } else if (up === 'C' || up === 'S') {
      let c1: Vec2;
      if (up === 'S') {
        c1 = prevCubicCtrl ? vec2(2 * cur.x - prevCubicCtrl.x, 2 * cur.y - prevCubicCtrl.y) : cur;
      } else {
        c1 = vec2(base.x + readNum(), base.y + readNum());
      }
      const c2 = vec2(base.x + readNum(), base.y + readNum());
      const end = vec2(base.x + readNum(), base.y + readNum());
      pts.push(...cubic(cur, c1, c2, end, IMPORT_CURVE_SEGMENTS));
      prevCubicCtrl = c2;
      prevQuadCtrl = null;
      cur = end;
    } else if (up === 'Q' || up === 'T') {
      let c: Vec2;
      if (up === 'T') {
        c = prevQuadCtrl ? vec2(2 * cur.x - prevQuadCtrl.x, 2 * cur.y - prevQuadCtrl.y) : cur;
      } else {
        c = vec2(base.x + readNum(), base.y + readNum());
      }
      const end = vec2(base.x + readNum(), base.y + readNum());
      pts.push(...quad(cur, c, end, IMPORT_CURVE_SEGMENTS));
      prevQuadCtrl = c;
      prevCubicCtrl = null;
      cur = end;
    } else if (up === 'A') {
      const rx = readNum();
      const ry = readNum();
      const rot = readNum();
      const large = readNum() !== 0;
      const sweep = readNum() !== 0;
      const end = vec2(base.x + readNum(), base.y + readNum());
      pts.push(...svgArc(cur, rx, ry, rot, large, sweep, end, IMPORT_CURVE_SEGMENTS));
      cur = end;
      prevCubicCtrl = null;
      prevQuadCtrl = null;
    } else {
      i += 1; // unknown token — skip defensively
    }
    if (up !== 'C' && up !== 'S') prevCubicCtrl = null;
    if (up !== 'Q' && up !== 'T') prevQuadCtrl = null;
  }
  flush(false);
  return subpaths;
}

function shapeToPrimitives(tag: string, attrs: Attrs): ImportPrimitive[] {
  switch (tag) {
    case 'line':
      return [
        {
          kind: 'line',
          a: vec2(num(attrs, 'x1'), num(attrs, 'y1')),
          b: vec2(num(attrs, 'x2'), num(attrs, 'y2')),
        },
      ];
    case 'rect': {
      const x = num(attrs, 'x');
      const y = num(attrs, 'y');
      const w = num(attrs, 'width');
      const h = num(attrs, 'height');
      return [
        {
          kind: 'polyline',
          closed: true,
          points: [vec2(x, y), vec2(x + w, y), vec2(x + w, y + h), vec2(x, y + h)],
        },
      ];
    }
    case 'circle':
      return [
        { kind: 'circle', center: vec2(num(attrs, 'cx'), num(attrs, 'cy')), r: num(attrs, 'r') },
      ];
    case 'ellipse': {
      const cx = num(attrs, 'cx');
      const cy = num(attrs, 'cy');
      const rx = num(attrs, 'rx');
      const ry = num(attrs, 'ry');
      const pts: Vec2[] = [];
      const n = IMPORT_CURVE_SEGMENTS * 2;
      for (let i = 0; i < n; i += 1) {
        const a = (2 * Math.PI * i) / n;
        pts.push(vec2(cx + rx * Math.cos(a), cy + ry * Math.sin(a)));
      }
      return [{ kind: 'polyline', points: pts, closed: true }];
    }
    case 'polyline':
    case 'polygon': {
      const nums = numbers(attrs.points ?? '');
      const pts: Vec2[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push(vec2(nums[i] ?? 0, nums[i + 1] ?? 0));
      return pts.length >= 2 ? [{ kind: 'polyline', points: pts, closed: tag === 'polygon' }] : [];
    }
    case 'path':
      return parsePath(attrs.d ?? '').map((sp) => ({
        kind: 'polyline' as const,
        points: samplePoints(sp.points),
        closed: sp.closed,
      }));
    default:
      return [];
  }
}

/** Recursively collects shape nodes from the parsed SVG tree. */
function collect(
  node: unknown,
  out: { tag: string; attrs: Attrs }[],
  hasTransform: { v: boolean }
): void {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out, hasTransform);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('@_')) continue;
    const items = Array.isArray(value) ? value : [value];
    if (SHAPE_TAGS.has(key)) {
      for (const item of items) {
        const attrs: Attrs = {};
        if (typeof item === 'object' && item !== null) {
          for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
            if (k.startsWith('@_')) attrs[k.slice(2)] = String(v);
          }
        }
        if (attrs.transform) hasTransform.v = true;
        out.push({ tag: key, attrs });
      }
    } else {
      for (const item of items) collect(item, out, hasTransform);
    }
  }
}

export function parseSvg(text: string): ImportResult {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed: unknown;
  try {
    parsed = parser.parse(text);
  } catch {
    return { primitives: [], warnings: ['Could not parse the SVG file.'] };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { primitives: [], warnings: ['Could not parse the SVG file.'] };
  }
  const root = (parsed as Record<string, unknown>).svg;
  if (root === undefined) return { primitives: [], warnings: ['No <svg> root element found.'] };

  // Y flip: keep art upright. Prefer viewBox height, else the height attribute.
  const rootAttrs: Attrs = {};
  if (typeof root === 'object' && root !== null) {
    for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
      if (k.startsWith('@_')) rootAttrs[k.slice(2)] = String(v);
    }
  }
  const viewBox = numbers(rootAttrs.viewBox ?? '');
  const flipY =
    viewBox.length === 4 ? (viewBox[1] ?? 0) + (viewBox[3] ?? 0) : num(rootAttrs, 'height', 0);

  const nodes: { tag: string; attrs: Attrs }[] = [];
  const hasTransform = { v: false };
  collect(root, nodes, hasTransform);

  const fy = (p: Vec2): Vec2 => vec2(p.x, flipY - p.y);
  const primitives: ImportPrimitive[] = [];
  for (const node of nodes) {
    for (const prim of shapeToPrimitives(node.tag, node.attrs)) {
      if (prim.kind === 'line') primitives.push({ kind: 'line', a: fy(prim.a), b: fy(prim.b) });
      else if (prim.kind === 'circle')
        primitives.push({ kind: 'circle', center: fy(prim.center), r: prim.r });
      else if (prim.kind === 'polyline')
        primitives.push({ kind: 'polyline', points: prim.points.map(fy), closed: prim.closed });
      else primitives.push(prim);
    }
  }

  const warnings: string[] = [];
  if (hasTransform.v) {
    warnings.push(
      'Some elements use transform attributes, which are ignored — positions may be off.'
    );
  }
  if (primitives.length === 0) warnings.push('No supported shapes found in the SVG.');
  return { primitives, warnings };
}
