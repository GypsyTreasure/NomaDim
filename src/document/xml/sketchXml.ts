import { XMLParser } from 'fast-xml-parser';
import {
  err,
  ok,
  ImportError,
  type EntityId,
  type PointId,
  type Result,
  type SketchId,
} from '../../core';
import type { Sketch, SketchEntity, SketchPlaneRef, SketchPoint } from '../sketch/types';
import { validateSketch } from '../sketch/validate';
import { writeXml, type XmlElement } from './xmlWriter';
import { asRaw, asRawArray, boolAttr, numAttr, strAttr, type Raw } from './xmlRaw';

/**
 * Sketch element codec (MASTER_DOCUMENT F7 shape). Deterministic: points
 * and entities are sorted by id, attribute order is fixed per element. The
 * enclosing `<nomadim>` document codec (schema version checks, migrations)
 * arrives with M6 save/load — this codec is what makes M2's "connectivity
 * survives XML round-trip" acceptance testable now and is reused there.
 */

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : 1);

function entityToXml(entity: SketchEntity): XmlElement {
  switch (entity.type) {
    case 'line':
      return {
        tag: 'line',
        attrs: {
          id: entity.id,
          start: entity.start,
          end: entity.end,
          construction: entity.construction,
        },
      };
    case 'circle':
      return {
        tag: 'circle',
        attrs: {
          id: entity.id,
          center: entity.center,
          r: entity.r,
          construction: entity.construction,
        },
      };
    case 'arc':
      return {
        tag: 'arc',
        attrs: {
          id: entity.id,
          center: entity.center,
          start: entity.start,
          end: entity.end,
          ccw: entity.ccw,
          construction: entity.construction,
        },
      };
    case 'point':
      return {
        tag: 'point',
        attrs: { id: entity.id, ref: entity.point, construction: entity.construction },
      };
    default: {
      const exhaustive: never = entity;
      return exhaustive;
    }
  }
}

export function sketchToXml(sketch: Sketch): string {
  const children: XmlElement[] = [];

  if (sketch.plane.kind === 'face') {
    const snap = sketch.plane.planeSnapshot;
    children.push({ tag: 'faceRef', attrs: { fingerprint: sketch.plane.fingerprint } });
    children.push({
      tag: 'planeSnapshot',
      attrs: {
        ox: snap.origin[0],
        oy: snap.origin[1],
        oz: snap.origin[2],
        xx: snap.xAxis[0],
        xy: snap.xAxis[1],
        xz: snap.xAxis[2],
        yx: snap.yAxis[0],
        yy: snap.yAxis[1],
        yz: snap.yAxis[2],
      },
    });
  }

  children.push({
    tag: 'points',
    children: [...sketch.points].sort(byId).map((p) => ({
      tag: 'point',
      attrs: { id: p.id, x: p.x, y: p.y },
    })),
  });
  children.push({
    tag: 'entities',
    children: [...sketch.entities].sort(byId).map(entityToXml),
  });
  // Reserved v2 slots (C6) — serialized even while empty so files are forward-shaped.
  children.push({ tag: 'constraints' });
  children.push({ tag: 'dimensions' });

  return writeXml({
    tag: 'sketch',
    attrs: {
      id: sketch.id,
      plane: sketch.plane.kind === 'origin' ? sketch.plane.plane : 'face',
      name: sketch.name,
    },
    children,
  });
}

// ---------------------------------------------------------------------------
// Parsing

function fail(detail: string): Result<never, ImportError> {
  return err(new ImportError('Invalid sketch XML', undefined, detail));
}

function parsePlane(raw: Raw, planeAttr: string): Result<SketchPlaneRef, ImportError> {
  if (planeAttr === 'XY' || planeAttr === 'XZ' || planeAttr === 'YZ') {
    return ok({ kind: 'origin', plane: planeAttr });
  }
  if (planeAttr !== 'face') return fail(`unknown plane "${planeAttr}"`);

  const faceRef = asRaw(raw.faceRef);
  const snap = asRaw(raw.planeSnapshot);
  const fingerprint = faceRef ? strAttr(faceRef, 'fingerprint') : null;
  if (!faceRef || !snap || fingerprint === null) {
    return fail('face-based sketch missing faceRef/planeSnapshot');
  }
  const nums = ['ox', 'oy', 'oz', 'xx', 'xy', 'xz', 'yx', 'yy', 'yz'].map((n) => numAttr(snap, n));
  if (nums.some((n) => n === null)) return fail('planeSnapshot has invalid components');
  const [ox, oy, oz, xx, xy, xz, yx, yy, yz] = nums as number[];
  return ok({
    kind: 'face',
    fingerprint,
    planeSnapshot: {
      origin: [ox ?? 0, oy ?? 0, oz ?? 0],
      xAxis: [xx ?? 0, xy ?? 0, xz ?? 0],
      yAxis: [yx ?? 0, yy ?? 0, yz ?? 0],
    },
  });
}

