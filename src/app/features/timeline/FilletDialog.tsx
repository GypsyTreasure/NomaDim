import { useState } from 'react';
import { createId, type BodyId } from '../../../core';
import type { FilletOp } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { useSessionStore } from '../../store/sessionStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { DialogFrame, NumberRow } from './dialogShared';
import { EdgePickControls } from './EdgePickControls';
import { existingIds, mintName, useEdgePickLifecycle } from './dialogData';

/** Fillet create/edit dialog (F4): target body + picked edges + single radius. */
export function FilletDialog({ editing, onClose }: OpDialogProps): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const pickedEdges = useSessionStore((s) => s.pickedEdges);
  const prior = editing?.type === 'Fillet' ? editing : null;

  const [bodyId, setBodyId] = useState<BodyId | null>(prior?.bodyId ?? liveBodyIds[0] ?? null);
  const [radiusMm, setRadiusMm] = useState(prior?.radiusMm ?? 2);

  useEdgePickLifecycle(prior?.bodyId ?? liveBodyIds[0] ?? null, prior?.edges ?? []);

  const changeBody = (id: BodyId): void => {
    setBodyId(id);
    useSessionStore.getState().setEdgePickBodyId(id);
  };

  const okDisabled = bodyId === null || pickedEdges.length === 0 || !(radiusMm > 0);

  const submit = (): void => {
    if (bodyId === null) return;
    const ids = existingIds(document);
    const op: FilletOp = {
      type: 'Fillet',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Fillet'),
      suppressed: prior?.suppressed ?? false,
      bodyId,
      edges: pickedEdges,
      radiusMm,
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.fillet')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <EdgePickControls bodyId={bodyId} onBodyChange={changeBody} />
      <NumberRow labelKey="dialog.radius" value={radiusMm} onChange={setRadiusMm} />
    </DialogFrame>
  );
}
