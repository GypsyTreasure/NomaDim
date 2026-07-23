import { useEffect, useState } from 'react';
import { t } from '../../i18n/t';
import { useKernelStore } from '../../store/kernelStore';
import { ExportStlDialog } from './ExportStlDialog';
import styles from './Timeline.module.css';

/**
 * Opens the export dialog (F6): body scope and format — STL (binary/ASCII,
 * with deflection presets, a live triangle-count preview and a non-manifold
 * warning) or STEP (exact B-rep, ADR-0063). Labelled just "Export" so the STEP
 * option is discoverable, not hidden behind an "STL" button. Ctrl+E opens it
 * (master rule, ADR-0032).
 */
export function ExportStlButton(): React.JSX.Element {
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const [open, setOpen] = useState(false);
  const hasBodies = liveBodyIds.length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'e') {
        event.preventDefault();
        if (liveBodyIds.length > 0) setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [liveBodyIds.length]);

  return (
    <>
      <button
        type="button"
        className={styles.button}
        title="Ctrl+E"
        disabled={!hasBodies}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('kernel.exportStl')}
      </button>
      {open && (
        <ExportStlDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