function parseEntities(entitiesRaw: Raw): Result<SketchEntity[], ImportError> {
  const entities: SketchEntity[] = [];

  for (const raw of asRawArray(entitiesRaw.line)) {
    const id = strAttr(raw, 'id');
    const start = strAttr(raw, 'start');
    const end = strAttr(raw, 'end');
    const construction = boolAttr(raw, 'construction');
    if (id === null || start === null || end === null || construction === null) {
      return fail('malformed <line>');
    }
    entities.push({
      type: 'line',
      id: id as EntityId,
      start: start as PointId,
      end: end as PointId,
      construction,
    });
  }
  for (const raw of asRawArray(entitiesRaw.circle)) {
    const id = strAttr(raw, 'id');
    const center = strAttr(raw, 'center');
    const r = numAttr(raw, 'r');
    const construction = boolAttr(raw, 'construction');
    if (id === null || center === null || r === null || construction === null) {
      return fail('malformed <circle>');
    }
    entities.push({
      type: 'circle',
      id: id as EntityId,
      center: center as PointId,
      r,
      construction,
    });
  }
  for (const raw of asRawArray(entitiesRaw.arc)) {
    const id = strAttr(raw, 'id');
    const center = strAttr(raw, 'center');
    const start = strAttr(raw, 'start');
    const end = strAttr(raw, 'end');
    const ccw = boolAttr(raw, 'ccw');
    const construction = boolAttr(raw, 'construction');
    if (
      id === null ||
      center === null ||
      start === null ||
      end === null ||
      ccw === null ||
      construction === null
    ) {
      return fail('malformed <arc>');
    }
    entities.push({
      type: 'arc',
      id: id as EntityId,
      center: center as PointId,
      start: start as PointId,
      end: end as PointId,
      ccw,
      construction,
    });
  }
  for (const raw of asRawArray(entitiesRaw.point)) {
    const id = strAttr(raw, 'id');
    const ref = strAttr(raw, 'ref');
    const construction = boolAttr(raw, 'construction');
    if (id === null || ref === null || construction === null) {
      return fail('malformed entity <point>');
    }
    entities.push({ type: 'point', id: id as EntityId, point: ref as PointId, construction });
  }

  entities.sort(byId);
  return ok(entities);
}

export function sketchFromXml(xml: string): Result<Sketch, ImportError> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    parseTagValue: false,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : 'unparseable XML');
  }

  const root = asRaw(asRaw(parsed)?.sketch);
  if (!root) return fail('missing <sketch> root');

  const id = strAttr(root, 'id');
  const name = strAttr(root, 'name');
  const planeAttr = strAttr(root, 'plane');
  if (id === null || name === null || planeAttr === null) {
    return fail('<sketch> missing id/plane/name');
  }

  const plane = parsePlane(root, planeAttr);
  if (!plane.ok) return plane;

  const pointsContainer = asRaw(root.points);
  const entitiesContainer = asRaw(root.entities);
  if (root.points === undefined || root.entities === undefined) {
    return fail('missing <points> or <entities>');
  }

  const points: SketchPoint[] = [];
  for (const raw of asRawArray(pointsContainer?.point)) {
    const pointId = strAttr(raw, 'id');
    const x = numAttr(raw, 'x');
    const y = numAttr(raw, 'y');
    if (pointId === null || x === null || y === null) return fail('malformed pool <point>');
    points.push({ id: pointId as PointId, x, y });
  }
  points.sort(byId);

  const entities = entitiesContainer ? parseEntities(entitiesContainer) : ok([]);
  if (!entities.ok) return entities;

  const sketch: Sketch = {
    id: id as SketchId,
    name,
    plane: plane.value,
    points,
    entities: entities.value,
    constraints: [],
    dimensions: [],
  };

  const valid = validateSketch(sketch);
  if (!valid.ok) {
    return err(new ImportError('Invalid sketch XML', undefined, valid.error.message));
  }
  return ok(sketch);
}
