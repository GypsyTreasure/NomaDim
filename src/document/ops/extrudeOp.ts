import {
  err,
  ok,
  ImportError,
  ValidationError,
  type BodyId,
  type OpId,
  type ProfileId,
  type SketchId,
} from '../../core';
import { asRawArray, boolAttr, numAttr, strAttr } from '../xml/xmlRaw';
import type { OpDefinition } from './definition';
import type { BooleanOperation, ExtrudeDirection, ExtrudeOp } from './types';

/** Extrude (MASTER_DOCUMENT F3): profiles → prism, all four operations. */

const OPERATIONS: readonly BooleanOperation[] = ['NewBody', 'Join', 'Cut', 'Intersect'];
const DIRECTIONS: readonly ExtrudeDirection[] = ['one-side', 'symmetric', 'two-sides', 'all'];

function isOperation(value: string): value is BooleanOperation {
  return (OPERATIONS as readonly string[]).includes(value);
}
function isDirection(value: string): value is ExtrudeDirection {
  return (DIRECTIONS as readonly string[]).includes(value);
}

export function validateBooleanTarget(
  opId: string,
  operation: BooleanOperation,
  targetBodyId: BodyId | null
): ValidationError | null {
  if (operation !== 'NewBody' && targetBodyId === null) {
    return new ValidationError(`Op "${opId}": ${operation} requires a target body`);
  }
  return null;
}

export const extrudeOpDefinition: OpDefinition<ExtrudeOp> = {
  type: 'Extrude',
  labelKey: 'op.extrude',
  xmlTag: 'extrude',

  validate(op, doc) {
    if (!doc.sketches.some((s) => s.id === op.sketchId)) {
      return err(new ValidationError(`Extrude "${op.id}" references missing sketch`));
    }
    if (op.profileIds.length === 0) {
      return err(new ValidationError(`Extrude "${op.id}" selects no profiles`));
    }
    // 'all' (Through All) is self-sizing, so its distance fields are ignored.
    if (op.direction !== 'all' && (!(op.distanceMm !== 0) || !Number.isFinite(op.distanceMm))) {
      return err(new ValidationError(`Extrude "${op.id}" has zero distance`));
    }
    if (op.direction === 'two-sides' && !(op.distance2Mm > 0)) {
      return err(new ValidationError(`Extrude "${op.id}" needs a positive second distance`));
    }
    // A surface extrude is always a new body — no boolean target to validate.
    if (!op.asSurface) {
      const targetError = validateBooleanTarget(op.id, op.operation, op.targetBodyId);
      if (targetError) return err(targetError);
    }
    if (op.wallThicknessMm < 0 || !Number.isFinite(op.wallThicknessMm)) {
      return err(new ValidationError(`Extrude "${op.id}" has an invalid wall thickness`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'extrude',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
        sketch: op.sketchId,
        distance: op.distanceMm,
        direction: op.direction,
        distance2: op.distance2Mm,
        operation: op.operation,
        target: op.targetBodyId ?? '',
        wall: op.wallThicknessMm,
        surface: op.asSurface,
        body: op.bodyId,
      },
      children: op.profileIds.map((profileId) => ({ tag: 'profile', attrs: { ref: profileId } })),
    };
  },

  fromXml(raw) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const suppressed = boolAttr(raw, 'suppressed');
    const sketchId = strAttr(raw, 'sketch');
    const distance = numAttr(raw, 'distance');
    const direction = strAttr(raw, 'direction');
    const distance2 = numAttr(raw, 'distance2');
    const operation = strAttr(raw, 'operation');
    const target = strAttr(raw, 'target');
    const body = strAttr(raw, 'body');
    const profileIds = asRawArray(raw.profile)
      .map((p) => strAttr(p, 'ref'))
      .filter((ref): ref is string => ref !== null);

    if (
      id === null ||
      name === null ||
      suppressed === null ||
      sketchId === null ||
      distance === null ||
      direction === null ||
      !isDirection(direction) ||
      distance2 === null ||
      operation === null ||
      !isOperation(operation) ||
      target === null ||
      body === null
    ) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <extrude>'));
    }
    return ok({
      type: 'Extrude',
      id: id as OpId,
      name,
      suppressed,
      sketchId: sketchId as SketchId,
      profileIds: profileIds as ProfileId[],
      distanceMm: distance,
      direction,
      distance2Mm: distance2,
      operation,
      targetBodyId: target === '' ? null : (target as BodyId),
      // Optional (#7): pre-thin-wall documents default to a solid (0).
      wallThicknessMm: numAttr(raw, 'wall') ?? 0,
      // Optional (ADR-0072): pre-surface documents default to a solid.
      asSurface: boolAttr(raw, 'surface') ?? false,
      bodyId: body as BodyId,
    });
  },

  dependencies(op) {
    return {
      producesBodies: op.operation === 'NewBody' ? [op.bodyId] : [],
      consumesBodies: op.operation === 'NewBody' || !op.targetBodyId ? [] : [op.targetBodyId],
      consumesSketch: op.sketchId,
      producesSketch: null,
    };
  },
};
