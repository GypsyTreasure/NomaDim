import type { OpDefinition } from './definition';
import type { OpType, TimelineOp } from './types';
import { sketchOpDefinition } from './sketchOp';
import { extrudeOpDefinition } from './extrudeOp';
import { revolveOpDefinition } from './revolveOp';
import { filletOpDefinition } from './filletOp';
import { chamferOpDefinition } from './chamferOp';
import { combineOpDefinition } from './combineOp';

/**
 * Document-side op registry (ARCHITECTURE §7). The XML codec, timeline UI,
 * and dirty tracking iterate THIS map — per-op switches outside registry
 * files are a review-blocker (R10). Completeness across all four registries
 * is asserted by `tests/ops/registry-completeness.spec.ts` (R9).
 */
export const OP_DEFINITIONS: Record<OpType, OpDefinition> = {
  Sketch: sketchOpDefinition,
  Extrude: extrudeOpDefinition,
  Revolve: revolveOpDefinition,
  Fillet: filletOpDefinition,
  Chamfer: chamferOpDefinition,
  Combine: combineOpDefinition,
};

export function opDefinition(op: TimelineOp): OpDefinition {
  return OP_DEFINITIONS[op.type];
}

export const OP_TYPES: readonly OpType[] = Object.keys(OP_DEFINITIONS) as OpType[];
