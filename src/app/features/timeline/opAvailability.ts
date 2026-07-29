import type { OpType } from '../../../document';
import type { TranslationKey } from '../../i18n/en';
import { useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';

/**
 * Op precondition gating (M9 GUI hardening, ADR-pending). Every create-op
 * button is either enabled+functional or disabled with a `reasonKey` that
 * explains what's missing — no button renders and silently no-ops. Pure so the
 * rules are unit-testable without the store.
 */

export interface OpAvailability {
  readonly available: boolean;
  /** i18n key explaining the unmet precondition (only when unavailable). */
  readonly reasonKey?: TranslationKey;
}

export interface ModelState {
  /** At least one sketch exists (Extrude/Revolve consume a sketch profile). */
  readonly hasSketch: boolean;
  /** Live solid bodies the kernel has built (body ops consume a body). */
  readonly bodyCount: number;
}

/** Ops that operate on an existing body (need ≥ 1). */
const BODY_OPS: ReadonlySet<OpType> = new Set<OpType>([
  'Fillet',
  'Chamfer',
  'CopyBody',
  'Mirror',
  'Pattern',
  'Shell',
  'Move',
]);

/** Whether `type` can run given the current model state, and why not. */
export function opAvailability(type: OpType, state: ModelState): OpAvailability {
  if (type === 'Extrude' || type === 'Revolve') {
    return state.hasSketch
      ? { available: true }
      : { available: false, reasonKey: 'guard.needSketch' };
  }
  if (type === 'Combine') {
    return state.bodyCount >= 2
      ? { available: true }
      : { available: false, reasonKey: 'guard.needTwoBodies' };
  }
  if (BODY_OPS.has(type)) {
    return state.bodyCount >= 1
      ? { available: true }
      : { available: false, reasonKey: 'guard.needBody' };
  }
  return { available: true };
}

/** Reactive availability resolver bound to the document + kernel stores. */
export function useOpAvailability(): (type: OpType) => OpAvailability {
  const hasSketch = useDocumentStore((s) => s.document.sketches.length > 0);
  const bodyCount = useKernelStore((s) => s.liveBodyIds.length);
  return (type) => opAvailability(type, { hasSketch, bodyCount });
}
