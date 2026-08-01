import { useCallback, useMemo, useState } from 'react';
import { createId, type BodyId, type DatumId } from '../../../core';
import {
  isDatumPlane,
  type BodyInstance,
  type MirrorOp,
  type OriginPlane,
  type TransformOperation,
} from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { BodyChecklist, DialogFrame, SelectRow, type SelectOption } from './dialogShared';
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

  const priorSources = prior
    ? [prior.sourceBodyId, ...(prior.extraInstances ?? []).map((i) => i.sourceBodyId)]
    : liveBodyIds[0]
      ? [liveBodyIds[0]]
      : [];
  const [sourceIds, setSourceIds] = useState<ReadonlySet<BodyId>>(new Set(priorSources));
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

  const bodyOptions = targetOptions(document, liveBodyIds);
  const effective = new Set([...sourceIds].filter((id) => bodyOptions.some((o) => o.value === id)));
  const toggleSource = useCallback((id: BodyId): void => {
    setSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const okDisabled = effective.size === 0;

  const submit = (): void => {
    if (effective.size === 0) return;
    const idPool = existingIds(document);
    const mintBody = (): BodyId => {
      const id = createId<'BodyId'>(idPool);
      idPool.add(id);
      return id;
    };
    const priorBody = new Map<BodyId, BodyId>();
    if (prior) {
      priorBody.set(prior.sourceBodyId, prior.bodyId);
      for (const i of prior.extraInstances ?? []) priorBody.set(i.sourceBodyId, i.bodyId);
    }
    const producedFor = (source: BodyId): BodyId => priorBody.get(source) ?? mintBody();
    const [first, ...rest] = [...effective];
    if (first === undefined) return;
    const extraInstances: BodyInstance[] = rest.map((source) => ({
      sourceBodyId: source,
      bodyId: producedFor(source),
    }));
    const isDatum = planeChoice.startsWith('datum:');
    const op: MirrorOp = {
      type: 'Mirror',
      id: prior?.id ?? createId<'OpId'>(idPool),
      name: prior?.name ?? mintName(document, 'Mirror'),
      suppressed: prior?.suppressed ?? false,
      sourceBodyId: first,
      plane: isDatum
        ? (prior?.plane ?? 'XY')
        : (planeChoice.slice('origin:'.length) as OriginPlane),
      ...(isDatum ? { datumId: planeChoice.slice('datum:'.length) as DatumId } : {}),
      operation,
      bodyId: producedFor(first),
      ...(extraInstances.length > 0 ? { extraInstances } : {}),
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.mirror')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <BodyChecklist<BodyId>
        labelKey="dialog.source"
        options={bodyOptions}
        selected={effective}
        onToggle={toggleSource}
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
