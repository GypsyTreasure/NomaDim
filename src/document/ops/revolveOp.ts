import {
  err,
  ok,
  ImportError,
  ValidationError,
  type BodyId,
  type EntityId,
  type OpId,
  type ProfileId,
  type SketchId,
} from '../../core';
import { getEntity } from '../sketch/access';
import { asRawArray, boolAttr, numAttr, strAttr } from '../xml/xmlRaw';
import type { OpDefinition } from './definition';
import { validateBooleanTarget } from './extrudeOp';
import type { BooleanOperation, RevolveAxis, RevolveOp } from './types';

/**
 * Revolve (MASTER_DOCUMENT F3): profiles + axis (a line of the SAME sketch
 * or an origin axis — cross-sketch references are not allowed, ADR-0007) +
 * angle, same four operations as Extrude.
 */

function isOperation(value: string): value is BooleanOperation {
  return value === 'NewBody' || value === 'Join' || value === 'Cut' || value === 'Intersect';
}

function axisToAttr(axis: RevolveAxis): string {
  return axis.kind === 'origin' ? `origin:${axis.axis}` : `entity:${axis.entityId}`;
}

function axisFromAttr(text: string): RevolveAxis | null {
  if (text === 'origin:X' || text === 'origin:Y' || text === 'origin:Z') {
    return { kind: 'origin', axis: text.slice('origin:'.length) as 'X' | 'Y' | 'Z' };
  }
  if (text.startsWith('entity:') && text.length > 'entity:'.length) {
    return { kind: 'entity', entityId: text.slice('entity:'.length) as EntityId };
  }
  return null;
}

export const revolveOpDefinition: OpDefinition<RevolveOp> = {
  type: 'Revolve',
  labelKey: 'op.revolve',
  xmlTag: 'revolve',

  validate(op, doc) {
    const sketch = doc.sketches.find((s) => s.id === op.sketchId);
    if (!sketch) {
      return err(new ValidationError(`Revolve "${op.id}" references missing sketch`));
    }
    if (op.profileIds.length === 0) {
      return err(new ValidationError(`Revolve "${op.id}" selects no profiles`));
    }
    if (!(Math.abs(op.angleDeg) > 0) || Math.abs(op.angleDeg) > 360) {
      return err(new ValidationError(`Revolve "${op.id}" angle must be in (0, 360]`));
    }
    if (op.axis.kind === 'entity') {
      const entity = getEntity(sketch, op.axis.entityId);
      if (entity?.type !== 'line') {
        return err(
          new ValidationError(`Revolve "${op.id}" axis must be a line of the same sketch`)
        );
      }
    }
    if (!op.asSurface) {
      const targetError = validateBooleanTarget(op.id, op.operation, op.targetBodyId);
      if (targetError) return err(targetError);
    }
    if (op.wallThicknessMm < 0 || !Number.isFinite(op.wallThicknessMm)) {
      return err(new ValidationError(`Revolve "${op.id}" has an invalid wall thickness`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'revolve',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
        sketch: op.sketchId,
        axis: axisToAttr(op.axis),
        angle: op.angleDeg,
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
    const axisText = strAttr(raw, 'axis');
    const axis = axisText === null ? null : axisFromAttr(axisText);
    const angle = numAttr(raw, 'angle');
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
      axis === null ||
      angle === null ||
      operation === null ||
      !isOperation(operation) ||
      target === null ||
      body === null
    ) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <revolve>'));
    }
    return ok({
      type: 'Revolve',
      id: id as OpId,
      name,
      suppressed,
      sketchId: sketchId as SketchId,
      profileIds: profileIds as ProfileId[],
      axis,
      angleDeg: angle,
      operation,
      targetBodyId: target === '' ? null : (target as BodyId),
      wallThicknessMm: numAttr(raw, 'wall') ?? 0,
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
