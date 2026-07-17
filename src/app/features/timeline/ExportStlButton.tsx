import { useEffect } from 'react';
import {
  DEFAULT_EXPORT_ANGULAR_DEFLECTION_DEG,
  DEFAULT_EXPORT_LINEAR_DEFLECTION_MM,
} from '../../../core';
import { t } from '../../i18n/t';
import { getKernelClient, useKernelStore } from '../../store/kernelStore';
import styles from './Timeline.module.css';

function downloadBlob(data: ArrayBuffer, fileName: string): void {
  const blob = new Blob([data], { type: 'application/sla' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Exports every live body to a single binary STL (F6 preview lands at M6). */
export function ExportStlButton(): React.JSX.Element {
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);

  const exportStl = (): void => {
    const client = getKernelClient();
    if (!client || liveBodyIds.length === 0) return;
    void (async () => {
      const result = await client.exportStl({
        bodyIds: [...liveBodyIds],
        format: 'binary',
        linearDeflectionMm: DEFAULT_EXPORT_LINEAR_DEFLECTION_MM,
        angularDeflectionDeg: DEFAULT_EXPORT_ANGULAR_DEFLECTION_DEG,
      });
      downloadBlob(result.stl, result.fileName);
    })();
  };

  // Ctrl+E export shortcut (master rule, ADR-0032).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'e') {
        event.preventDefault();
        exportStl();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  return (
    <button
      type="button"
      className={styles.button}
      title="Ctrl+E"
      disabled={liveBodyIds.length === 0}
      onClick={exportStl}
    >
      {t('kernel.exportStl')}
    </button>
  );
}
