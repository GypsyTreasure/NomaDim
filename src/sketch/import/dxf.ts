import { vec2, type Vec2 } from '../../core';
import { type ImportPrimitive, type ImportResult } from './types';

/**
 * Minimal DXF (ASCII) → neutral primitives (ADR-0076). Group-code parser over
 * the ENTITIES section; supports LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE,
 * ARC, POINT, and SPLINE (its fit or control points as a polyline). DXF is
 * Y-up (CAD), so no flip. Units are taken as millimetres. Unsupported entity
 * types are skipped with a warning.
 */

interface Pair {
  readonly code: number;
  readonly value: string;
}

/** Splits DXF text into (group code, value) pairs. */
function toPairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt((lines[i] ?? '').trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: (lines[i + 1] ?? '').trim() });
  }
  return pairs;
}

interface Entity {
  readonly type: string;
  /** All group codes for the entity, in order (repeats kept — polyline verts). */
  readonly codes: readonly Pair[];
}

/** Groups the ENTITIES-section pairs into entities (split on code 0). */
function entitiesOf(pairs: readonly Pair[]): Entity[] {
  let inEntities = false;
  const entities: Entity[] = [];
  let current: { type: string; codes: Pair[] } | null = null;
  for (const pair of pairs) {
    if (pair.code === 2 && !inEntities) {
      if (pair.value === 'ENTITIES') inEntities = true;
      continue;
    }
    if (!inEntities) continue;
    if (pair.code === 0) {
      if (current) entities.push(current);
      if (pair.value === 'ENDSEC') {
        current = null;
        break;
      }
      current = { type: pair.value, codes: [] };
    } else if (current) {
      current.codes.push(pair);
    }
  }
  if (current) entities.push(current);
  return entities;
}

const first = (codes: readonly Pair[], code: number): number | undefined => {
  const p = codes.find((c) => c.code === code);
  return p ? Number.parseFloat(p.value) : undefined;
};

/** LWPOLYLINE / POLYLINE vertices from paired 10/20 codes, in order. */
function vertices(codes: readonly Pair[]): Vec2[] {
  const pts: Vec2[] = [];
  let x: number | null = null;
  for (const c of codes) {
    if (c.code === 10) x = Number.parseFloat(c.value);
    else if (c.code === 20 && x !== null) {
      pts.push(vec2(x, Number.parseFloat(c.value)));
      x = null;
    }
  }
  return pts;
}

function entityToPrimitives(entity: Entity): ImportPrimitive[] {
  const c = entity.codes;
  switch (entity.type) {
    case 'LINE': {
      const x1 = first(c, 10) ?? 0;
      const y1 = first(c, 20) ?? 0;
      const x2 = first(c, 11) ?? 0;
      const y2 = first(c, 21) ?? 0;
      return [{ kind: 'line', a: vec2(x1, y1), b: vec2(x2, y2) }];
    }
    case 'CIRCLE':
      return [
        {
          kind: 'circle',
          center: vec2(first(c, 10) ?? 0, first(c, 20) ?? 0),
          r: first(c, 40) ?? 0,
        },
      ];
    case 'ARC': {
      const center = vec2(first(c, 10) ?? 0, first(c, 20) ?? 0);
      const r = first(c, 40) ?? 0;
      const a0 = ((first(c, 50) ?? 0) * Math.PI) / 180;
      const a1 = ((first(c, 51) ?? 0) * Math.PI) / 180;
      return [
        {
          kind: 'arc',
          center,
          start: vec2(center.x + r * Math.cos(a0), center.y + r * Math.sin(a0)),
          end: vec2(center.x + r * Math.cos(a1), center.y + r * Math.sin(a1)),
          ccw: true, // DXF arcs run counter-clockwise from start to end angle
        },
      ];
    }
    case 'POINT': {
      // A lone point → a degenerate 1-point polyline (rendered as its vertex,
      // still a snap target).
      return [
        { kind: 'polyline', points: [vec2(first(c, 10) ?? 0, first(c, 20) ?? 0)], closed: false },
      ];
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const pts = vertices(c);
      const closed = ((first(c, 70) ?? 0) & 1) === 1;
      return pts.length >= 2 ? [{ kind: 'polyline', points: pts, closed }] : [];
    }
    case 'SPLINE': {
      // Prefer fit points (11/21); fall back to control points (10/20).
      const fit: Vec2[] = [];
      let fx: number | null = null;
      for (const p of c) {
        if (p.code === 11) fx = Number.parseFloat(p.value);
        else if (p.code === 21 && fx !== null) {
          fit.push(vec2(fx, Number.parseFloat(p.value)));
          fx = null;
        }
      }
      const pts = fit.length >= 2 ? fit : vertices(c);
      const closed = ((first(c, 70) ?? 0) & 1) === 1;
      return pts.length >= 2 ? [{ kind: 'polyline', points: pts, closed }] : [];
    }
    default:
      return [];
  }
}

export function parseDxf(text: string): ImportResult {
  const entities = entitiesOf(toPairs(text));
  const primitives: ImportPrimitive[] = [];
  const skipped = new Set<string>();
  for (const entity of entities) {
    const prims = entityToPrimitives(entity);
    if (prims.length === 0 && !['ENDSEC', 'SEQEND', 'VERTEX'].includes(entity.type)) {
      skipped.add(entity.type);
    }
    primitives.push(...prims);
  }
  const warnings: string[] = [];
  if (skipped.size > 0)
    warnings.push(`Skipped unsupported DXF entities: ${[...skipped].join(', ')}.`);
  if (primitives.length === 0) warnings.push('No supported entities found in the DXF.');
  return { primitives, warnings };
}
