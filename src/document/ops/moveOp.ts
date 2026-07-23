import { err, ok, ImportError, ValidationError, type BodyId, type OpId } from '../../core';
import { boolAttr, numAttr, strAttr } from '../xml/xmlRaw';
import type { OpDefinition } from './definition';
import type { MoveOp } from './types';

/** Move a body in place (#3): rigid transform applied to the body itself. */
export const moveOpDefinition: OpDefinition<MoveOp> = {
  type: 'Move',
  labelKey: 'op.move',
  xmlTag: 'move',

  validate(op) {
    if ([...op.translate, ...op.rotate].some((n) => !Number.isFinite(n))) {
      return err(new ValidationError(`Move "${op.id}" has a non-finite value`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'move',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
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
    const body = strAttr(raw, 'body');
    const tx = numAttr(raw, 'tx');
    const ty = numAttr(raw, 'ty');
    const tz = numAttr(raw, 'tz');
    if (
      id === null ||
      name === null ||
      suppressed === null ||
      body === null ||
      tx === null ||
      ty === null ||
      tz === null
    ) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <move>'));
    }
    const rx = numAttr(raw, 'rx') ?? 0;
    const ry = numAttr(raw, 'ry') ?? 0;
    const rz = numAttr(raw, 'rz') ?? 0;
    return ok({
      type: 'Move',
      id: id as OpId,
      name,
      suppressed,
      bodyId: body as BodyId,
      translate: [tx, ty, tz],
      rotate: [rx, ry, rz],
    });
  },

  dependencies(op) {
    return {
      producesBodies: [],
      consumesBodies: [op.bodyId],
      consumesSketch: null,
      producesSketch: null,
    };
  },
};
