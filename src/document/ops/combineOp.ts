import { err, ok, ImportError, ValidationError, type BodyId, type OpId } from '../../core';
import { asRawArray, boolAttr, strAttr } from '../xml/xmlRaw';
import type { OpDefinition } from './definition';
import type { CombineOp, CombineOperation } from './types';

/** Combine (MASTER_DOCUMENT F5): target + tool bodies → Join/Cut/Intersect. */

function isCombineOperation(value: string): value is CombineOperation {
  return value === 'Join' || value === 'Cut' || value === 'Intersect';
}

export const combineOpDefinition: OpDefinition<CombineOp> = {
  type: 'Combine',
  labelKey: 'op.combine',
  xmlTag: 'combine',

  validate(op) {
    if (op.toolBodyIds.length === 0) {
      return err(new ValidationError(`Combine "${op.id}" selects no tool bodies`));
    }
    if (op.toolBodyIds.includes(op.targetBodyId)) {
      return err(new ValidationError(`Combine "${op.id}" target cannot also be a tool`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'combine',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
        target: op.targetBodyId,
        operation: op.operation,
        keepTools: op.keepTools,
      },
      children: op.toolBodyIds.map((toolId) => ({ tag: 'tool', attrs: { ref: toolId } })),
    };
  },

  fromXml(raw) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const suppressed = boolAttr(raw, 'suppressed');
    const target = strAttr(raw, 'target');
    const operation = strAttr(raw, 'operation');
    const keepTools = boolAttr(raw, 'keepTools');
    const toolBodyIds = asRawArray(raw.tool)
      .map((t) => strAttr(t, 'ref'))
      .filter((ref): ref is string => ref !== null);

    if (
      id === null ||
      name === null ||
      suppressed === null ||
      target === null ||
      operation === null ||
      !isCombineOperation(operation) ||
      keepTools === null
    ) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <combine>'));
    }
    return ok({
      type: 'Combine',
      id: id as OpId,
      name,
      suppressed,
      targetBodyId: target as BodyId,
      toolBodyIds: toolBodyIds as BodyId[],
      operation,
      keepTools,
    });
  },

  dependencies(op) {
    return {
      producesBodies: [],
      consumesBodies: [op.targetBodyId, ...op.toolBodyIds],
      consumesSketch: null,
      producesSketch: null,
    };
  },
};
