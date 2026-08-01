import { useEffect, useReducer } from 'react';
import { t } from '../../i18n/t';
import { commandBus } from '../../store/documentStore';
import { IconButton } from '../ui/IconButton';
import styles from './UndoRedo.module.css';

/**
 * Undo / Redo buttons — the touch affordance for Ctrl+Z / Ctrl+Y, which are
 * otherwise unreachable on a phone. Always visible (header), both modes.
 * Re-renders on every document change so the enabled state tracks history.
 * Shares the IconButton language (picture + acronym, #5b) with the toolbars.
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
      <IconButton
        icon="undo"
        label={t('history.undo')}
        shortcut="Ctrl+Z"
        testid="undo"
        disabled={!commandBus.canUndo()}
        onClick={() => {
          commandBus.undo();
        }}
      />
      <IconButton
        icon="redo"
        label={t('history.redo')}
        shortcut="Ctrl+Y"
        testid="redo"
        disabled={!commandBus.canRedo()}
        onClick={() => {
          commandBus.redo();
        }}
      />
    </div>
  );
}
