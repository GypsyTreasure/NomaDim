import { t } from '../../i18n/t';
import type { KernelDemoState } from './useKernelDemo';
import styles from './KernelDemoPanel.module.css';

export function KernelDemoPanel({
  status,
  errorMessage,
  liveHandleCount,
  exportStl,
  disposeBody,
}: KernelDemoState): React.JSX.Element {
  const busy = status === 'loading';

  return (
    <div className={styles.panel}>
      {status === 'loading' && <span>{t('kernelDemo.status.loading')}</span>}
      {status === 'error' && (
        <span className={styles.error}>
          {t('kernelDemo.status.error')} {errorMessage}
        </span>
      )}
      <span className={styles.stats}>
        {t('kernelDemo.liveHandlesLabel')} {liveHandleCount ?? '—'}
      </span>
      <div className={styles.actions}>
        <button type="button" className={styles.button} disabled={busy} onClick={exportStl}>
          {t('kernelDemo.exportStl')}
        </button>
        <button type="button" className={styles.button} disabled={busy} onClick={disposeBody}>
          {t('kernelDemo.dispose')}
        </button>
      </div>
    </div>
  );
}
