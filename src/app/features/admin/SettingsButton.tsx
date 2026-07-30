import { useEffect, useState } from 'react';
import { t } from '../../i18n/t';
import { withShortcut } from '../help/shortcuts';
import sketcherStyles from '../sketcher/Sketcher.module.css';
import { AdminPanel } from './AdminPanel';

/**
 * Opens the Admin panel (settings). Self-contained (button + panel + open
 * state), like the License button. Shortcut "," (master rule, ADR-0032),
 * ignored while typing in a field.
 */
export function SettingsButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ',') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className={sketcherStyles.button}
        title={withShortcut(t('admin.open'), ',')}
        data-testid="admin-open"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('admin.menu')}
      </button>
      <AdminPanel
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}
