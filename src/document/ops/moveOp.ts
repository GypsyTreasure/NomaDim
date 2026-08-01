import { err, ok, ImportError, ValidationError, type OpId } from '../../core';
import { boolAttr, numAttr, strAttr } from '../xml/xmlRaw';
import { joinBodyIds, parseBodyIds } from './extrudeOp';
import type { OpDefinition } from './definition';
import type { MoveOp } from './types';

/** Move bodies in place (#3): one rigid transform applied to each selected body. */
export const moveOpDefinition: OpDefinition<MoveOp> = {
  type: 'Move',
  labelKey: 'op.move',
  xmlTag: 'move',

  validate(op) {
    if (op.bodyIds.length === 0) {
      return err(new ValidationError(`Move "${op.id}" selects no bodies`));
    }
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
        body: joinBodyIds(op.bodyIds),
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
      bodyIds: parseBodyIds(body),
      translate: [tx, ty, tz],
      rotate: [rx, ry, rz],
    });
  },

  dependencies(op) {
    return {
      producesBodies: [],
      consumesBodies: [...op.bodyIds],
      consumesSketch: null,
      producesSketch: null,
    };
  },
};
