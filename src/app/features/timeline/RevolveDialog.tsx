import { useMemo, useState } from 'react';
import { createId, type BodyId, type EntityId, type ProfileId, type SketchId } from '../../../core';
import {
  findSketch,
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
  useSketchProfiles,
} from './dialogData';
import { t } from '../../i18n/t';

/** Encodes a revolve axis as a stable select value ("origin:X" / "entity:<id>"). */
function axisValue(axis: RevolveAxis): string {
  return axis.kind === 'origin' ? `origin:${axis.axis}` : `entity:${axis.entityId}`;
}

function parseAxis(value: string): RevolveAxis {
  if (value === 'origin:X' || value === 'origin:Y' || value === 'origin:Z') {
    return { kind: 'origin', axis: value.slice('origin:'.length) as 'X' | 'Y' | 'Z' };
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

  const profiles = useSketchProfiles(sketchId);

  // Axis (centerline) lines are offered first and named "Axis N"; plain lines
  // remain valid revolve axes but sit after the origin axes.
  const axisOptions = useMemo<readonly SelectOption<string>[]>(() => {
    const sketch = sketchId ? findSketch(document, sketchId) : null;
    const axisOpts: SelectOption<string>[] = [];
    const lineOpts: SelectOption<string>[] = [];
    for (const e of sketch?.entities ?? []) {
      if (e.type !== 'line') continue;
      if (e.axis) {
        axisOpts.push({
          value: `entity:${e.id}`,
          label: `${t('sketch.tool.axis')} ${String(axisOpts.length + 1)}`,
        });
      } else {
        lineOpts.push({
          value: `entity:${e.id}`,
          label: `${t('sketch.tool.line')} ${String(lineOpts.length + 1)}`,
        });
      }
    }
    return [...axisOpts, ...ORIGIN_AXES, ...lineOpts];
  }, [document, sketchId]);

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
    !(Math.abs(angleDeg) > 0) ||
    Math.abs(angleDeg) > 360 ||
    (needsTarget && targetBodyId === null);

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
          options={targetOptions(liveBodyIds, prior?.bodyId)}
          onChange={setTargetBodyId}
        />
      )}
    </DialogFrame>
  );
}
