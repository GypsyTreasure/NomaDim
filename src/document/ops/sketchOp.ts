import { err, ok, ImportError, ValidationError, type OpId, type SketchId } from '../../core';
import { boolAttr, strAttr } from '../xml/xmlRaw';
import type { OpDefinition } from './definition';
import type { SketchOp } from './types';

/**
 * Sketch as a timeline op. Geometry lives in `DocumentState.sketches`
 * (serialized by the sketch codec); this op is the sketch's position in
 * history — suppression hides its profiles from downstream consumers, and
 * sketch edits dirty the timeline from here.
 */
export const sketchOpDefinition: OpDefinition<SketchOp> = {
  type: 'Sketch',
  labelKey: 'op.sketch',
  xmlTag: 'sketchOp',

  validate(op, doc) {
    if (!doc.sketches.some((s) => s.id === op.sketchId)) {
      return err(new ValidationError(`Sketch op "${op.id}" references missing sketch`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'sketchOp',
      attrs: { id: op.id, name: op.name, suppressed: op.suppressed, sketch: op.sketchId },
    };
  },

  fromXml(raw) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const suppressed = boolAttr(raw, 'suppressed');
    const sketchId = strAttr(raw, 'sketch');
    if (id === null || name === null || suppressed === null || sketchId === null) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <sketchOp>'));
    }
    return ok({
      type: 'Sketch',
      id: id as OpId,
      name,
      suppressed,
      sketchId: sketchId as SketchId,
    });
  },

  dependencies(op) {
    return {
      producesBodies: [],
      consumesBodies: [],
      consumesSketch: op.sketchId,
      producesSketch: op.sketchId,
    };
  },
};
