import { useState } from 'react';
import { t } from '../../i18n/t';
import { pushToast } from '../../store/toastStore';
import { DialogFrame } from '../timeline/dialogShared';
import styles from '../sketcher/Sketcher.module.css';
import { SAMPLES, loadSample } from './samples';

/**
 * Sample gallery (M12): loads a built-in `.nomadim.xml` project through the
 * ordinary document load path. Also the empty-state "Load sample" affordance
 * deferred from M9. Controlled `open` so the onboarding hint can launch it.
 */
export function SampleGallery({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);

  const load = (file: string): void => {
    setBusy(true);
    void loadSample(file).then((error) => {
      setBusy(false);
      onOpenChange(false);
      if (error !== null) pushToast(`${t('sample.error')} ${error}`, 'error');
    });
  };

  return (
    <>
      <button
        type="button"
        className={styles.button}
        title={t('sample.open')}
        data-testid="samples-open"
        onClick={() => {
          onOpenChange(true);
        }}
      >
        {t('sample.menu')}
      </button>
      {open && (
        <DialogFrame
          title={t('sample.open')}
          okDisabled
          onOk={() => {
            onOpenChange(false);
          }}
          onCancel={() => {
            onOpenChange(false);
          }}
        >
          <div className={styles.sampleList} data-testid="sample-list">
            {SAMPLES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                className={styles.sampleCard}
                data-testid={`sample-${sample.id}`}
                disabled={busy}
                onClick={() => {
                  load(sample.file);
                }}
              >
                <span className={styles.sampleName}>{t(sample.nameKey)}</span>
                <span className={styles.sampleDesc}>{t(sample.descKey)}</span>
              </button>
            ))}
          </div>
        </DialogFrame>
      )}
    </>
  );
}
