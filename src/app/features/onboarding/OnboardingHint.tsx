import { useState } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { t } from '../../i18n/t';
import styles from './Onboarding.module.css';

const DISMISS_KEY = 'nomadim.onboarded';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false; // private mode / storage disabled — just show the hint
  }
}

/**
 * First-run empty-state hint (F11): a non-modal getting-started card shown
 * while the document is empty (no sketches, no bodies). Dismissed by the
 * button and remembered in localStorage so it never nags a returning user; it
 * also falls away on its own once the first sketch or body exists.
 */
export function OnboardingHint(): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(readDismissed);
  const sketchCount = useDocumentStore((s) => s.document.sketches.length);
  const bodyCount = useKernelStore((s) => s.liveBodyIds.length);

  if (dismissed || sketchCount > 0 || bodyCount > 0) return null;

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage disabled — dismiss for this session only */
    }
    setDismissed(true);
  };

  return (
    <div className={styles.card} data-testid="onboarding-hint">
      <h2 className={styles.title}>{t('onboarding.title')}</h2>
      <ol className={styles.steps}>
        <li>{t('onboarding.step1')}</li>
        <li>{t('onboarding.step2')}</li>
        <li>{t('onboarding.step3')}</li>
      </ol>
      <button
        type="button"
        className={styles.dismiss}
        data-testid="onboarding-dismiss"
        onClick={dismiss}
      >
        {t('onboarding.dismiss')}
      </button>
    </div>
  );
}
