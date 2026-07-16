import { t } from '../../i18n/t';
import type { SketchPlaneChoice } from './useSketcher';
import styles from './Sketcher.module.css';

/**
 * Base-plane chooser shown after "New Sketch" (F2 plane selection). Picking a
 * plane creates the sketch on it; the camera then animates normal-to-plane.
 * Face-of-body planes are a follow-up (they need worker-side face resolution).
 */
export interface PlanePickerProps {
  readonly onChoose: (plane: SketchPlaneChoice) => void;
  readonly onCancel: () => void;
}

const PLANES = [
  { id: 'XY', labelKey: 'viewport.origin.xy' },
  { id: 'XZ', labelKey: 'viewport.origin.xz' },
  { id: 'YZ', labelKey: 'viewport.origin.yz' },
] as const;

export function PlanePicker({ onChoose, onCancel }: PlanePickerProps): React.JSX.Element {
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
        <button type="button" className={styles.button} onClick={onCancel}>
          {t('dialog.cancel')}
        </button>
      </div>
    </div>
  );
}
