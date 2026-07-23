import { err, ok, ImportError, ValidationError, type BodyId, type OpId } from '../../core';
import { boolAttr, numAttr, strAttr } from '../xml/xmlRaw';
import type { OpDefinition } from './definition';
import type { CopyBodyOp } from './types';

/** Copy/Paste a whole body (MASTER_DOCUMENT F9): parametric + positional copy. */
export const copyBodyOpDefinition: OpDefinition<CopyBodyOp> = {
  type: 'CopyBody',
  labelKey: 'op.copyBody',
  xmlTag: 'copyBody',

  validate(op) {
    if (op.sourceBodyId === op.bodyId) {
      return err(new ValidationError(`CopyBody "${op.id}" cannot copy onto itself`));
    }
    if (op.translate.some((n) => !Number.isFinite(n))) {
      return err(new ValidationError(`CopyBody "${op.id}" has a non-finite translation`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'copyBody',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
        source: op.sourceBodyId,
        body: op.bodyId,
        tx: op.translate[0],
        ty: op.translate[1],
        tz: op.translate[2],
        rx: op.rotate[0],
        ry: op.rotate[1],
        rz: op.rotate[2],
      },
    };
  },

  fromXml(raw) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const suppressed = boolAttr(raw, 'suppressed');
    const source = strAttr(raw, 'source');
    const body = strAttr(raw, 'body');
    const tx = numAttr(raw, 'tx');
    const ty = numAttr(raw, 'ty');
    const tz = numAttr(raw, 'tz');
    if (
      id === null ||
      name === null ||
      suppressed === null ||
      source === null ||
      body === null ||
      tx === null ||
      ty === null ||
      tz === null
    ) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <copyBody>'));
    }
    // Rotation is optional for back-compat with pre-rotation documents.
    const rx = numAttr(raw, 'rx') ?? 0;
    const ry = numAttr(raw, 'ry') ?? 0;
    const rz = numAttr(raw, 'rz') ?? 0;
    return ok({
      type: 'CopyBody',
      id: id as OpId,
      name,
      suppressed,
      sourceBodyId: source as BodyId,
      translate: [tx, ty, tz],
      rotate: [rx, ry, rz],
      bodyId: body as BodyId,
    });
  },

  dependencies(op) {
    return {
      producesBodies: [op.bodyId],
      consumesBodies: [op.sourceBodyId],
      consumesSketch: null,
      producesSketch: null,
    };
  },
};
