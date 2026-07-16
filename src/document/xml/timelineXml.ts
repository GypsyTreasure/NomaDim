import { XMLParser } from 'fast-xml-parser';
import { err, ok, ImportError, type Result } from '../../core';
import { OP_DEFINITIONS } from '../ops/registry';
import type { TimelineOp } from '../ops/types';
import { writeXml, type XmlElement } from './xmlWriter';
import { asRaw, asRawArray, numAttr, type Raw } from './xmlRaw';

/**
 * Timeline codec (ARCHITECTURE §7/§11, R10): serialize/parse the ordered op
 * list by iterating the op registry — zero per-op switches here, every
 * OpType's shape comes from its `OpDefinition.toXml`/`fromXml`. Order is
 * timeline-significant, so each element carries an explicit `index`; parsing
 * regroups by tag (fast-xml-parser loses document order) and re-sorts on it.
 * The enclosing `<nomadim>` document codec (versioning) lands at M6.
 */

export interface TimelineData {
  readonly ops: readonly TimelineOp[];
  readonly rollbackIndex: number;
}

/** Prepends the ordering index onto an op element's attributes. */
function withIndex(element: XmlElement, index: number): XmlElement {
  return { ...element, attrs: { index, ...(element.attrs ?? {}) } };
}

/** The `<timeline>` element tree — reused by the document codec (M6). */
export function timelineElement(data: TimelineData): XmlElement {
  const children = data.ops.map((op, i) => withIndex(OP_DEFINITIONS[op.type].toXml(op), i));
  return { tag: 'timeline', attrs: { rollback: data.rollbackIndex }, children };
}

export function timelineToXml(data: TimelineData): string {
  return writeXml(timelineElement(data));
}

function fail(detail: string): Result<never, ImportError> {
  return err(new ImportError('Invalid timeline XML', undefined, detail));
}

/** Parses one already-extracted `<timeline>` Raw object — reused by the document codec (M6). */
export function timelineFromRaw(root: Raw): Result<TimelineData, ImportError> {
  const rollback = numAttr(root, 'rollback');
  if (rollback === null || !Number.isInteger(rollback) || rollback < 0) {
    return fail('<timeline> missing valid rollback');
  }

  // Iterate the registry (R10): each definition owns its tag + parser.
  const indexed: { index: number; op: TimelineOp }[] = [];
  for (const def of Object.values(OP_DEFINITIONS)) {
    for (const raw of asRawArray(root[def.xmlTag])) {
      const index = numAttr(raw, 'index');
      if (index === null) return fail(`<${def.xmlTag}> missing index`);
      const result = def.fromXml(raw);
      if (!result.ok) return result;
      indexed.push({ index, op: result.value });
    }
  }

  indexed.sort((a, b) => a.index - b.index);
  const ops = indexed.map((entry) => entry.op);

  if (rollback > ops.length) return fail('rollback index beyond op count');
  return ok({ ops, rollbackIndex: rollback });
}

export function timelineFromXml(xml: string): Result<TimelineData, ImportError> {
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
  const root = asRaw(asRaw(parsed)?.timeline);
  if (!root) return fail('missing <timeline> root');
  return timelineFromRaw(root);
}
