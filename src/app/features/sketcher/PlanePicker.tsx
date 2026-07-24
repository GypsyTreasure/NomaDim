import { t } from '../../i18n/t';
import type { DatumId } from '../../../core';
import type { DatumPlane } from '../../../document';
import type { SketchPlaneChoice } from './useSketcher';
import styles from './Sketcher.module.css';

/**
 * Base-plane chooser shown after "New Sketch" (F2 plane selection). Picking an
 * origin plane, a body face, or a previously-created **construction plane**
 * (from the Construct menu) creates the sketch on it; the camera then animates
 * normal-to-plane. Construction planes are created separately (not here) so the
 * plane tool is reusable across sketches, mirror, etc.
 */
export interface PlanePickerProps {
  readonly onChoose: (plane: SketchPlaneChoice) => void;
  readonly onChooseDatum: (datumId: DatumId) => void;
  readonly onPickFace: () => void;
  readonly onCancel: () => void;
  /** Construction planes available to sketch on (from `document.datums`). */
  readonly datumPlanes: readonly DatumPlane[];
}

const PLANES = [
  { id: 'XY', labelKey: 'viewport.origin.xy' },
  { id: 'XZ', labelKey: 'viewport.origin.xz' },
  { id: 'YZ', labelKey: 'viewport.origin.yz' },
] as const;

export function PlanePicker({
  onChoose,
  onChooseDatum,
  onPickFace,
  onCancel,
  datumPlanes,
}: PlanePickerProps): React.JSX.Element {
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
        <button type="button" className={styles.button} onClick={onCancel}>
          {t('dialog.cancel')}
        </button>
      </div>
      {datumPlanes.length > 0 && (
        <div className={styles.planePickerRow} data-testid="plane-choice-datums">
          <span className={styles.planePickerPrompt}>{t('sketch.constructionPlanes')}</span>
          {datumPlanes.map((datum) => (
            <button
              key={datum.id}
              type="button"
              className={styles.button}
              data-testid={`plane-choice-datum-${datum.id}`}
              onClick={() => {
                onChooseDatum(datum.id);
              }}
            >
              {datum.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
