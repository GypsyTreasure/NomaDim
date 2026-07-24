import { useMemo, useState } from 'react';
import { createId, type BodyId, type DatumId } from '../../../core';
import {
  isDatumPlane,
  type MirrorOp,
  type OriginPlane,
  type TransformOperation,
} from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { DialogFrame, SelectRow, type SelectOption } from './dialogShared';
import { existingIds, mintName, targetOptions } from './dialogData';

const ORIGIN_PLANE_OPTIONS: readonly SelectOption<string>[] = [
  { value: 'origin:XY', label: t('dialog.plane.XY') },
  { value: 'origin:XZ', label: t('dialog.plane.XZ') },
  { value: 'origin:YZ', label: t('dialog.plane.YZ') },
];
const OPERATION_OPTIONS: readonly SelectOption<TransformOperation>[] = [
  { value: 'Join', label: t('dialog.operation.transform.Join') },
  { value: 'NewBody', label: t('dialog.operation.transform.NewBody') },
];

/** Mirror create/edit dialog (P1): source body + plane (origin OR a construction
 * plane, #datum) + Join/NewBody. */
export function MirrorDialog({ editing, onClose }: OpDialogProps): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const prior = editing?.type === 'Mirror' ? editing : null;

  const [sourceBodyId, setSourceBodyId] = useState<BodyId | null>(
    prior?.sourceBodyId ?? liveBodyIds[0] ?? null
  );
  // "origin:XY" for an origin plane, "datum:<id>" for a construction plane.
  const [planeChoice, setPlaneChoice] = useState<string>(
    prior?.datumId ? `datum:${prior.datumId}` : `origin:${prior?.plane ?? 'XY'}`
  );
  const [operation, setOperation] = useState<TransformOperation>(prior?.operation ?? 'Join');

  const planeOptions = useMemo<readonly SelectOption<string>[]>(() => {
    const datumOpts = document.datums
      .filter(isDatumPlane)
      .map((d) => ({ value: `datum:${d.id}`, label: d.name }));
    return [...ORIGIN_PLANE_OPTIONS, ...datumOpts];
  }, [document.datums]);

  const okDisabled = sourceBodyId === null;

  const submit = (): void => {
    if (sourceBodyId === null) return;
    const ids = existingIds(document);
    const isDatum = planeChoice.startsWith('datum:');
    const op: MirrorOp = {
      type: 'Mirror',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Mirror'),
      suppressed: prior?.suppressed ?? false,
      sourceBodyId,
      plane: isDatum
        ? (prior?.plane ?? 'XY')
        : (planeChoice.slice('origin:'.length) as OriginPlane),
      ...(isDatum ? { datumId: planeChoice.slice('datum:'.length) as DatumId } : {}),
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
      <SelectRow<string>
        labelKey="dialog.plane"
        value={planeChoice}
        options={planeOptions}
        onChange={setPlaneChoice}
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
