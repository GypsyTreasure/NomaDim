import { vec2, type Vec2 } from '../../core';
import { IMPORT_CURVE_SEGMENTS, type ImportPrimitive, type ImportResult } from './types';
import {
  bulgeArcPoints,
  compose,
  ellipsePoints,
  IDENTITY,
  transformPrimitive,
  type Affine,
} from './dxfGeometry';

/**
 * DXF (ASCII) → neutral primitives (ADR-0076). A group-code parser that
 * resolves BLOCK/INSERT placements — most real drawings keep their geometry in
 * blocks and only INSERT it, so this is what makes AutoCAD exports actually
 * import. Supports LINE, CIRCLE, ARC, POINT, LWPOLYLINE/POLYLINE (with bulge
 * arcs), ELLIPSE, SPLINE (fit/control points), and INSERT (translation, scale,
 * rotation, nesting, rectangular arrays). DXF is Y-up, units taken as mm.
 * Annotations (TEXT/MTEXT/DIMENSION/HATCH/…) are skipped with a warning.
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
  readonly codes: readonly Pair[];
}

/**
 * Raw entities (split on code 0) inside a named SECTION. The section-name pair
 * (`2 <section>`) is consumed by the trigger below, so every code-2 pair that
 * follows is genuine entity data (e.g. an INSERT's block name) and is kept.
 */
