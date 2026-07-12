import { useState } from 'react';
import { createId, type BodyId } from '../../../core';
import type { ChamferOp } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { useSessionStore } from '../../store/sessionStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { DialogFrame, NumberRow } from './dialogShared';
import { EdgePickControls } from './EdgePickControls';
import { existingIds, mintName, useEdgePickLifecycle } from './dialogData';

/** Chamfer create/edit dialog (F4): target body + picked edges + equal distance. */
export function ChamferDialog({ editing, onClose }: OpDialogProps): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const pickedEdges = useSessionStore((s) => s.pickedEdges);
  const prior = editing?.type === 'Chamfer' ? editing : null;

  const [bodyId, setBodyId] = useState<BodyId | null>(prior?.bodyId ?? liveBodyIds[0] ?? null);
  const [distanceMm, setDistanceMm] = useState(prior?.distanceMm ?? 2);

  useEdgePickLifecycle(prior?.bodyId ?? liveBodyIds[0] ?? null, prior?.edges ?? []);

  const changeBody = (id: BodyId): void => {
    setBodyId(id);
    useSessionStore.getState().setEdgePickBodyId(id);
  };

  const okDisabled = bodyId === null || pickedEdges.length === 0 || !(distanceMm > 0);

  const submit = (): void => {
    if (bodyId === null) return;
    const ids = existingIds(document);
    const op: ChamferOp = {
      type: 'Chamfer',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Chamfer'),
      suppressed: prior?.suppressed ?? false,
      bodyId,
      edges: pickedEdges,
      distanceMm,
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.chamfer')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <EdgePickControls bodyId={bodyId} onBodyChange={changeBody} />
      <NumberRow labelKey="dialog.chamferDistance" value={distanceMm} onChange={setDistanceMm} />
    </DialogFrame>
  );
}
