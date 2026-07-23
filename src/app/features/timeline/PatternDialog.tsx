import { useState } from 'react';
import { createId, type BodyId } from '../../../core';
import type { OriginAxis, PatternKind, PatternOp, TransformOperation } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { DialogFrame, NumberRow, SelectRow, type SelectOption } from './dialogShared';
import { existingIds, mintName, targetOptions } from './dialogData';

const KIND_OPTIONS: readonly SelectOption<PatternKind>[] = [
  { value: 'linear', label: t('dialog.pattern.linear') },
  { value: 'circular', label: t('dialog.pattern.circular') },
];
const AXIS_OPTIONS: readonly SelectOption<OriginAxis>[] = [
  { value: 'X', label: 'X' },
  { value: 'Y', label: 'Y' },
  { value: 'Z', label: 'Z' },
];
const OPERATION_OPTIONS: readonly SelectOption<TransformOperation>[] = [
  { value: 'Join', label: t('dialog.operation.transform.Join') },
  { value: 'NewBody', label: t('dialog.operation.transform.NewBody') },
];

/** Pattern create/edit dialog (P1): linear or circular array of a body. */
export function PatternDialog({ editing, onClose }: OpDialogProps): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const prior = editing?.type === 'Pattern' ? editing : null;

  const [sourceBodyId, setSourceBodyId] = useState<BodyId | null>(
    prior?.sourceBodyId ?? liveBodyIds[0] ?? null
  );
  const [kind, setKind] = useState<PatternKind>(prior?.kind ?? 'linear');
  const [count, setCount] = useState(prior?.count ?? 3);
  const [spacingMm, setSpacingMm] = useState(prior?.spacingMm ?? 20);
  const [axis, setAxis] = useState<OriginAxis>(prior?.axis ?? 'X');
  const [angleDeg, setAngleDeg] = useState(prior?.angleDeg ?? 360);
  const [count2, setCount2] = useState(prior?.count2 ?? 1);
  const [spacingMm2, setSpacingMm2] = useState(prior?.spacingMm2 ?? 20);
  const [axis2, setAxis2] = useState<OriginAxis>(prior?.axis2 ?? 'Y');
  const [count3, setCount3] = useState(prior?.count3 ?? 1);
  const [spacingMm3, setSpacingMm3] = useState(prior?.spacingMm3 ?? 20);
  const [axis3, setAxis3] = useState<OriginAxis>(prior?.axis3 ?? 'Z');
  const [operation, setOperation] = useState<TransformOperation>(prior?.operation ?? 'Join');

  const gridInvalid =
    kind === 'linear' &&
    (!Number.isInteger(count2) ||
      count2 < 1 ||
      !Number.isInteger(count3) ||
      count3 < 1 ||
      count * count2 * count3 > 1000);
  const okDisabled =
    sourceBodyId === null ||
    !Number.isInteger(count) ||
    count < 2 ||
    gridInvalid ||
    (kind === 'linear' && !(Math.abs(spacingMm) > 0)) ||
    (kind === 'circular' && !(Math.abs(angleDeg) > 0));

  const submit = (): void => {
    if (sourceBodyId === null) return;
    const ids = existingIds(document);
    const op: PatternOp = {
      type: 'Pattern',
      id: prior?.id ?? createId<'OpId'>(ids),
      name: prior?.name ?? mintName(document, 'Pattern'),
      suppressed: prior?.suppressed ?? false,
      sourceBodyId,
      kind,
      count,
      spacingMm,
      axis,
      angleDeg,
      count2,
      spacingMm2,
      axis2,
      count3,
      spacingMm3,
      axis3,
      operation,
      bodyId: prior?.bodyId ?? createId<'BodyId'>(ids),
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.pattern')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <SelectRow<BodyId>
        labelKey="dialog.source"
        value={sourceBodyId ?? ('' as BodyId)}
        options={targetOptions(document, liveBodyIds, prior?.bodyId)}
        onChange={setSourceBodyId}
      />
      <SelectRow<PatternKind>
        labelKey="dialog.pattern.kind"
        value={kind}
        options={KIND_OPTIONS}
        onChange={setKind}
      />
      <NumberRow labelKey="dialog.pattern.count" value={count} onChange={setCount} />
      <SelectRow<OriginAxis>
        labelKey="dialog.pattern.axis"
        value={axis}
        options={AXIS_OPTIONS}
        onChange={setAxis}
      />
      {kind === 'linear' ? (
        <>
          <NumberRow labelKey="dialog.pattern.spacing" value={spacingMm} onChange={setSpacingMm} />
          <NumberRow labelKey="dialog.pattern.count2" value={count2} onChange={setCount2} />
          <SelectRow<OriginAxis>
            labelKey="dialog.pattern.axis2"
            value={axis2}
            options={AXIS_OPTIONS}
            onChange={setAxis2}
          />
          <NumberRow
            labelKey="dialog.pattern.spacing2"
            value={spacingMm2}
            onChange={setSpacingMm2}
          />
          <NumberRow labelKey="dialog.pattern.count3" value={count3} onChange={setCount3} />
          <SelectRow<OriginAxis>
            labelKey="dialog.pattern.axis3"
            value={axis3}
            options={AXIS_OPTIONS}
            onChange={setAxis3}
          />
          <NumberRow
            labelKey="dialog.pattern.spacing3"
            value={spacingMm3}
            onChange={setSpacingMm3}
          />
        </>
      ) : (
        <NumberRow labelKey="dialog.pattern.angle" value={angleDeg} onChange={setAngleDeg} />
      )}
      <SelectRow<TransformOperation>
        labelKey="dialog.operation"
        value={operation}
        options={OPERATION_OPTIONS}
        onChange={setOperation}
      />
    </DialogFrame>
  );
}
