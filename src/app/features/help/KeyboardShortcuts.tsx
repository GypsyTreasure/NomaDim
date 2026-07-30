import { useEffect, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { t } from '../../i18n/t';
import {
  isErrorReportingAvailable,
  isErrorReportingEnabled,
  setErrorReporting,
} from '../telemetry/errorReporting';
import { supportMailto } from '../support/support';
import { SHORTCUT_GROUPS } from './shortcuts';
import styles from './Help.module.css';

/**
 * Keyboard-shortcuts help overlay (F11). Toggled by "?" (Shift+/) anywhere
 * outside a text field, or the toolbar button; Esc or the backdrop closes it.
 * Presentation only — it reads the static catalog and reflects `helpOpen`
 * session state, never mutating the document.
 */
export function KeyboardShortcuts(): React.JSX.Element | null {
  const open = useSessionStore((s) => s.helpOpen);
  const setHelpOpen = useSessionStore((s) => s.setHelpOpen);
  const [reporting, setReporting] = useState(isErrorReportingEnabled);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen(!useSessionStore.getState().helpOpen);
      } else if (event.key === 'Escape' && useSessionStore.getState().helpOpen) {
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [setHelpOpen]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      data-testid="shortcuts-overlay"
      onClick={() => {
        setHelpOpen(false);
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-label={t('help.title')}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{t('help.title')}</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="shortcuts-close"
            aria-label={t('dialog.cancel')}
            onClick={() => {
              setHelpOpen(false);
            }}
          >
            ✕
          </button>
        </div>
        <div className={styles.groups}>
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className={styles.group}>
              <h3 className={styles.groupTitle}>{t(group.title)}</h3>
              <dl className={styles.list}>
                {group.items.map((item) => (
                  <div key={item.keys} className={styles.row}>
                    <dt className={styles.keys}>
                      <kbd className={styles.kbd}>{item.keys}</kbd>
                    </dt>
                    <dd className={styles.desc}>{t(item.desc)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className={styles.footer}>
          <a
            className={styles.support}
            href={supportMailto(t('support.subject'))}
            data-testid="support-link"
          >
            {t('support.contact')}
          </a>
          {isErrorReportingAvailable() && (
            <label className={styles.reporting}>
              <input
                type="checkbox"
                checked={reporting}
                data-testid="error-reporting-toggle"
                onChange={(e) => {
                  setErrorReporting(e.target.checked);
                  setReporting(e.target.checked);
                }}
              />
              {t('support.crashReports')}
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
