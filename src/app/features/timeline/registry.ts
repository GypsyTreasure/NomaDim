import type { OpType } from '../../../document';
import type { TranslationKey } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { ExtrudeDialog } from './ExtrudeDialog';
import { RevolveDialog } from './RevolveDialog';
import { FilletDialog } from './FilletDialog';
import { ChamferDialog } from './ChamferDialog';
import { CombineDialog } from './CombineDialog';
import { CopyBodyDialog } from './CopyBodyDialog';
import { MirrorDialog } from './MirrorDialog';
import { PatternDialog } from './PatternDialog';

/**
 * App-side op feature registry (ARCHITECTURE §7, the third registry). One
 * entry per OpType — label plus optional create/edit dialog. The timeline
 * toolbar iterates this map (no per-op switch, R4); registry completeness
 * across the three registries is asserted by the completeness test (R9).
 * Sketch has no dialog — it is authored inside the sketch environment.
 */
export interface OpFeature {
  readonly type: OpType;
  readonly labelKey: TranslationKey;
  readonly dialog: React.ComponentType<OpDialogProps> | null;
}

const sketchFeature: OpFeature = { type: 'Sketch', labelKey: 'op.sketch', dialog: null };
const extrudeFeature: OpFeature = {
  type: 'Extrude',
  labelKey: 'op.extrude',
  dialog: ExtrudeDialog,
};
const revolveFeature: OpFeature = {
  type: 'Revolve',
  labelKey: 'op.revolve',
  dialog: RevolveDialog,
};
const filletFeature: OpFeature = { type: 'Fillet', labelKey: 'op.fillet', dialog: FilletDialog };
const chamferFeature: OpFeature = {
  type: 'Chamfer',
  labelKey: 'op.chamfer',
  dialog: ChamferDialog,
};
const combineFeature: OpFeature = {
  type: 'Combine',
  labelKey: 'op.combine',
  dialog: CombineDialog,
};
const copyBodyFeature: OpFeature = {
  type: 'CopyBody',
  labelKey: 'op.copyBody',
  dialog: CopyBodyDialog,
};
const mirrorFeature: OpFeature = { type: 'Mirror', labelKey: 'op.mirror', dialog: MirrorDialog };
const patternFeature: OpFeature = {
  type: 'Pattern',
  labelKey: 'op.pattern',
  dialog: PatternDialog,
};

export const OP_FEATURES: Record<OpType, OpFeature> = {
  Sketch: sketchFeature,
  Extrude: extrudeFeature,
  Revolve: revolveFeature,
  Fillet: filletFeature,
  Chamfer: chamferFeature,
  Combine: combineFeature,
  CopyBody: copyBodyFeature,
  Mirror: mirrorFeature,
  Pattern: patternFeature,
};

export const OP_FEATURE_TYPES: readonly OpType[] = Object.keys(OP_FEATURES) as OpType[];

/** Op types users create from the timeline toolbar (those with a dialog). */
export const CREATABLE_OP_TYPES: readonly OpType[] = OP_FEATURE_TYPES.filter(
  (type) => OP_FEATURES[type].dialog !== null
);
