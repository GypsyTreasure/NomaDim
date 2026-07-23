import { err, ok, ImportError, ValidationError, type BodyId, type OpId } from '../../core';
import { boolAttr, numAttr, strAttr } from '../xml/xmlRaw';
import type { OpDefinition } from './definition';
import type { OriginAxis, PatternKind, PatternOp, TransformOperation } from './types';

const KINDS: readonly PatternKind[] = ['linear', 'circular'];
const AXES: readonly OriginAxis[] = ['X', 'Y', 'Z'];
const OPERATIONS: readonly TransformOperation[] = ['NewBody', 'Join'];

/** Rectangular (linear) or circular array of a body (P1, ADR-0061). */
export const patternOpDefinition: OpDefinition<PatternOp> = {
  type: 'Pattern',
  labelKey: 'op.pattern',
  xmlTag: 'pattern',

  validate(op) {
    if (!Number.isInteger(op.count) || op.count < 2) {
      return err(new ValidationError(`Pattern "${op.id}" needs a count of at least 2`));
    }
    if (op.sourceBodyId === op.bodyId) {
      return err(new ValidationError(`Pattern "${op.id}" cannot target its own body id`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'pattern',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
        source: op.sourceBodyId,
        kind: op.kind,
        count: op.count,
        spacing: op.spacingMm,
        axis: op.axis,
        angle: op.angleDeg,
        operation: op.operation,
        body: op.bodyId,
      },
    };
  },

  fromXml(raw) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const suppressed = boolAttr(raw, 'suppressed');
    const source = strAttr(raw, 'source');
    const kind = strAttr(raw, 'kind');
    const count = numAttr(raw, 'count');
    const spacing = numAttr(raw, 'spacing');
    const axis = strAttr(raw, 'axis');
    const angle = numAttr(raw, 'angle');
    const operation = strAttr(raw, 'operation');
    const body = strAttr(raw, 'body');
    if (
      id === null ||
      name === null ||
      suppressed === null ||
      source === null ||
      body === null ||
      count === null ||
      spacing === null ||
      angle === null ||
      kind === null ||
      !KINDS.includes(kind as PatternKind) ||
      axis === null ||
      !AXES.includes(axis as OriginAxis) ||
      operation === null ||
      !OPERATIONS.includes(operation as TransformOperation)
    ) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <pattern>'));
    }
    return ok({
      type: 'Pattern',
      id: id as OpId,
      name,
      suppressed,
      sourceBodyId: source as BodyId,
      kind: kind as PatternKind,
      count,
      spacingMm: spacing,
      axis: axis as OriginAxis,
      angleDeg: angle,
      operation: operation as TransformOperation,
      bodyId: body as BodyId,
    });
  },

  dependencies(op) {
    return {
      producesBodies: op.operation === 'Join' ? [] : [op.bodyId],
      consumesBodies: [op.sourceBodyId],
      consumesSketch: null,
      producesSketch: null,
    };
  },
};
