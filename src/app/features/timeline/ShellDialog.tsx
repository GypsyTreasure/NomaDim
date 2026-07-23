import { useState } from 'react';
import { createId, type BodyId } from '../../../core';
import type { ShellFace, ShellOp } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { DialogFrame, NumberRow, SelectRow, type SelectOption } from './dialogShared';
import { existingIds, mintName, targetOptions } from './dialogData';

const FACE_OPTIONS: readonly SelectOption<ShellFace>[] = [
  { value: 'none', label: t('dialog.shell.face.none') },
  { value: 'top', label: t('dialog.shell.face.top') },
  { value: 'bottom', label: t('dialog.shell.face.bottom') },
  { value: 'front', label: t('dialog.shell.face.front') },
  { value: 'back', label: t('dialog.shell.face.back') },
  { value: 'left', label: t('dialog.shell.face.left') },
  { value: 'right', label: t('dialog.shell.face.right') },
];

/** Shell create/edit dialog (P2, ADR-0064): body + wall thickness + open face. */
export function ShellDialog({ editing, onClose }: OpDialogProps): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const prior = editing?.type === 'Shell' ? editing : null;

  const [bodyId, setBodyId] = useState<BodyId | null>(prior?.bodyId ?? liveBodyIds[0] ?? null);
  const [thicknessMm, setThicknessMm] = useState(prior?.thicknessMm ?? 2);
  const [openFace, setOpenFace] = useState<ShellFace>(prior?.openFace ?? 'top');

  const okDisabled = bodyId === null || !(thicknessMm > 0);

  const submit = (): void => {
    if (bodyId === null || !(thicknessMm > 0)) return;
    const ids = existingIds(document);
    const op: ShellOp = {
      type: 'Shell',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Shell'),
      suppressed: prior?.suppressed ?? false,
      bodyId,
      thicknessMm,
      openFace,
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.shell')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <SelectRow<BodyId>
        labelKey="dialog.body"
        value={bodyId ?? ('' as BodyId)}
        options={targetOptions(document, liveBodyIds)}
        onChange={setBodyId}
      />
      <NumberRow labelKey="dialog.shell.thickness" value={thicknessMm} onChange={setThicknessMm} />
      <SelectRow<ShellFace>
        labelKey="dialog.shell.openFace"
        value={openFace}
        options={FACE_OPTIONS}
        onChange={setOpenFace}
      />
    </DialogFrame>
  );
}
