import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from './i18n/t';
import styles from './ErrorBoundary.module.css';

/**
 * Last-resort error boundary. A render exception anywhere below would blank the
 * page; instead we show a recoverable message. Reloading is safe — the document
 * is autosaved (ADR-0042), so the project comes back. The error text is shown
 * so it can be reported.
 */
interface State {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for diagnostics; the boundary itself renders the fallback.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={styles.overlay} role="alert">
        <div className={styles.panel}>
          <h1 className={styles.title}>{t('error.title')}</h1>
          <p className={styles.message}>{t('error.message')}</p>
          <pre className={styles.detail}>{error.message}</pre>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              window.location.reload();
            }}
          >
            {t('error.reload')}
          </button>
        </div>
      </div>
    );
  }
}
