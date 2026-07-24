import { useMemo, useState } from 'react';
import {
  createId,
  type BodyId,
  type DatumId,
  type EntityId,
  type OpId,
  type ProfileId,
  type SketchId,
} from '../../../core';
import {
  findSketch,
  isDatumAxis,
  type BooleanOperation,
  type RevolveAxis,
  type RevolveOp,
} from '../../../document';
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
  BODY_TYPE_OPTIONS,
  initialBodyType,
  type BodyType,
} from './dialogData';
import { usePreview } from './usePreview';
import { t } from '../../i18n/t';

/** Encodes a revolve axis as a stable select value ("origin:X" / "entity:<id>" / "datum:<id>"). */
function axisValue(axis: RevolveAxis): string {
  if (axis.kind === 'origin') return `origin:${axis.axis}`;
  if (axis.kind === 'datum') return `datum:${axis.datumId}`;
  return `entity:${axis.entityId}`;
}

function parseAxis(value: string): RevolveAxis {
  if (value === 'origin:X' || value === 'origin:Y' || value === 'origin:Z') {
    return { kind: 'origin', axis: value.slice('origin:'.length) as 'X' | 'Y' | 'Z' };
  }
  if (value.startsWith('datum:')) {
    return { kind: 'datum', datumId: value.slice('datum:'.length) as DatumId };
  }
  return { kind: 'entity', entityId: value.slice('entity:'.length) as EntityId };
}

const ORIGIN_AXES: readonly SelectOption<string>[] = [
  { value: 'origin:X', label: t('dialog.axis.origin.X') },
  { value: 'origin:Y', label: t('dialog.axis.origin.Y') },
  { value: 'origin:Z', label: t('dialog.axis.origin.Z') },
];

/** Revolve create/edit dialog (F3): profiles + axis (origin or same-sketch line) + angle. */
export function RevolveDialog({ editing, onClose }: OpDialogProps): React.JSX.Element | null {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const prior = editing?.type === 'Revolve' ? editing : null;

  const [sketchId, setSketchId] = useState<SketchId | null>(
    prior?.sketchId ?? document.sketches[0]?.id ?? null
  );
  const [selected, setSelected] = useState<ReadonlySet<ProfileId>>(
    new Set(prior?.profileIds ?? [])
  );
  const [angleDeg, setAngleDeg] = useState(prior?.angleDeg ?? 360);
  const [axis, setAxis] = useState<string>(axisValue(prior?.axis ?? { kind: 'origin', axis: 'Y' }));
  const [operation, setOperation] = useState<BooleanOperation>(prior?.operation ?? 'NewBody');
  const [targetBodyId, setTargetBodyId] = useState<BodyId | null>(prior?.targetBodyId ?? null);
  const [wallThicknessMm, setWallThicknessMm] = useState(prior?.wallThicknessMm ?? 0);
  const [bodyType, setBodyType] = useState<BodyType>(
    initialBodyType(prior?.asSurface ?? false, prior?.wallThicknessMm ?? 0)
  );
  const asSurface = bodyType === 'surface';
  const effectiveWallMm = bodyType === 'thin' ? wallThicknessMm : 0;
  const effectiveOperation: BooleanOperation = asSurface ? 'NewBody' : operation;

  const profiles = useSketchProfiles(sketchId);
  const parsedAxis = parseAxis(axis);
  useProfileHighlight(
    sketchId,
    selected,
    profiles,
    parsedAxis.kind === 'entity' ? parsedAxis.entityId : null
  );

  const targets = targetOptions(document, liveBodyIds, prior?.bodyId);
  // Auto-select a target body for a boolean op so OK is immediately actionable (#6).
  const chooseOperation = (op: BooleanOperation): void => {
    setOperation(op);
    if (op !== 'NewBody') {
      if (targetBodyId === null && targets[0]) setTargetBodyId(targets[0].value);
    } else {
      setTargetBodyId(null);
    }
  };

  // Only reference geometry is offered as a revolve axis (#3): centerline
  // "Axis N" lines and X-toggled "Construction N" lines from the sketch, plus
  // origin axes and reusable construction axes. Plain shape lines are hidden —
  // they clutter the list and are rarely the intended axis.
  const axisOptions = useMemo<readonly SelectOption<string>[]>(() => {
    const sketch = sketchId ? findSketch(document, sketchId) : null;
    const axisOpts: SelectOption<string>[] = [];
    const constructionOpts: SelectOption<string>[] = [];
    for (const e of sketch?.entities ?? []) {
      if (e.type !== 'line') continue;
      if (e.axis) {
        axisOpts.push({
          value: `entity:${e.id}`,
          label: `${t('sketch.tool.axis')} ${String(axisOpts.length + 1)}`,
        });
      } else if (e.construction) {
        constructionOpts.push({
          value: `entity:${e.id}`,
          label: `${t('sketch.construction')} ${String(constructionOpts.length + 1)}`,
        });
      }
    }
    const datumOpts = document.datums
      .filter(isDatumAxis)
      .map((d) => ({ value: `datum:${d.id}`, label: d.name }));
    return [...axisOpts, ...constructionOpts, ...ORIGIN_AXES, ...datumOpts];
  }, [document, sketchId]);

  const toggle = (id: ProfileId): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const needsTarget = !asSurface && operation !== 'NewBody';
  const okDisabled =
    sketchId === null ||
    selected.size === 0 ||
    !(Math.abs(angleDeg) > 0) ||
    Math.abs(angleDeg) > 360 ||
    (needsTarget && targetBodyId === null) ||
    (bodyType === 'thin' && wallThicknessMm <= 0);

  // Live ghost preview (F3): a valid draft revolve (creating, not editing).
  const previewSketchId = prior || okDisabled ? null : sketchId;
  const draft: RevolveOp | null =
    previewSketchId === null
      ? null
      : {
          type: 'Revolve',
          id: 'preview-op' as OpId,
          name: 'preview',
          suppressed: false,
          sketchId: previewSketchId,
          profileIds: [...selected],
          axis: parsedAxis,
          angleDeg,
          operation: effectiveOperation,
          targetBodyId: needsTarget ? targetBodyId : null,
          wallThicknessMm: effectiveWallMm,
          asSurface,
          bodyId: 'preview-body' as BodyId,
        };
  usePreview(draft);

  const submit = (): void => {
    if (sketchId === null) return;
    const ids = existingIds(document);
    const op: RevolveOp = {
      type: 'Revolve',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Revolve'),
      suppressed: prior?.suppressed ?? false,
      sketchId,
      profileIds: [...selected],
      axis: parseAxis(axis),
      angleDeg,
      operation: effectiveOperation,
      targetBodyId: needsTarget ? targetBodyId : null,
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
    <DialogFrame title={t('op.revolve')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
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
      <NumberRow labelKey="dialog.angle" value={angleDeg} onChange={setAngleDeg} />
      <SelectRow<string>
        labelKey="dialog.axis"
        value={axis}
        options={axisOptions}
        onChange={setAxis}
      />
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
      {!asSurface && (
        <SelectRow<BooleanOperation>
          labelKey="dialog.operation"
          value={operation}
          options={operationOptions()}
          onChange={chooseOperation}
        />
      )}
      {needsTarget && (
        <SelectRow<BodyId>
          labelKey="dialog.target"
          value={targetBodyId ?? ('' as BodyId)}
          options={targets}
          onChange={setTargetBodyId}
        />
      )}
    </DialogFrame>
  );
}
