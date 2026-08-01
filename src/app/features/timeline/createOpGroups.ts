import type { OpType } from '../../../document';
import type { TranslationKey } from '../../i18n/en';

/**
 * Thematic ribbon groups (#5c) that split the creatable ops into MS-Office-like
 * sections (Create/Modify/Pattern). Each group is an ordered list of op types;
 * `groupedOpTypes` + a test assert the union equals CREATABLE_OP_TYPES, so
 * adding an op without placing it in a group is caught (registry-completeness
 * discipline). Data only — kept out of the component file so React fast-refresh
 * stays happy.
 */
export const CREATE_OP_GROUPS: readonly {
  readonly labelKey: TranslationKey;
  readonly ops: readonly OpType[];
}[] = [
  { labelKey: 'ribbon.create', ops: ['Extrude', 'Revolve'] },
  { labelKey: 'ribbon.modify', ops: ['Fillet', 'Chamfer', 'Shell', 'Combine', 'Move'] },
  { labelKey: 'ribbon.pattern', ops: ['Mirror', 'Pattern', 'CopyBody'] },
];

/** Every op placed in a group — used by the completeness test. */
export const groupedOpTypes: readonly OpType[] = CREATE_OP_GROUPS.flatMap((g) => g.ops);
