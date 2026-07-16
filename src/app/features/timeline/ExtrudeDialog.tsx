import { useState } from 'react';
import { createId, type BodyId, type ProfileId, type SketchId } from '../../../core';
import type { BooleanOperation, ExtrudeDirection, ExtrudeOp } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import type { OpDialogProps } from './dialogTypes';
import {
  DialogFrame,
  NumberRow,
  ProfileChecklist,
  SelectRow,
  type SelectOption,
} from './dialogShared';
import {
  existingIds,
  mintName,
  operationOptions,
  sketchOptions,
  targetOptions,
  useProfileHighlight,
  useSketchProfiles,
} from './dialogData';
import { t } from '../../i18n/t';

const DIRECTION_OPTIONS: readonly SelectOption<ExtrudeDirection>[] = [
  { value: 'one-side', label: t('dialog.direction.one-side') },
  { value: 'symmetric', label: t('dialog.direction.symmetric') },
  { value: 'two-sides', label: t('dialog.direction.two-sides') },
];

/** Extrude create/edit dialog (F3): profiles + distance + direction + boolean op. */
export function ExtrudeDialog({ editing, onClose }: OpDialogProps): React.JSX.Element | null {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const prior = editing?.type === 'Extrude' ? editing : null;

  const [sketchId, setSketchId] = useState<SketchId | null>(
    prior?.sketchId ?? document.sketches[0]?.id ?? null
  );
  const [selected, setSelected] = useState<ReadonlySet<ProfileId>>(
    new Set(prior?.profileIds ?? [])
  );
  const [distanceMm, setDistanceMm] = useState(prior?.distanceMm ?? 10);
  const [direction, setDirection] = useState<ExtrudeDirection>(prior?.direction ?? 'one-side');
  const [distance2Mm, setDistance2Mm] = useState(prior?.distance2Mm ?? 10);
  const [operation, setOperation] = useState<BooleanOperation>(prior?.operation ?? 'NewBody');
  const [targetBodyId, setTargetBodyId] = useState<BodyId | null>(prior?.targetBodyId ?? null);

  const profiles = useSketchProfiles(sketchId);
  useProfileHighlight(sketchId, selected, profiles);

  const toggle = (id: ProfileId): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const needsTarget = operation !== 'NewBody';
  const okDisabled =
    sketchId === null ||
    selected.size === 0 ||
    !Number.isFinite(distanceMm) ||
    distanceMm === 0 ||
    (direction === 'two-sides' && !(distance2Mm > 0)) ||
    (needsTarget && targetBodyId === null);

  const submit = (): void => {
    if (sketchId === null) return;
    const ids = existingIds(document);
    const op: ExtrudeOp = {
      type: 'Extrude',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Extrude'),
      suppressed: prior?.suppressed ?? false,
      sketchId,
      profileIds: [...selected],
      distanceMm,
      direction,
      distance2Mm,
      operation,
      targetBodyId: needsTarget ? targetBodyId : null,
      bodyId: prior?.bodyId ?? createId<'BodyId'>(ids),
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.extrude')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <SelectRow<SketchId>
        labelKey="dialog.sketch"
        value={sketchId ?? ('' as SketchId)}
        options={sketchOptions(document)}
        onChange={(id) => {
          setSketchId(id);
          setSelected(new Set());
        }}
      />
      <ProfileChecklist profiles={profiles} selected={selected} onToggle={toggle} />
      <NumberRow labelKey="dialog.distance" value={distanceMm} onChange={setDistanceMm} />
      <SelectRow<ExtrudeDirection>
        labelKey="dialog.direction"
        value={direction}
        options={DIRECTION_OPTIONS}
        onChange={setDirection}
      />
      {direction === 'two-sides' && (
        <NumberRow labelKey="dialog.distance2" value={distance2Mm} onChange={setDistance2Mm} />
      )}
      <SelectRow<BooleanOperation>
        labelKey="dialog.operation"
        value={operation}
        options={operationOptions()}
        onChange={setOperation}
      />
      {needsTarget && (
        <SelectRow<BodyId>
          labelKey="dialog.target"
          value={targetBodyId ?? ('' as BodyId)}
          options={targetOptions(document, liveBodyIds, prior?.bodyId)}
          onChange={setTargetBodyId}
        />
      )}
    </DialogFrame>
  );
}
