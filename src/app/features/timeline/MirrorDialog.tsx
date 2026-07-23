import { useState } from 'react';
import { createId, type BodyId } from '../../../core';
import type { MirrorOp, OriginPlane, TransformOperation } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { DialogFrame, SelectRow, type SelectOption } from './dialogShared';
import { existingIds, mintName, targetOptions } from './dialogData';

const PLANE_OPTIONS: readonly SelectOption<OriginPlane>[] = [
  { value: 'XY', label: t('dialog.plane.XY') },
  { value: 'XZ', label: t('dialog.plane.XZ') },
  { value: 'YZ', label: t('dialog.plane.YZ') },
];
const OPERATION_OPTIONS: readonly SelectOption<TransformOperation>[] = [
  { value: 'Join', label: t('dialog.operation.transform.Join') },
  { value: 'NewBody', label: t('dialog.operation.transform.NewBody') },
];

/** Mirror create/edit dialog (P1): source body + origin plane + Join/NewBody. */
export function MirrorDialog({ editing, onClose }: OpDialogProps): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const prior = editing?.type === 'Mirror' ? editing : null;

  const [sourceBodyId, setSourceBodyId] = useState<BodyId | null>(
    prior?.sourceBodyId ?? liveBodyIds[0] ?? null
  );
  const [plane, setPlane] = useState<OriginPlane>(prior?.plane ?? 'XY');
  const [operation, setOperation] = useState<TransformOperation>(prior?.operation ?? 'Join');

  const okDisabled = sourceBodyId === null;

  const submit = (): void => {
    if (sourceBodyId === null) return;
    const ids = existingIds(document);
    const op: MirrorOp = {
      type: 'Mirror',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Mirror'),
      suppressed: prior?.suppressed ?? false,
      sourceBodyId,
      plane,
      operation,
      bodyId: prior?.bodyId ?? createId<'BodyId'>(ids),
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.mirror')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <SelectRow<BodyId>
        labelKey="dialog.source"
        value={sourceBodyId ?? ('' as BodyId)}
        options={targetOptions(document, liveBodyIds, prior?.bodyId)}
        onChange={setSourceBodyId}
      />
      <SelectRow<OriginPlane>
        labelKey="dialog.plane"
        value={plane}
        options={PLANE_OPTIONS}
        onChange={setPlane}
      />
      <SelectRow<TransformOperation>
        labelKey="dialog.operation"
        value={operation}
        options={OPERATION_OPTIONS}
        onChange={setOperation}
      />
    </DialogFrame>
  );
}
