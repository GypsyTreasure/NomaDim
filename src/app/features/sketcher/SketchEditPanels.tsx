import { useState } from 'react';
import { t } from '../../i18n/t';
import type { OffsetSide } from '../../../sketch';
import type { SketcherApi } from './useSketcher';
import styles from './Sketcher.module.css';

/**
 * Typed-value dialogs for the AutoCAD-parity edit tools (#2, #3). Both read an
 * EXACT number typed on the keyboard and apply it to the current selection /
 * captured point set — never a mouse-drag estimate:
 *  - Offset: pick geometry (click/marquee), type a Distance + Side, Apply →
 *    offsets the whole selection (lines, loops, circles/arcs) at once.
 *  - Move / Stretch: box a point set, type ΔX/ΔY, Apply → translates exactly.
 * Shown inline in the sketch toolbar only while the matching tool is active.
 */
export function SketchEditPanels({
  sketcher,
}: {
  sketcher: SketcherApi;
}): React.JSX.Element | null {
  const [distanceMm, setDistanceMm] = useState(5);
  const [side, setSide] = useState<OffsetSide>('a');
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);

  if (sketcher.tool === 'offset') {
    const distanceValid = Number.isFinite(distanceMm) && distanceMm > 0;
    return (
      <div className={styles.planePickerRow} data-testid="offset-panel">
        <label className={styles.field}>
          <span>{t('sketch.offset.distance')}</span>
          <input
            type="number"
            className={styles.input}
            data-testid="offset-distance"
            value={Number.isFinite(distanceMm) ? distanceMm : ''}
            onChange={(e) => {
              setDistanceMm(Number.parseFloat(e.target.value));
            }}
          />
        </label>
        <label className={styles.field}>
          <span>{t('sketch.offset.side')}</span>
          <select
            className={styles.input}
            data-testid="offset-side"
            value={side}
            onChange={(e) => {
              setSide(e.target.value as OffsetSide);
            }}
          >
            <option value="a">{t('sketch.offset.sideA')}</option>
            <option value="b">{t('sketch.offset.sideB')}</option>
          </select>
        </label>
        <button
          type="button"
          className={styles.button}
          data-testid="offset-apply"
          disabled={!sketcher.hasSelection || !distanceValid}
          title={t('sketch.offset.hint')}
          onClick={() => {
            sketcher.applyOffset(distanceMm, side);
          }}
        >
          {t('sketch.offset.apply')}
        </button>
      </div>
    );
  }

  if (sketcher.tool === 'move' || sketcher.tool === 'stretch') {
    const valid = Number.isFinite(dx) && Number.isFinite(dy);
    return (
      <div className={styles.planePickerRow} data-testid="move-panel">
        <label className={styles.field}>
          <span>{t('sketch.move.dx')}</span>
          <input
            type="number"
            className={styles.input}
            data-testid="move-dx"
            value={Number.isFinite(dx) ? dx : ''}
            onChange={(e) => {
              setDx(Number.parseFloat(e.target.value));
            }}
          />
        </label>
        <label className={styles.field}>
          <span>{t('sketch.move.dy')}</span>
          <input
            type="number"
            className={styles.input}
            data-testid="move-dy"
            value={Number.isFinite(dy) ? dy : ''}
            onChange={(e) => {
              setDy(Number.parseFloat(e.target.value));
            }}
          />
        </label>
        <button
          type="button"
          className={styles.button}
          data-testid="move-apply"
          disabled={!sketcher.moveArmed || !valid}
          title={t('sketch.move.hint')}
          onClick={() => {
            sketcher.applyMove(dx, dy);
          }}
        >
          {t('sketch.move.apply')}
        </button>
      </div>
    );
  }

  return null;
}
