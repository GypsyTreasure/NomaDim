import { useState } from 'react';
import { createId, type BodyId } from '../../../core';
import type { CopyBodyOp } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { DialogFrame, NumberRow, SelectRow } from './dialogShared';
import { existingIds, mintName, targetOptions } from './dialogData';

/** Copy Body create/edit dialog (F9): source body + optional XYZ translation. */
export function CopyBodyDialog({ editing, onClose }: OpDialogProps): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const prior = editing?.type === 'CopyBody' ? editing : null;

  const [sourceBodyId, setSourceBodyId] = useState<BodyId | null>(
    prior?.sourceBodyId ?? liveBodyIds[0] ?? null
  );
  const [tx, setTx] = useState(prior?.translate[0] ?? 0);
  const [ty, setTy] = useState(prior?.translate[1] ?? 0);
  const [tz, setTz] = useState(prior?.translate[2] ?? 0);
  const [rx, setRx] = useState(prior?.rotate[0] ?? 0);
  const [ry, setRy] = useState(prior?.rotate[1] ?? 0);
  const [rz, setRz] = useState(prior?.rotate[2] ?? 0);

  const okDisabled = sourceBodyId === null;

  const submit = (): void => {
    if (sourceBodyId === null) return;
    const ids = existingIds(document);
    const op: CopyBodyOp = {
      type: 'CopyBody',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Copy'),
      suppressed: prior?.suppressed ?? false,
      sourceBodyId,
      translate: [tx, ty, tz],
      rotate: [rx, ry, rz],
      bodyId: prior?.bodyId ?? createId<'BodyId'>(ids),
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.copyBody')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <SelectRow<BodyId>
        labelKey="dialog.source"
        value={sourceBodyId ?? ('' as BodyId)}
        options={targetOptions(document, liveBodyIds, prior?.bodyId)}
        onChange={setSourceBodyId}
      />
      <NumberRow labelKey="dialog.translateX" value={tx} onChange={setTx} />
      <NumberRow labelKey="dialog.translateY" value={ty} onChange={setTy} />
      <NumberRow labelKey="dialog.translateZ" value={tz} onChange={setTz} />
      <NumberRow labelKey="dialog.rotateX" value={rx} onChange={setRx} />
      <NumberRow labelKey="dialog.rotateY" value={ry} onChange={setRy} />
      <NumberRow labelKey="dialog.rotateZ" value={rz} onChange={setRz} />
    </DialogFrame>
  );
}
