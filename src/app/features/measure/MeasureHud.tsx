import { t } from '../../i18n/t';
import type { MeasureResult } from './useMeasure';
import styles from './Measure.module.css';

const fmt = (n: number): string => n.toFixed(3);

/** Measure readout (F10): distance + ΔX/ΔY/ΔZ, or circle radius/diameter. */
export function MeasureHud({ result }: { result: MeasureResult | null }): React.JSX.Element {
  return (
    <div className={styles.hud} data-testid="measure-hud">
      {result === null && <span className={styles.hint}>{t('measure.hint')}</span>}
      {result?.kind === 'distance' && (
        <span>
          {t('measure.distance')}: <strong>{fmt(result.distance)}</strong> mm &nbsp; Δ (
          {fmt(result.dx)}, {fmt(result.dy)}, {fmt(result.dz)})
        </span>
      )}
      {result?.kind === 'circle' && (
        <span>
          {t('measure.radius')}: <strong>{fmt(result.radius)}</strong> mm &nbsp;{' '}
          {t('measure.diameter')}: <strong>{fmt(result.radius * 2)}</strong> mm
        </span>
      )}
    </div>
  );
}
