import { useState } from 'react';
import { createId, type BodyId } from '../../../core';
import type { MoveOp } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { DialogFrame, NumberRow, SelectRow } from './dialogShared';
import { existingIds, mintName, targetOptions } from './dialogData';

/** Move create/edit dialog (#3): body + in-place XYZ translation + rotation. */
export function MoveDialog({ editing, onClose }: OpDialogProps): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const prior = editing?.type === 'Move' ? editing : null;

  const [bodyId, setBodyId] = useState<BodyId | null>(prior?.bodyId ?? liveBodyIds[0] ?? null);
  const [tx, setTx] = useState(prior?.translate[0] ?? 0);
  const [ty, setTy] = useState(prior?.translate[1] ?? 0);
  const [tz, setTz] = useState(prior?.translate[2] ?? 0);
  const [rx, setRx] = useState(prior?.rotate[0] ?? 0);
  const [ry, setRy] = useState(prior?.rotate[1] ?? 0);
  const [rz, setRz] = useState(prior?.rotate[2] ?? 0);

  const okDisabled = bodyId === null;

  const submit = (): void => {
    if (bodyId === null) return;
    const ids = existingIds(document);
    const op: MoveOp = {
      type: 'Move',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Move'),
      suppressed: prior?.suppressed ?? false,
      bodyId,
      translate: [tx, ty, tz],
      rotate: [rx, ry, rz],
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.move')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <SelectRow<BodyId>
        labelKey="dialog.body"
        value={bodyId ?? ('' as BodyId)}
        options={targetOptions(document, liveBodyIds)}
        onChange={setBodyId}
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
