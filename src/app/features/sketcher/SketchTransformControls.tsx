import { useState } from 'react';
import { t } from '../../i18n/t';
import type { SketcherApi } from './useSketcher';
import styles from './Sketcher.module.css';

/**
 * Sketch Mirror & Pattern controls (#2), shown only when entities are selected.
 * Mirror reflects the selection across the sketch X/Y axis or a single selected
 * line; Pattern (inline form) arrays it linearly or circularly. Everything is
 * driven by the current selection — no extra pick modes.
 */
export function SketchTransformControls({
  sketcher,
}: {
  sketcher: SketcherApi;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'linear' | 'circular'>('linear');
  const [count, setCount] = useState(3);
  const [spacingMm, setSpacingMm] = useState(20);
  const [dirAxis, setDirAxis] = useState<'x' | 'y'>('x');
  const [angleDeg, setAngleDeg] = useState(360);

  if (!sketcher.hasSelection) return null;

  const countValid = Number.isInteger(count) && count >= 2;

  return (
    <div className={styles.planePickerRow} data-testid="sketch-transform">
      <button
        type="button"
        className={styles.button}
        data-testid="mirror-x"
        title="K"
        onClick={() => {
          sketcher.mirrorSelection('x');
        }}
      >
        {t('sketch.mirrorX')}
      </button>
      <button
        type="button"
        className={styles.button}
        data-testid="mirror-y"
        title="Shift+K"
        onClick={() => {
          sketcher.mirrorSelection('y');
        }}
      >
        {t('sketch.mirrorY')}
      </button>
      <button
        type="button"
        className={styles.button}
        data-testid="mirror-line"
        disabled={!sketcher.mirrorLineAvailable}
        title={`K — ${t('sketch.mirrorLineHint')}`}
        onClick={() => {
          sketcher.mirrorSelection('line');
        }}
      >
        {t('sketch.mirrorLine')}
      </button>
      <button
        type="button"
        className={styles.button}
        data-testid="pattern-toggle"
        aria-pressed={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {t('sketch.pattern')}
      </button>
      {open && (
        <>
          <label className={styles.field}>
            <span>{t('sketch.pattern.kind')}</span>
            <select
              className={styles.input}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as 'linear' | 'circular');
              }}
            >
              <option value="linear">{t('sketch.pattern.linear')}</option>
              <option value="circular">{t('sketch.pattern.circular')}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>{t('sketch.pattern.count')}</span>
            <input
              type="number"
              className={styles.input}
              value={Number.isFinite(count) ? count : ''}
              onChange={(e) => {
                setCount(Number.parseInt(e.target.value, 10));
              }}
            />
          </label>
          {kind === 'linear' ? (
            <>
              <label className={styles.field}>
                <span>{t('sketch.pattern.axis')}</span>
                <select
                  className={styles.input}
                  value={dirAxis}
                  onChange={(e) => {
                    setDirAxis(e.target.value as 'x' | 'y');
                  }}
                >
                  <option value="x">X</option>
                  <option value="y">Y</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>{t('sketch.pattern.spacing')}</span>
                <input
                  type="number"
                  className={styles.input}
                  value={Number.isFinite(spacingMm) ? spacingMm : ''}
                  onChange={(e) => {
                    setSpacingMm(Number.parseFloat(e.target.value));
                  }}
                />
              </label>
            </>
          ) : (
            <label className={styles.field}>
              <span>{t('sketch.pattern.angle')}</span>
              <input
                type="number"
                className={styles.input}
                value={Number.isFinite(angleDeg) ? angleDeg : ''}
                onChange={(e) => {
                  setAngleDeg(Number.parseFloat(e.target.value));
                }}
              />
            </label>
          )}
          <button
            type="button"
            className={styles.button}
            data-testid="pattern-create"
            disabled={!countValid}
            onClick={() => {
              sketcher.patternSelection({ kind, count, spacingMm, dirAxis, angleDeg });
            }}
          >
            {t('sketch.datum.create')}
          </button>
        </>
      )}
    </div>
  );
}
