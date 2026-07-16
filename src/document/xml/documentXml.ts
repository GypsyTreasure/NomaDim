import { XMLParser } from 'fast-xml-parser';
import { err, ok, ImportError, type BodyId, type Result, type SketchId } from '../../core';
import type { DocumentState } from '../model';
import type { BodyMeta } from '../bodies/types';
import type { SketchMeta } from '../sketch/meta';
import type { Sketch } from '../sketch/types';
import { writeXml, type XmlElement } from './xmlWriter';
import { asRaw, asRawArray, boolAttr, strAttr } from './xmlRaw';
import { sketchElement, sketchFromRaw } from './sketchXml';
import { timelineElement, timelineFromRaw } from './timelineXml';

/**
 * Whole-document codec (MASTER_DOCUMENT F7, ARCHITECTURE §11): the enclosing
 * `<nomadim>` wrapper around the per-element codecs — sketches (incl.
 * face-plane snapshots + axis flags), the full timeline (all OpTypes via the
 * registry), the rollback marker, and body/sketch display metadata. Save =
 * serialize; Load = validate → build DocumentState → full regen. Schema
 * versioned; a NEWER minor is rejected (ADR-0007 — no silent forward data
 * loss), an older one is accepted (migrations would live here).
 */

export const SCHEMA_VERSION = '1.0';
const SCHEMA_MAJOR = 1;
const SCHEMA_MINOR = 0;

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : 1);

function bodyMetaElement(meta: BodyMeta): XmlElement {
  return {
    tag: 'body',
    attrs: { id: meta.id, name: meta.name, color: meta.color, visible: meta.visible },
  };
}

function sketchMetaElement(meta: SketchMeta): XmlElement {
  return { tag: 'sketch', attrs: { id: meta.id, visible: meta.visible } };
}

export function documentToXml(state: DocumentState): string {
  return writeXml({
    tag: 'nomadim',
    attrs: { version: SCHEMA_VERSION, units: 'mm' },
    children: [
      { tag: 'sketches', children: [...state.sketches].sort(byId).map(sketchElement) },
      timelineElement({ ops: state.ops, rollbackIndex: state.rollbackIndex }),
      { tag: 'bodies', children: [...state.bodyMeta].sort(byId).map(bodyMetaElement) },
      { tag: 'sketchMeta', children: [...state.sketchMeta].sort(byId).map(sketchMetaElement) },
    ],
  });
}

function fail(detail: string): Result<never, ImportError> {
  return err(new ImportError('Invalid document XML', undefined, detail));
}

/** Rejects a file whose schema is newer than this build (ADR-0007). */
function versionOk(version: string): boolean {
  const parts = version.split('.').map((p) => Number(p));
  const [major, minor] = parts;
  if (parts.length !== 2 || major === undefined || minor === undefined) return false;
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false;
  if (major > SCHEMA_MAJOR) return false;
  if (major === SCHEMA_MAJOR && minor > SCHEMA_MINOR) return false;
  return true;
}

export function documentFromXml(xml: string): Result<DocumentState, ImportError> {
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

  const root = asRaw(asRaw(parsed)?.nomadim);
  if (!root) return fail('missing <nomadim> root');

  const version = strAttr(root, 'version');
  if (version === null) return fail('<nomadim> missing version');
  if (!versionOk(version)) {
    return fail(`schema version ${version} is newer than supported ${SCHEMA_VERSION}`);
  }

  const sketches: Sketch[] = [];
  for (const raw of asRawArray(asRaw(root.sketches)?.sketch)) {
    const result = sketchFromRaw(raw);
    if (!result.ok) return result;
    sketches.push(result.value);
  }

  const timelineRaw = asRaw(root.timeline);
  if (!timelineRaw) return fail('missing <timeline>');
  const timeline = timelineFromRaw(timelineRaw);
  if (!timeline.ok) return timeline;

  const bodyMeta: BodyMeta[] = [];
  for (const raw of asRawArray(asRaw(root.bodies)?.body)) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const color = strAttr(raw, 'color');
    const visible = boolAttr(raw, 'visible');
    if (id === null || name === null || color === null || visible === null) {
      return fail('malformed <body>');
    }
    bodyMeta.push({ id: id as BodyId, name, color, visible });
  }

  const sketchMeta: SketchMeta[] = [];
  for (const raw of asRawArray(asRaw(root.sketchMeta)?.sketch)) {
    const id = strAttr(raw, 'id');
    const visible = boolAttr(raw, 'visible');
    if (id === null || visible === null) return fail('malformed sketchMeta <sketch>');
    sketchMeta.push({ id: id as SketchId, visible });
  }

  return ok({
    sketches,
    ops: timeline.value.ops,
    rollbackIndex: timeline.value.rollbackIndex,
    bodyMeta,
    sketchMeta,
  });
}
