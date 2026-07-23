import { err, ok, ImportError, ValidationError, type BodyId, type OpId } from '../../core';
import { boolAttr, strAttr } from '../xml/xmlRaw';
import type { OpDefinition } from './definition';
import type { ImportOp } from './types';

/**
 * Imported base body (roadmap P1, ADR-0062): a parentless root body whose solid
 * is a base64 BREP payload parsed from a STEP file. The payload lives in the
 * `brep` attribute so the document is self-contained (no external file). Base64
 * is XML-attribute-safe (no `<`, `>`, `&`, quotes).
 */
export const importOpDefinition: OpDefinition<ImportOp> = {
  type: 'Import',
  labelKey: 'op.import',
  xmlTag: 'import',

  validate(op) {
    if (op.brepBase64.length === 0) {
      return err(new ValidationError(`Import "${op.id}" has no geometry`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'import',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
        format: op.format,
        sourceName: op.sourceName,
        body: op.bodyId,
        brep: op.brepBase64,
      },
    };
  },

  fromXml(raw) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const suppressed = boolAttr(raw, 'suppressed');
    const sourceName = strAttr(raw, 'sourceName');
    const body = strAttr(raw, 'body');
    const brep = strAttr(raw, 'brep');
    if (
      id === null ||
      name === null ||
      suppressed === null ||
      sourceName === null ||
      body === null ||
      brep === null
    ) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <import>'));
    }
    return ok({
      type: 'Import',
      id: id as OpId,
      name,
      suppressed,
      format: 'step',
      sourceName,
      brepBase64: brep,
      bodyId: body as BodyId,
    });
  },

  dependencies(op) {
    return {
      producesBodies: [op.bodyId],
      consumesBodies: [],
      consumesSketch: null,
      producesSketch: null,
    };
  },
};
