import {
  err,
  ok,
  ImportError,
  ValidationError,
  type BodyId,
  type OpId,
} from '../../core';
import { asRawArray, boolAttr, numAttr, strAttr } from '../xml/xmlRaw';
import type { OpDefinition } from './definition';
import { edgeFingerprintFromRaw, edgeFingerprintToXml } from './edgeFingerprintXml';
import type { ChamferOp, EdgeFingerprint } from './types';

/** Chamfer (MASTER_DOCUMENT F4): multi-edge pick, equal-distance bevel. */
export const chamferOpDefinition: OpDefinition<ChamferOp> = {
  type: 'Chamfer',
  labelKey: 'op.chamfer',
  xmlTag: 'chamfer',

  validate(op) {
    if (op.edges.length === 0) {
      return err(new ValidationError(`Chamfer "${op.id}" selects no edges`));
    }
    if (!(op.distanceMm > 0) || !Number.isFinite(op.distanceMm)) {
      return err(new ValidationError(`Chamfer "${op.id}" needs a positive distance`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'chamfer',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
        body: op.bodyId,
        distance: op.distanceMm,
      },
      children: op.edges.map(edgeFingerprintToXml),
    };
  },

  fromXml(raw) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const suppressed = boolAttr(raw, 'suppressed');
    const body = strAttr(raw, 'body');
    const distance = numAttr(raw, 'distance');
    const edges: EdgeFingerprint[] = [];
    for (const edgeRaw of asRawArray(raw.edge)) {
      const fp = edgeFingerprintFromRaw(edgeRaw);
      if (!fp) return err(new ImportError('Invalid timeline XML', undefined, 'malformed <edge>'));
      edges.push(fp);
    }
    if (id === null || name === null || suppressed === null || body === null || distance === null) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <chamfer>'));
    }
    return ok({
      type: 'Chamfer',
      id: id as OpId,
      name,
      suppressed,
      bodyId: body as BodyId,
      edges,
      distanceMm: distance,
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
