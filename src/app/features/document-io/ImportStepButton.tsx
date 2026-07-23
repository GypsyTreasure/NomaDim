import { useRef } from 'react';
import { createId } from '../../../core';
import type { ImportOp } from '../../../document';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { getKernelClient } from '../../store/kernelStore';
import { pushToast } from '../../store/toastStore';
import { t } from '../../i18n/t';
import { existingIds, mintName } from '../timeline/dialogData';
import styles from '../timeline/Timeline.module.css';

/**
 * Import a STEP file as a base body (roadmap P1). The worker parses it to a
 * solid and returns a base64 BREP payload; we add an Import op carrying that
 * payload so the geometry travels with the document (no external file).
 */
export function ImportStepButton(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-importing the same file
    if (!file) return;
    const client = getKernelClient();
    if (!client) return;
    void file
      .arrayBuffer()
      .then((bytes) => client.importStep(bytes))
      .then(
        (brepBase64) => {
          const doc = useDocumentStore.getState().document;
          const ids = existingIds(doc);
          const op: ImportOp = {
            type: 'Import',
            id: createId<'OpId'>(ids),
            name: mintName(doc, 'Import'),
            suppressed: false,
            format: 'step',
            sourceName: file.name,
            brepBase64,
            bodyId: createId<'BodyId'>(ids),
          };
          commandBus.dispatch({ type: 'AddOp', payload: { op } });
        },
        (error: unknown) => {
          pushToast(
            `${t('io.importError')} ${error instanceof Error ? error.message : String(error)}`,
            'error'
          );
        }
      );
  };

  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => inputRef.current?.click()}
        data-testid="doc-import-step"
      >
        {t('io.import')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".step,.stp"
        style={{ display: 'none' }}
        onChange={onFile}
        data-testid="doc-import-input"
      />
    </>
  );
}
