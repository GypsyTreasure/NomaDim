import { useEffect, useReducer } from 'react';
import { t } from '../../i18n/t';
import { commandBus } from '../../store/documentStore';
import styles from './UndoRedo.module.css';

/**
 * Undo / Redo buttons — the touch affordance for Ctrl+Z / Ctrl+Y, which are
 * otherwise unreachable on a phone. Always visible (header), both modes.
 * Re-renders on every document change so the enabled state tracks history.
 */
export function UndoRedo(): React.JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () =>
      commandBus.onChange(() => {
        bump();
      }),
    []
  );

  return (
    <div className={styles.cluster}>
      <button
        type="button"
        className={styles.button}
        title={`${t('history.undo')} (Ctrl+Z)`}
        aria-label={t('history.undo')}
        data-testid="undo"
        disabled={!commandBus.canUndo()}
        onClick={() => {
          commandBus.undo();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M6 4L2.5 7.5 6 11M3 7.5h7a4.5 4.5 0 0 1 0 9H7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className={styles.button}
        title={`${t('history.redo')} (Ctrl+Y)`}
        aria-label={t('history.redo')}
        data-testid="redo"
        disabled={!commandBus.canRedo()}
        onClick={() => {
          commandBus.redo();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M12 4l3.5 3.5L12 11M15 7.5H8a4.5 4.5 0 0 0 0 9h3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
