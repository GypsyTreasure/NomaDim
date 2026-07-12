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
import type { EdgeFingerprint, FilletOp } from './types';

/** Fillet (MASTER_DOCUMENT F4): multi-edge pick, single radius per op. */
export const filletOpDefinition: OpDefinition<FilletOp> = {
  type: 'Fillet',
  labelKey: 'op.fillet',
  xmlTag: 'fillet',

  validate(op) {
    if (op.edges.length === 0) {
      return err(new ValidationError(`Fillet "${op.id}" selects no edges`));
    }
    if (!(op.radiusMm > 0) || !Number.isFinite(op.radiusMm)) {
      return err(new ValidationError(`Fillet "${op.id}" needs a positive radius`));
    }
    return ok(undefined);
  },

  toXml(op) {
    return {
      tag: 'fillet',
      attrs: {
        id: op.id,
        name: op.name,
        suppressed: op.suppressed,
        body: op.bodyId,
        radius: op.radiusMm,
      },
      children: op.edges.map(edgeFingerprintToXml),
    };
  },

  fromXml(raw) {
    const id = strAttr(raw, 'id');
    const name = strAttr(raw, 'name');
    const suppressed = boolAttr(raw, 'suppressed');
    const body = strAttr(raw, 'body');
    const radius = numAttr(raw, 'radius');
    const edges: EdgeFingerprint[] = [];
    for (const edgeRaw of asRawArray(raw.edge)) {
      const fp = edgeFingerprintFromRaw(edgeRaw);
      if (!fp) return err(new ImportError('Invalid timeline XML', undefined, 'malformed <edge>'));
      edges.push(fp);
    }
    if (id === null || name === null || suppressed === null || body === null || radius === null) {
      return err(new ImportError('Invalid timeline XML', undefined, 'malformed <fillet>'));
    }
    return ok({
      type: 'Fillet',
      id: id as OpId,
      name,
      suppressed,
      bodyId: body as BodyId,
      edges,
      radiusMm: radius,
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
