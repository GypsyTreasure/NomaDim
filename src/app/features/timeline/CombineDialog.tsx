import { useState } from 'react';
import { createId, type BodyId } from '../../../core';
import type { CombineOp, CombineOperation } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { DialogFrame, SelectRow, type SelectOption } from './dialogShared';
import { existingIds, mintName, targetOptions } from './dialogData';
import styles from './Timeline.module.css';

const OPERATION_OPTIONS: readonly SelectOption<CombineOperation>[] = [
  { value: 'Join', label: t('dialog.operation.Join') },
  { value: 'Cut', label: t('dialog.operation.Cut') },
  { value: 'Intersect', label: t('dialog.operation.Intersect') },
];

/** Combine create/edit dialog (F5): target + tool bodies + operation + keep-tools. */
export function CombineDialog({ editing, onClose }: OpDialogProps): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const prior = editing?.type === 'Combine' ? editing : null;

  const [targetBodyId, setTargetBodyId] = useState<BodyId | null>(
    prior?.targetBodyId ?? liveBodyIds[0] ?? null
  );
  const [tools, setTools] = useState<ReadonlySet<BodyId>>(new Set(prior?.toolBodyIds ?? []));
  const [operation, setOperation] = useState<CombineOperation>(prior?.operation ?? 'Join');
  const [keepTools, setKeepTools] = useState(prior?.keepTools ?? false);

  const toggleTool = (id: BodyId): void => {
    setTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toolCandidates = liveBodyIds.filter((id) => id !== targetBodyId);
  const okDisabled = targetBodyId === null || tools.size === 0;

  const submit = (): void => {
    if (targetBodyId === null) return;
    const ids = existingIds(document);
    const op: CombineOp = {
      type: 'Combine',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Combine'),
      suppressed: prior?.suppressed ?? false,
      targetBodyId,
      toolBodyIds: [...tools].filter((id) => id !== targetBodyId),
      operation,
      keepTools,
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.combine')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <SelectRow<BodyId>
        labelKey="dialog.target"
        value={targetBodyId ?? ('' as BodyId)}
        options={targetOptions(liveBodyIds)}
        onChange={setTargetBodyId}
      />
      <fieldset className={styles.fieldset}>
        <legend>{t('dialog.tools')}</legend>
        {toolCandidates.map((id) => (
          <label key={id} className={styles.checkRow}>
            <input type="checkbox" checked={tools.has(id)} onChange={() => { toggleTool(id); }} />
            <span>{id}</span>
          </label>
        ))}
      </fieldset>
      <SelectRow<CombineOperation>
        labelKey="dialog.operation"
        value={operation}
        options={OPERATION_OPTIONS}
        onChange={setOperation}
      />
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={keepTools}
          onChange={(e) => { setKeepTools(e.target.checked); }}
        />
        <span>{t('dialog.keepTools')}</span>
      </label>
    </DialogFrame>
  );
}
