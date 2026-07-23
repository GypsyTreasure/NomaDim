import { err, ok, ImportError, ValidationError, type BodyId, type OpId } from '../../core';
import { boolAttr, numAttr, strAttr } from '../xml/xmlRaw';
import type { OpDefinition } from './definition';
import type { ShellFace, ShellOp } from './types';

const FACES: readonly ShellFace[] = ['none', 'top', 'bottom', 'front', 'back', 'left', 'right'];

/** Hollow a body to a wall thickness, optionally opening one face (P2, ADR-0064). */
export const shellOpDefinition: OpDefinition<ShellOp> = {
  type: 'Shell',
  labelKey: 'op.shell',
  xmlTag: 'shell',

  validate(op) {
    if (!(op.thicknessMm > 0)) {
      return err(new ValidationError(`Shell "${op.id}" needs a positive thickness`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'shell',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
        body: op.bodyId,
        thickness: op.thicknessMm,
        openFace: op.openFace,
      },
    };
  },

  fromXml(raw) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const suppressed = boolAttr(raw, 'suppressed');
    const body = strAttr(raw, 'body');
    const thickness = numAttr(raw, 'thickness');
    const openFace = strAttr(raw, 'openFace');
    if (
      id === null ||
      name === null ||
      suppressed === null ||
      body === null ||
      thickness === null ||
      openFace === null ||
      !FACES.includes(openFace as ShellFace)
    ) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <shell>'));
    }
    return ok({
      type: 'Shell',
      id: id as OpId,
      name,
      suppressed,
      bodyId: body as BodyId,
      thicknessMm: thickness,
      openFace: openFace as ShellFace,
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
