import {
  err,
  ok,
  ImportError,
  ValidationError,
  type BodyId,
  type DatumId,
  type OpId,
} from '../../core';
import { boolAttr, strAttr } from '../xml/xmlRaw';
import { instanceChildren, parseInstances } from './bodyInstances';
import type { OpDefinition } from './definition';
import type { MirrorOp, OriginPlane, TransformOperation } from './types';

const PLANES: readonly OriginPlane[] = ['XY', 'XZ', 'YZ'];
const OPERATIONS: readonly TransformOperation[] = ['NewBody', 'Join'];

/** Mirror a body across a world origin plane (P1, ADR-0061). */
export const mirrorOpDefinition: OpDefinition<MirrorOp> = {
  type: 'Mirror',
  labelKey: 'op.mirror',
  xmlTag: 'mirror',

  validate(op) {
    for (const inst of [
      { sourceBodyId: op.sourceBodyId, bodyId: op.bodyId },
      ...(op.extraInstances ?? []),
    ]) {
      if (inst.sourceBodyId === inst.bodyId) {
        return err(new ValidationError(`Mirror "${op.id}" cannot target its own body id`));
      }
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'mirror',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
        source: op.sourceBodyId,
        plane: op.plane,
        // Only emitted when mirroring across a construction plane (#datum).
        ...(op.datumId ? { datum: op.datumId } : {}),
        operation: op.operation,
        body: op.bodyId,
      },
      children: instanceChildren(op.extraInstances),
    };
  },

  fromXml(raw) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const suppressed = boolAttr(raw, 'suppressed');
    const source = strAttr(raw, 'source');
    const plane = strAttr(raw, 'plane');
    const operation = strAttr(raw, 'operation');
    const body = strAttr(raw, 'body');
    if (
      id === null ||
      name === null ||
      suppressed === null ||
      source === null ||
      body === null ||
      plane === null ||
      !PLANES.includes(plane as OriginPlane) ||
      operation === null ||
      !OPERATIONS.includes(operation as TransformOperation)
    ) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <mirror>'));
    }
    const datum = strAttr(raw, 'datum');
    const extraInstances = parseInstances(raw);
    return ok({
      type: 'Mirror',
      id: id as OpId,
      name,
      suppressed,
      sourceBodyId: source as BodyId,
      plane: plane as OriginPlane,
      ...(datum !== null ? { datumId: datum as DatumId } : {}),
      operation: operation as TransformOperation,
      bodyId: body as BodyId,
      ...(extraInstances ? { extraInstances } : {}),
    });
  },

  dependencies(op) {
    // Join fuses into each source (no new body); NewBody produces a fresh body
    // per source (#3).
    const extras = op.extraInstances ?? [];
    return {
      producesBodies: op.operation === 'Join' ? [] : [op.bodyId, ...extras.map((i) => i.bodyId)],
      consumesBodies: [op.sourceBodyId, ...extras.map((i) => i.sourceBodyId)],
      consumesSketch: null,
      producesSketch: null,
    };
  },
};
