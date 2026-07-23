import { useState } from 'react';
import { t } from '../../i18n/t';
import type { DatumPlaneSpec, SketchPlaneChoice } from './useSketcher';
import styles from './Sketcher.module.css';

/**
 * Base-plane chooser shown after "New Sketch" (F2 plane selection). Picking a
 * plane creates the sketch on it; the camera then animates normal-to-plane.
 * A **Datum** sub-form (#5) creates an offset/tilted construction plane from a
 * base origin plane. Face-of-body planes resolve worker-side.
 */
export interface PlanePickerProps {
  readonly onChoose: (plane: SketchPlaneChoice) => void;
  readonly onChooseDatum: (spec: DatumPlaneSpec) => void;
  readonly onPickFace: () => void;
  readonly onCancel: () => void;
}

const PLANES = [
  { id: 'XY', labelKey: 'viewport.origin.xy' },
  { id: 'XZ', labelKey: 'viewport.origin.xz' },
  { id: 'YZ', labelKey: 'viewport.origin.yz' },
] as const;

const BASES: readonly DatumPlaneSpec['base'][] = ['XY', 'XZ', 'YZ'];
const AXES: readonly DatumPlaneSpec['tiltAxis'][] = ['X', 'Y', 'Z'];

export function PlanePicker({
  onChoose,
  onChooseDatum,
  onPickFace,
  onCancel,
}: PlanePickerProps): React.JSX.Element {
  const [datumOpen, setDatumOpen] = useState(false);
  const [base, setBase] = useState<DatumPlaneSpec['base']>('XY');
  const [offsetMm, setOffsetMm] = useState(10);
  const [tiltDeg, setTiltDeg] = useState(0);
  const [tiltAxis, setTiltAxis] = useState<DatumPlaneSpec['tiltAxis']>('X');

  return (
    <div className={styles.planePicker} data-testid="plane-picker">
      <span className={styles.planePickerPrompt}>{t('sketch.choosePlane')}</span>
      <div className={styles.planePickerRow}>
        {PLANES.map((plane) => (
          <button
            key={plane.id}
            type="button"
            className={styles.button}
            data-testid={`plane-choice-${plane.id}`}
            onClick={() => {
              onChoose(plane.id);
            }}
          >
            {t(plane.labelKey)}
          </button>
        ))}
        <button
          type="button"
          className={styles.button}
          data-testid="plane-choice-face"
          onClick={onPickFace}
        >
          {t('sketch.pickFace')}
        </button>
        <button
          type="button"
          className={styles.button}
          data-testid="plane-choice-datum"
          onClick={() => {
            setDatumOpen((v) => !v);
          }}
        >
          {t('sketch.datumPlane')}
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          {t('dialog.cancel')}
        </button>
      </div>
      {datumOpen && (
        <div className={styles.planePickerRow} data-testid="datum-form">
          <label className={styles.field}>
            <span>{t('sketch.datum.base')}</span>
            <select
              className={styles.input}
              value={base}
              onChange={(e) => {
                setBase(e.target.value as DatumPlaneSpec['base']);
              }}
            >
              {BASES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>{t('sketch.datum.offset')}</span>
            <input
              type="number"
              className={styles.input}
              value={Number.isFinite(offsetMm) ? offsetMm : ''}
              onChange={(e) => {
                setOffsetMm(Number.parseFloat(e.target.value));
              }}
            />
          </label>
          <label className={styles.field}>
            <span>{t('sketch.datum.tilt')}</span>
            <input
              type="number"
              className={styles.input}
              value={Number.isFinite(tiltDeg) ? tiltDeg : ''}
              onChange={(e) => {
                setTiltDeg(Number.parseFloat(e.target.value));
              }}
            />
          </label>
          <label className={styles.field}>
            <span>{t('sketch.datum.tiltAxis')}</span>
            <select
              className={styles.input}
              value={tiltAxis}
              onChange={(e) => {
                setTiltAxis(e.target.value as DatumPlaneSpec['tiltAxis']);
              }}
            >
              {AXES.map((ax) => (
                <option key={ax} value={ax}>
                  {ax}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.button}
            data-testid="datum-create"
            disabled={!Number.isFinite(offsetMm) || !Number.isFinite(tiltDeg)}
            onClick={() => {
              onChooseDatum({ base, offsetMm, tiltDeg, tiltAxis });
            }}
          >
            {t('sketch.datum.create')}
          </button>
        </div>
      )}
    </div>
  );
}
