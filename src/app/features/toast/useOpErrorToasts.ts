import { useEffect, useRef } from 'react';
import { useKernelStore } from '../../store/kernelStore';
import { useDocumentStore } from '../../store/documentStore';
import { pushToast } from '../../store/toastStore';
import { t } from '../../i18n/t';

/**
 * The "+ toast" half of the §7 error policy: watches per-op regen statuses and
 * raises a toast when an op newly enters the 'error' state (the red timeline
 * chip is the other half). Deduped by opId+code via a ref so a stable error
 * doesn't re-toast on every regen; an op that recovers and later fails again
 * re-toasts (its entry left the seen-set when it went green).
 */
export function useOpErrorToasts(): void {
  const statuses = useKernelStore((s) => s.statuses);
  const ops = useDocumentStore((s) => s.document.ops);
  const seen = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const nameById = new Map(ops.map((op) => [op.id, op.name]));
    const nextSeen = new Map<string, string>();
    for (const [opId, report] of statuses) {
      if (report.status !== 'error') continue;
      const code = report.code ?? 'error';
      nextSeen.set(opId, code);
      if (seen.current.get(opId) === code) continue; // already announced
      const name = nameById.get(opId) ?? opId;
      pushToast(`${name}: ${report.message ?? t('toast.opFailed')}`, 'error');
    }
    seen.current = nextSeen;
  }, [statuses, ops]);
}