function entitiesInSection(pairs: readonly Pair[], section: string): Entity[] {
  const entities: Entity[] = [];
  let inSection = false;
  let current: { type: string; codes: Pair[] } | null = null;
  for (const pair of pairs) {
    if (!inSection) {
      if (pair.code === 2 && pair.value === section) inSection = true;
      continue;
    }
    if (pair.code === 0) {
      if (current) entities.push(current);
      current = null;
      if (pair.value === 'ENDSEC') break;
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

/** The entity's own layer (DXF group code 8), or '' if unset. */
const layerOf = (codes: readonly Pair[]): string => codes.find((c) => c.code === 8)?.value ?? '';

/**
 * AutoCAD layer inheritance: an entity on layer "0" (or blank) inside a block
 * takes the INSERT's layer; otherwise it keeps its own. At the top level the
 * inherited layer is '' so the entity's own layer wins.
 */
function effectiveLayer(own: string, inherited: string): string {
  if ((own === '' || own === '0') && inherited !== '') return inherited;
  return own;
}

interface Vert {
  readonly p: Vec2;
  readonly bulge: number;
}

/** LWPOLYLINE vertices with per-vertex bulges (group 42), in order. */
function lwVertices(codes: readonly Pair[]): Vert[] {
  const verts: { p: Vec2; bulge: number }[] = [];
  let x: number | null = null;
  for (const c of codes) {
    if (c.code === 10) x = Number.parseFloat(c.value);
    else if (c.code === 20 && x !== null) {
      verts.push({ p: vec2(x, Number.parseFloat(c.value)), bulge: 0 });
      x = null;
    } else if (c.code === 42 && verts.length > 0) {
      const last = verts[verts.length - 1];
      if (last) verts[verts.length - 1] = { p: last.p, bulge: Number.parseFloat(c.value) };
    }
  }
  return verts;
}

/** Expands a bulged vertex list into a flat polyline point list. */
function bulgeToPoints(verts: readonly Vert[], closed: boolean): Vec2[] {
  if (verts.length === 0) return [];
  const pts: Vec2[] = [];
  const firstVert = verts[0];
  if (firstVert) pts.push(firstVert.p);
  const segments = closed ? verts.length : verts.length - 1;
  for (let i = 0; i < segments; i += 1) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (!a || !b) continue;
    if (a.bulge !== 0) pts.push(...bulgeArcPoints(a.p, b.p, a.bulge, IMPORT_CURVE_SEGMENTS));
    else pts.push(b.p);
  }
  if (closed && pts.length > 1) pts.pop(); // drop the duplicated closing point
  return pts;
}

/** Converts a single (already de-INSERTed) entity to local-space primitives. */
function entityToPrimitives(entity: Entity, polyVerts?: readonly Vert[]): ImportPrimitive[] {
  const c = entity.codes;
  switch (entity.type) {
    case 'LINE':
      return [
        {
          kind: 'line',
          a: vec2(first(c, 10) ?? 0, first(c, 20) ?? 0),
          b: vec2(first(c, 11) ?? 0, first(c, 21) ?? 0),
        },
      ];
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
    case 'ELLIPSE': {
      const center = vec2(first(c, 10) ?? 0, first(c, 20) ?? 0);
      const major = vec2(first(c, 11) ?? 0, first(c, 21) ?? 0);
      const { points, closed } = ellipsePoints(
        center,
        major,
        first(c, 40) ?? 1,
        first(c, 41) ?? 0,
        first(c, 42) ?? 2 * Math.PI
      );
      return points.length >= 2 ? [{ kind: 'polyline', points, closed }] : [];
    }
    case 'POINT':
      return [
        { kind: 'polyline', points: [vec2(first(c, 10) ?? 0, first(c, 20) ?? 0)], closed: false },
      ];
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const closed = ((first(c, 70) ?? 0) & 1) === 1;
      const verts = polyVerts ?? lwVertices(c);
      const pts = bulgeToPoints(verts, closed);
      return pts.length >= 2 ? [{ kind: 'polyline', points: pts, closed }] : [];
    }
    case 'SPLINE': {
      const fit: Vec2[] = [];
      let fx: number | null = null;
      for (const p of c) {
        if (p.code === 11) fx = Number.parseFloat(p.value);
        else if (p.code === 21 && fx !== null) {
          fit.push(vec2(fx, Number.parseFloat(p.value)));
          fx = null;
        }
      }
      const pts = fit.length >= 2 ? fit : bulgeToPoints(lwVertices(c), false);
      const closed = ((first(c, 70) ?? 0) & 1) === 1;
      return pts.length >= 2 ? [{ kind: 'polyline', points: pts, closed }] : [];
    }
    default:
      return [];
  }
}

interface Block {
  readonly base: Vec2;
  readonly entities: readonly Entity[];
}

/** Parses the BLOCKS section into named block definitions. */
function parseBlocks(pairs: readonly Pair[]): Map<string, Block> {
  const blocks = new Map<string, Block>();
  const raw = entitiesInSection(pairs, 'BLOCKS');
  let name: string | null = null;
  let base = vec2(0, 0);
  let members: Entity[] = [];
  for (const entity of raw) {
    if (entity.type === 'BLOCK') {
      name = entity.codes.find((p) => p.code === 2)?.value ?? null;
      base = vec2(first(entity.codes, 10) ?? 0, first(entity.codes, 20) ?? 0);
      members = [];
    } else if (entity.type === 'ENDBLK') {
      if (name !== null) blocks.set(name, { base, entities: members });
      name = null;
    } else if (name !== null) {
      members.push(entity);
    }
  }
  return blocks;
}

/** The affine placement of an INSERT (before its block's base offset). */
function insertTransform(codes: readonly Pair[], base: Vec2, dx: number, dy: number): Affine {
  const rot = ((first(codes, 50) ?? 0) * Math.PI) / 180;
  const sx = first(codes, 41) ?? 1;
  const sy = first(codes, 42) ?? 1;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const ix = (first(codes, 10) ?? 0) + cos * dx - sin * dy;
  const iy = (first(codes, 20) ?? 0) + sin * dx + cos * dy;
  return { a, b, c, d, e: ix - (a * base.x + c * base.y), f: iy - (b * base.x + d * base.y) };
}

const MAX_INSERT_DEPTH = 24;

/** Resolves entities to world primitives, expanding INSERTs against `blocks`. */
function resolve(
  entities: readonly Entity[],
  xf: Affine,
  blocks: Map<string, Block>,
  depth: number,
  skipped: Set<string>,
  inheritedLayer: string
): ImportPrimitive[] {
  const out: ImportPrimitive[] = [];
  const stamp = (prim: ImportPrimitive, layer: string): ImportPrimitive =>
    transformPrimitive({ ...prim, layer }, xf);
  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i];
    if (!entity) continue;
    const eff = effectiveLayer(layerOf(entity.codes), inheritedLayer);

    // Old-style POLYLINE: absorb following VERTEX entities up to SEQEND.
    if (entity.type === 'POLYLINE') {
      const verts: Vert[] = [];
      let j = i + 1;
      for (; j < entities.length; j += 1) {
        const child = entities[j];
        if (!child || child.type === 'SEQEND') break;
        if (child.type === 'VERTEX') {
          verts.push({
            p: vec2(first(child.codes, 10) ?? 0, first(child.codes, 20) ?? 0),
            bulge: first(child.codes, 42) ?? 0,
          });
        }
      }
      i = j;
      for (const prim of entityToPrimitives(entity, verts)) out.push(stamp(prim, eff));
      continue;
    }

    if (entity.type === 'INSERT') {
      const name = entity.codes.find((p) => p.code === 2)?.value;
      const block = name !== undefined ? blocks.get(name) : undefined;
      if (!block || depth >= MAX_INSERT_DEPTH) {
        if (!block) skipped.add(`INSERT(${name ?? '?'})`);
        continue;
      }
      const cols = Math.max(1, Math.trunc(first(entity.codes, 70) ?? 1));
      const rows = Math.max(1, Math.trunc(first(entity.codes, 71) ?? 1));
      const colSp = first(entity.codes, 44) ?? 0;
      const rowSp = first(entity.codes, 45) ?? 0;
      for (let col = 0; col < cols; col += 1) {
        for (let row = 0; row < rows; row += 1) {
          const local = insertTransform(entity.codes, block.base, col * colSp, row * rowSp);
          // Block members on layer "0" inherit this INSERT's effective layer.
          out.push(...resolve(block.entities, compose(xf, local), blocks, depth + 1, skipped, eff));
        }
      }
      continue;
    }

    const prims = entityToPrimitives(entity);
    if (prims.length === 0) {
      if (!['SEQEND', 'VERTEX', 'ENDBLK', 'ATTRIB', 'ATTDEF'].includes(entity.type)) {
        skipped.add(entity.type);
      }
      continue;
    }
    for (const prim of prims) out.push(stamp(prim, eff));
  }
  return out;
}

export function parseDxf(text: string): ImportResult {
  const pairs = toPairs(text);
  const blocks = parseBlocks(pairs);
  const entities = entitiesInSection(pairs, 'ENTITIES');
  const skipped = new Set<string>();
  const primitives = resolve(entities, IDENTITY, blocks, 0, skipped, '');

  const warnings: string[] = [];
  if (skipped.size > 0) {
    warnings.push(`Skipped unsupported DXF entities: ${[...skipped].sort().join(', ')}.`);
  }
  if (primitives.length === 0) warnings.push('No supported entities found in the DXF.');
  return { primitives, warnings };
}
