import { useEffect, useMemo, useState } from 'react';
import { createId, type DatumId } from '../../../core';
import {
  type Datum,
  type DatumAxis,
  type DatumBaseAxis,
  type DatumBasePlane,
  type DatumPlane,
} from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useConstructStore } from '../../store/constructStore';
import { t } from '../../i18n/t';
import { DialogFrame, NumberRow, SelectRow, type SelectOption } from '../timeline/dialogShared';

const PLANE_BASES: readonly SelectOption<DatumBasePlane>[] = [
  { value: 'XY', label: 'XY' },
  { value: 'XZ', label: 'XZ' },
  { value: 'YZ', label: 'YZ' },
];
const AXES: readonly SelectOption<DatumBaseAxis>[] = [
  { value: 'X', label: 'X' },
  { value: 'Y', label: 'Y' },
  { value: 'Z', label: 'Z' },
];

/** Mints a unique DatumId and a default "Plane N" / "Axis N" name. */
function nextDatumIdentity(kind: Datum['kind']): { id: DatumId; name: string } {
  const datums = useDocumentStore.getState().document.datums;
  const id = createId<'DatumId'>(new Set(datums.map((d) => d.id)));
  const label = kind === 'plane' ? 'Plane' : 'Axis';
  const n = datums.filter((d) => d.kind === kind).length + 1;
  return { id, name: `${label}${String(n)}` };
}

/**
 * Create/edit dialog for a construction plane or axis (Fusion "Construct"),
 * with a live amber preview that follows the fields (setPreview → viewport
 * ghost). Only mounted while a dialog is open (keyed per open so state resets).
 */
export function ConstructDialog(): React.JSX.Element | null {
  const open = useConstructStore((s) => s.open);
  const setPreview = useConstructStore((s) => s.setPreview);
  const close = useConstructStore((s) => s.close);
  const editing = open?.editing ?? null;
  const editingPlane = editing?.kind === 'plane' ? editing : null;
  const editingAxis = editing?.kind === 'axis' ? editing : null;

  // Plane fields.
  const [planeBase, setPlaneBase] = useState<DatumBasePlane>(editingPlane?.base ?? 'XY');
  const [offsetMm, setOffsetMm] = useState(editingPlane?.offsetMm ?? 10);
  const [tiltDeg, setTiltDeg] = useState(editingPlane?.tiltDeg ?? 0);
  const [tiltAxis, setTiltAxis] = useState<DatumBaseAxis>(editingPlane?.tiltAxis ?? 'X');

  // Axis fields.
  const [axisBase, setAxisBase] = useState<DatumBaseAxis>(editingAxis?.base ?? 'Z');
  const [ox, setOx] = useState(editingAxis?.offset[0] ?? 0);
  const [oy, setOy] = useState(editingAxis?.offset[1] ?? 0);
  const [oz, setOz] = useState(editingAxis?.offset[2] ?? 0);
  const [angleDeg, setAngleDeg] = useState(editingAxis?.angleDeg ?? 0);
  const [angleAxis, setAngleAxis] = useState<DatumBaseAxis>(editingAxis?.angleAxis ?? 'Y');

  const kind = open?.kind ?? 'plane';
  // Minted once per mount (App keys the dialog per open) so the preview id is
  // stable while editing; an edit keeps the existing datum's identity.
  const [identity] = useState(() =>
    editing
      ? { id: editing.id, name: editing.name, visible: editing.visible }
      : { ...nextDatumIdentity(kind), visible: true }
  );

  // Memoized so its identity changes only when a field changes — otherwise the
  // preview effect below would setPreview → re-render → new draft → loop.
  const draft = useMemo<Datum | null>(() => {
    if (kind === 'plane') {
      if (!Number.isFinite(offsetMm) || !Number.isFinite(tiltDeg)) return null;
      return {
        ...identity,
        kind: 'plane',
        base: planeBase,
        offsetMm,
        tiltDeg,
        tiltAxis,
      } satisfies DatumPlane;
    }
    if (![ox, oy, oz, angleDeg].every(Number.isFinite)) return null;
    return {
      ...identity,
      kind: 'axis',
      base: axisBase,
      offset: [ox, oy, oz],
      angleDeg,
      angleAxis,
    } satisfies DatumAxis;
  }, [
    kind,
    identity,
    planeBase,
    offsetMm,
    tiltDeg,
    tiltAxis,
    axisBase,
    ox,
    oy,
    oz,
    angleDeg,
    angleAxis,
  ]);

  // Push the current draft to the viewport as an amber ghost while editing.
  useEffect(() => {
    setPreview(draft);
    return () => {
      setPreview(null);
    };
  }, [draft, setPreview]);

  if (!open) return null;

  const submit = (): void => {
    if (!draft) return;
    const result = commandBus.dispatch(
      editing
        ? { type: 'EditDatum', payload: { datum: draft } }
        : { type: 'AddDatum', payload: { datum: draft } }
    );
    if (result.ok) close();
  };

  return (
    <DialogFrame
      title={kind === 'plane' ? t('construct.plane') : t('construct.axis')}
      okDisabled={draft === null}
      onOk={submit}
      onCancel={close}
    >
      {kind === 'plane' ? (
        <>
          <SelectRow<DatumBasePlane>
            labelKey="construct.base"
            value={planeBase}
            options={PLANE_BASES}
            onChange={setPlaneBase}
          />
          <NumberRow labelKey="construct.offset" value={offsetMm} onChange={setOffsetMm} />
          <NumberRow labelKey="construct.angle" value={tiltDeg} onChange={setTiltDeg} />
          <SelectRow<DatumBaseAxis>
            labelKey="construct.aboutAxis"
            value={tiltAxis}
            options={AXES}
            onChange={setTiltAxis}
          />
        </>
      ) : (
        <>
          <SelectRow<DatumBaseAxis>
            labelKey="construct.base"
            value={axisBase}
            options={AXES}
            onChange={setAxisBase}
          />
          <NumberRow labelKey="construct.offsetX" value={ox} onChange={setOx} />
          <NumberRow labelKey="construct.offsetY" value={oy} onChange={setOy} />
          <NumberRow labelKey="construct.offsetZ" value={oz} onChange={setOz} />
          <NumberRow labelKey="construct.angle" value={angleDeg} onChange={setAngleDeg} />
          <SelectRow<DatumBaseAxis>
            labelKey="construct.aboutAxis"
            value={angleAxis}
            options={AXES}
            onChange={setAngleAxis}
          />
        </>
      )}
    </DialogFrame>
  );
}
