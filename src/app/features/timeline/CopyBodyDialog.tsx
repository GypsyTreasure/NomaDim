import { useCallback, useState } from 'react';
import { createId, type BodyId } from '../../../core';
import type { BodyInstance, CopyBodyOp } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { t } from '../../i18n/t';
import type { OpDialogProps } from './dialogTypes';
import { BodyChecklist, DialogFrame, NumberRow } from './dialogShared';
import { existingIds, mintName, targetOptions } from './dialogData';

/** Copy Body create/edit dialog (F9): one or more source bodies + optional
 * XYZ translation/rotation. Each selected source produces its own copy (#3). */
export function CopyBodyDialog({ editing, onClose }: OpDialogProps): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const prior = editing?.type === 'CopyBody' ? editing : null;

  const priorSources = prior
    ? [prior.sourceBodyId, ...(prior.extraInstances ?? []).map((i) => i.sourceBodyId)]
    : liveBodyIds[0]
      ? [liveBodyIds[0]]
      : [];
  const [sourceIds, setSourceIds] = useState<ReadonlySet<BodyId>>(new Set(priorSources));
  const [tx, setTx] = useState(prior?.translate[0] ?? 0);
  const [ty, setTy] = useState(prior?.translate[1] ?? 0);
  const [tz, setTz] = useState(prior?.translate[2] ?? 0);
  const [rx, setRx] = useState(prior?.rotate[0] ?? 0);
  const [ry, setRy] = useState(prior?.rotate[1] ?? 0);
  const [rz, setRz] = useState(prior?.rotate[2] ?? 0);

  // A copy can't target its own produced ids; offer every live body as a source.
  const options = targetOptions(document, liveBodyIds);
  const effective = new Set([...sourceIds].filter((id) => options.some((o) => o.value === id)));
  const toggle = useCallback((id: BodyId): void => {
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
    // Preserve each source's produced body id across an edit (stable downstream
    // refs); mint for newly-added sources.
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
    const op: CopyBodyOp = {
      type: 'CopyBody',
      id: prior?.id ?? createId<'OpId'>(idPool),
      name: prior?.name ?? mintName(document, 'Copy'),
      suppressed: prior?.suppressed ?? false,
      sourceBodyId: first,
      translate: [tx, ty, tz],
      rotate: [rx, ry, rz],
      bodyId: producedFor(first),
      ...(extraInstances.length > 0 ? { extraInstances } : {}),
    };
    const result = commandBus.dispatch(
      prior ? { type: 'EditOp', payload: { op } } : { type: 'AddOp', payload: { op } }
    );
    if (result.ok) onClose();
  };

  return (
    <DialogFrame title={t('op.copyBody')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <BodyChecklist<BodyId>
        labelKey="dialog.source"
        options={options}
        selected={effective}
        onToggle={toggle}
      />
      <NumberRow labelKey="dialog.translateX" value={tx} onChange={setTx} />
      <NumberRow labelKey="dialog.translateY" value={ty} onChange={setTy} />
      <NumberRow labelKey="dialog.translateZ" value={tz} onChange={setTz} />
      <NumberRow labelKey="dialog.rotateX" value={rx} onChange={setRx} />
      <NumberRow labelKey="dialog.rotateY" value={ry} onChange={setRy} />
      <NumberRow labelKey="dialog.rotateZ" value={rz} onChange={setRz} />
    </DialogFrame>
  );
}
