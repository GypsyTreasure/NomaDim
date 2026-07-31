import { useEffect, useMemo, useState } from 'react';
import { createId, type DatumId } from '../../../core';
import {
  isDatumAxis,
  isDatumPlane,
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

/** Selection-value prefix marking a user-created datum (vs an origin base). */
const DATUM_PREFIX = 'datum:';

const PLANE_BASES: readonly SelectOption<string>[] = [
  { value: 'XY', label: 'XY' },
  { value: 'XZ', label: 'XZ' },
  { value: 'YZ', label: 'YZ' },
];
const AXES: readonly SelectOption<string>[] = [
  { value: 'X', label: 'X' },
  { value: 'Y', label: 'Y' },
  { value: 'Z', label: 'Z' },
];

/** Encodes a base/axis selection: an origin letter, or `datum:<id>` for a user datum. */
function encodeSel(origin: string, datumId: DatumId | undefined): string {
  return datumId ? `${DATUM_PREFIX}${datumId}` : origin;
}

/** Splits a selection back into an origin fallback and an optional datum id. */
function decodeSel(sel: string): { datumId: DatumId | undefined } {
  return sel.startsWith(DATUM_PREFIX)
    ? { datumId: sel.slice(DATUM_PREFIX.length) as DatumId }
    : { datumId: undefined };
}

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
 *
 * The base plane/axis and the rotation axis may be an origin datum OR another
 * user-created datum (ADR-0089): those extra options are appended to the base
 * and about-axis selects, the current datum excluded to avoid self-reference.
 */
export function ConstructDialog(): React.JSX.Element | null {
  const open = useConstructStore((s) => s.open);
  const setPreview = useConstructStore((s) => s.setPreview);
  const close = useConstructStore((s) => s.close);
  const datums = useDocumentStore((s) => s.document.datums);
  const editing = open?.editing ?? null;
  const editingPlane = editing?.kind === 'plane' ? editing : null;
  const editingAxis = editing?.kind === 'axis' ? editing : null;

  const kind = open?.kind ?? 'plane';
  // Minted once per mount (App keys the dialog per open) so the preview id is
  // stable while editing; an edit keeps the existing datum's identity.
  const [identity] = useState(() =>
    editing
      ? { id: editing.id, name: editing.name, visible: editing.visible }
      : { ...nextDatumIdentity(kind), visible: true }
  );

  // Plane fields.
  const [planeBaseSel, setPlaneBaseSel] = useState(
    encodeSel(editingPlane?.base ?? 'XY', editingPlane?.baseDatumId)
  );
  const [offsetMm, setOffsetMm] = useState(editingPlane?.offsetMm ?? 10);
  const [tiltDeg, setTiltDeg] = useState(editingPlane?.tiltDeg ?? 0);
  const [tiltAxisSel, setTiltAxisSel] = useState(
    encodeSel(editingPlane?.tiltAxis ?? 'X', editingPlane?.tiltAxisDatumId)
  );

  // Axis fields.
  const [axisBaseSel, setAxisBaseSel] = useState(
    encodeSel(editingAxis?.base ?? 'Z', editingAxis?.baseDatumId)
  );
  const [ox, setOx] = useState(editingAxis?.offset[0] ?? 0);
  const [oy, setOy] = useState(editingAxis?.offset[1] ?? 0);
  const [oz, setOz] = useState(editingAxis?.offset[2] ?? 0);
  const [angleDeg, setAngleDeg] = useState(editingAxis?.angleDeg ?? 0);
  const [angleAxisSel, setAngleAxisSel] = useState(
    encodeSel(editingAxis?.angleAxis ?? 'Y', editingAxis?.angleAxisDatumId)
  );

  // User datums offered as bases / rotation axes (self excluded).
  const planeOptions = useMemo<readonly SelectOption<string>[]>(
    () => [
      ...PLANE_BASES,
      ...datums
        .filter((d) => isDatumPlane(d) && d.id !== identity.id)
        .map((d) => ({ value: `${DATUM_PREFIX}${d.id}`, label: d.name })),
    ],
    [datums, identity.id]
  );
  const axisOptions = useMemo<readonly SelectOption<string>[]>(
    () => [
      ...AXES,
      ...datums
        .filter((d) => isDatumAxis(d) && d.id !== identity.id)
        .map((d) => ({ value: `${DATUM_PREFIX}${d.id}`, label: d.name })),
    ],
    [datums, identity.id]
  );

  // Memoized so its identity changes only when a field changes — otherwise the
  // preview effect below would setPreview → re-render → new draft → loop.
  const draft = useMemo<Datum | null>(() => {
    if (kind === 'plane') {
      if (!Number.isFinite(offsetMm) || !Number.isFinite(tiltDeg)) return null;
      const baseRef = decodeSel(planeBaseSel);
      const tiltRef = decodeSel(tiltAxisSel);
      return {
        ...identity,
        kind: 'plane',
        base: baseRef.datumId ? 'XY' : (planeBaseSel as DatumBasePlane),
        ...(baseRef.datumId ? { baseDatumId: baseRef.datumId } : {}),
        offsetMm,
        tiltDeg,
        tiltAxis: tiltRef.datumId ? 'X' : (tiltAxisSel as DatumBaseAxis),
        ...(tiltRef.datumId ? { tiltAxisDatumId: tiltRef.datumId } : {}),
      } satisfies DatumPlane;
    }
    if (![ox, oy, oz, angleDeg].every(Number.isFinite)) return null;
    const baseRef = decodeSel(axisBaseSel);
    const angleRef = decodeSel(angleAxisSel);
    return {
      ...identity,
      kind: 'axis',
      base: baseRef.datumId ? 'Z' : (axisBaseSel as DatumBaseAxis),
      ...(baseRef.datumId ? { baseDatumId: baseRef.datumId } : {}),
      offset: [ox, oy, oz],
      angleDeg,
      angleAxis: angleRef.datumId ? 'Y' : (angleAxisSel as DatumBaseAxis),
      ...(angleRef.datumId ? { angleAxisDatumId: angleRef.datumId } : {}),
    } satisfies DatumAxis;
  }, [
    kind,
    identity,
    planeBaseSel,
    offsetMm,
    tiltDeg,
    tiltAxisSel,
    axisBaseSel,
    ox,
    oy,
    oz,
    angleDeg,
    angleAxisSel,
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
          <SelectRow
            labelKey="construct.base"
            value={planeBaseSel}
            options={planeOptions}
            onChange={setPlaneBaseSel}
          />
          <NumberRow labelKey="construct.offset" value={offsetMm} onChange={setOffsetMm} />
          <NumberRow labelKey="construct.angle" value={tiltDeg} onChange={setTiltDeg} />
          <SelectRow
            labelKey="construct.aboutAxis"
            value={tiltAxisSel}
            options={axisOptions}
            onChange={setTiltAxisSel}
          />
        </>
      ) : (
        <>
          <SelectRow
            labelKey="construct.base"
            value={axisBaseSel}
            options={axisOptions}
            onChange={setAxisBaseSel}
          />
          <NumberRow labelKey="construct.offsetX" value={ox} onChange={setOx} />
          <NumberRow labelKey="construct.offsetY" value={oy} onChange={setOy} />
          <NumberRow labelKey="construct.offsetZ" value={oz} onChange={setOz} />
          <NumberRow labelKey="construct.angle" value={angleDeg} onChange={setAngleDeg} />
          <SelectRow
            labelKey="construct.aboutAxis"
            value={angleAxisSel}
            options={axisOptions}
            onChange={setAngleAxisSel}
          />
        </>
      )}
    </DialogFrame>
  );
}
