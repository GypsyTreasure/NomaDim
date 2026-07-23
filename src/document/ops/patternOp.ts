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
    // Grid directions 2/3 are integer counts ≥ 1 (1 = unused); the total number
    // of instances is capped so a runaway 50×50×50 can't lock up the kernel.
    for (const c of [op.count2, op.count3]) {
      if (!Number.isInteger(c) || c < 1) {
        return err(new ValidationError(`Pattern "${op.id}" grid counts must be whole numbers ≥ 1`));
      }
    }
    if (op.kind === 'linear' && op.count * op.count2 * op.count3 > 1000) {
      return err(new ValidationError(`Pattern "${op.id}" has too many instances (max 1000)`));
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
        count2: op.count2,
        spacing2: op.spacingMm2,
        axis2: op.axis2,
        count3: op.count3,
        spacing3: op.spacingMm3,
        axis3: op.axis3,
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
    // Grid directions 2/3 are optional (added for request #4); a pre-#4
    // document omits them and defaults to a single-axis pattern (count 1).
    const count2 = numAttr(raw, 'count2') ?? 1;
    const spacing2 = numAttr(raw, 'spacing2') ?? 0;
    const axis2 = strAttr(raw, 'axis2') ?? 'Y';
    const count3 = numAttr(raw, 'count3') ?? 1;
    const spacing3 = numAttr(raw, 'spacing3') ?? 0;
    const axis3 = strAttr(raw, 'axis3') ?? 'Z';
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
      !AXES.includes(axis2 as OriginAxis) ||
      !AXES.includes(axis3 as OriginAxis) ||
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
      count2,
      spacingMm2: spacing2,
      axis2: axis2 as OriginAxis,
      count3,
      spacingMm3: spacing3,
      axis3: axis3 as OriginAxis,
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
