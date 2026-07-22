import { useEffect } from 'react';
import { useToastStore, type Toast } from '../../store/toastStore';
import { t } from '../../i18n/t';
import styles from './Toaster.module.css';

/**
 * Renders the transient toast stack (MASTER_DOCUMENT §7). Each toast
 * auto-dismisses after a delay; errors linger longer than info/success so a
 * failed-op message can actually be read. Dismiss button for touch. Purely a
 * view over `toastStore` — no document state.
 */

const DISMISS_MS: Record<Toast['kind'], number> = {
  error: 8000,
  info: 4000,
  success: 4000,
};

function ToastRow({ toast }: { toast: Toast }): React.JSX.Element {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      dismiss(toast.id);
    }, DISMISS_MS[toast.kind]);
    return () => {
      window.clearTimeout(handle);
    };
  }, [toast.id, toast.kind, dismiss]);
  return (
    <div className={styles.toast} data-kind={toast.kind} data-testid="toast" role="status">
      <span className={styles.message}>{toast.message}</span>
      <button
        type="button"
        className={styles.close}
        aria-label={t('toast.dismiss')}
        title={t('toast.dismiss')}
        onClick={() => {
          dismiss(toast.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

export function Toaster(): React.JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className={styles.stack} data-testid="toaster" aria-live="polite">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
