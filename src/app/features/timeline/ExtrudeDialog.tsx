import { useCallback, useMemo, useState } from 'react';
import { createId, type BodyId, type OpId, type ProfileId, type SketchId } from '../../../core';
import type { BooleanOperation, ExtrudeDirection, ExtrudeOp } from '../../../document';
import { usePreview } from './usePreview';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import type { OpDialogProps } from './dialogTypes';
import {
  BodyChecklist,
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
  useSketchOpenProfiles,
  BODY_TYPE_OPTIONS,
  initialBodyType,
  type BodyType,
} from './dialogData';
import { t } from '../../i18n/t';

const DIRECTION_OPTIONS: readonly SelectOption<ExtrudeDirection>[] = [
  { value: 'one-side', label: t('dialog.direction.one-side') },
  { value: 'symmetric', label: t('dialog.direction.symmetric') },
  { value: 'two-sides', label: t('dialog.direction.two-sides') },
  { value: 'all', label: t('dialog.direction.all') },
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
  const [targetBodyIds, setTargetBodyIds] = useState<ReadonlySet<BodyId>>(
    new Set(prior?.targetBodyIds ?? [])
  );
  const [wallThicknessMm, setWallThicknessMm] = useState(prior?.wallThicknessMm ?? 0);
  const [bodyType, setBodyType] = useState<BodyType>(
    initialBodyType(prior?.asSurface ?? false, prior?.wallThicknessMm ?? 0)
  );
  const asSurface = bodyType === 'surface';
  const effectiveWallMm = bodyType === 'thin' ? wallThicknessMm : 0;
  const effectiveOperation: BooleanOperation = asSurface ? 'NewBody' : operation;

  const profiles = useSketchProfiles(sketchId);
  const openProfiles = useSketchOpenProfiles(sketchId);
  // Open chains are pickable only for a Surface body (#12); closed profiles
  // always. The effective selection is derived (never an effect): any open id
  // is dropped when not Surface, so a solid can't reference an open profile.
  // Memoized so their identity is stable across renders — the highlight effect
  // (which writes sessionStore, re-rendering App) must not re-fire every render.
  const pickable = useMemo(
    () => (asSurface ? [...profiles, ...openProfiles] : profiles),
    [asSurface, profiles, openProfiles]
  );
  const effectiveSelected = useMemo(() => {
    const ids = new Set(pickable.map((p) => p.id));
    return new Set([...selected].filter((id) => ids.has(id)));
  }, [selected, pickable]);
  const toggle = useCallback((id: ProfileId): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Highlight all profile regions; a 3D-view click toggles one (#11).
  useProfileHighlight(sketchId, effectiveSelected, pickable, null, toggle);

  const targets = targetOptions(document, liveBodyIds, prior?.bodyId);
  const toggleTarget = useCallback((id: BodyId): void => {
    setTargetBodyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Only bodies that still exist can stay selected as targets.
  const effectiveTargets = new Set(
    [...targetBodyIds].filter((id) => targets.some((t) => t.value === id))
  );
  // Choosing a boolean op auto-selects the first target so OK is immediately
  // actionable — otherwise Cut/Join/Intersect look "dead" until you also pick a
  // target (#6). Multiple targets can then be ticked (#3). New Body clears them.
  const chooseOperation = (op: BooleanOperation): void => {
    setOperation(op);
    if (op !== 'NewBody') {
      if (effectiveTargets.size === 0 && targets[0]) setTargetBodyIds(new Set([targets[0].value]));
    } else {
      setTargetBodyIds(new Set());
    }
  };

  const needsTarget = !asSurface && operation !== 'NewBody';
  const throughAll = direction === 'all';
  const okDisabled =
    sketchId === null ||
    effectiveSelected.size === 0 ||
    (!throughAll && (!Number.isFinite(distanceMm) || distanceMm === 0)) ||
    (direction === 'two-sides' && !(distance2Mm > 0)) ||
    (needsTarget && effectiveTargets.size === 0) ||
    (bodyType === 'thin' && wallThicknessMm <= 0);

  // Live ghost preview (F3): while creating (not editing), feed a draft op with
  // stable sentinel ids to the preview pipeline whenever the params are valid.
  const previewSketchId = prior || okDisabled ? null : sketchId;
  const draft: ExtrudeOp | null =
    previewSketchId === null
      ? null
      : {
          type: 'Extrude',
          id: 'preview-op' as OpId,
          name: 'preview',
          suppressed: false,
          sketchId: previewSketchId,
          profileIds: [...effectiveSelected],
          distanceMm,
          direction,
          distance2Mm,
          operation: effectiveOperation,
          targetBodyIds: needsTarget ? [...effectiveTargets] : [],
          wallThicknessMm: effectiveWallMm,
          asSurface,
          bodyId: 'preview-body' as BodyId,
        };
  usePreview(draft);

  const submit = (): void => {
    if (sketchId === null) return;
    const ids = existingIds(document);
    const op: ExtrudeOp = {
      type: 'Extrude',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Extrude'),
      suppressed: prior?.suppressed ?? false,
      sketchId,
      profileIds: [...effectiveSelected],
      distanceMm,
      direction,
      distance2Mm,
      operation: effectiveOperation,
      targetBodyIds: needsTarget ? [...effectiveTargets] : [],
      wallThicknessMm: effectiveWallMm,
      asSurface,
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
      <ProfileChecklist profiles={pickable} selected={effectiveSelected} onToggle={toggle} />
      {!throughAll && (
        <NumberRow labelKey="dialog.distance" value={distanceMm} onChange={setDistanceMm} />
      )}
      <SelectRow<ExtrudeDirection>
        labelKey="dialog.direction"
        value={direction}
        options={DIRECTION_OPTIONS}
        onChange={setDirection}
      />
      {direction === 'two-sides' && (
        <NumberRow labelKey="dialog.distance2" value={distance2Mm} onChange={setDistance2Mm} />
      )}
      <SelectRow<BodyType>
        labelKey="dialog.bodyType"
        value={bodyType}
        options={BODY_TYPE_OPTIONS}
        onChange={setBodyType}
      />
      {bodyType === 'thin' && (
        <NumberRow
          labelKey="dialog.wallThickness"
          value={wallThicknessMm}
          onChange={setWallThicknessMm}
        />
      )}
      {/* A surface body is always a new body — no boolean op/target. */}
      {!asSurface && (
        <SelectRow<BooleanOperation>
          labelKey="dialog.operation"
          value={operation}
          options={operationOptions()}
          onChange={chooseOperation}
        />
      )}
      {needsTarget && (
        <BodyChecklist<BodyId>
          labelKey="dialog.target"
          options={targets}
          selected={effectiveTargets}
          onToggle={toggleTarget}
        />
      )}
    </DialogFrame>
  );
}
