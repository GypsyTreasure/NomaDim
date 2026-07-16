import { useRef } from 'react';
import { documentToXml } from '../../../document';
import { t } from '../../i18n/t';
import { useDocumentStore } from '../../store/documentStore';
import { loadDocumentText } from './documentIO';
import styles from '../timeline/Timeline.module.css';

/**
 * Save / Open a `.nomadim.xml` document (F7): Save serializes the current
 * document; Open (file picker or drag-drop, via `loadDocumentText`) parses,
 * validates, and replaces the document through the bus — triggering a full
 * regen. A newer schema version is rejected (ADR-0007).
 */

const FILE_NAME = 'model.nomadim.xml';

function downloadText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DocumentIO(): React.JSX.Element {
  const doc = useDocumentStore((s) => s.document);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = (): void => {
    downloadText(documentToXml(doc), FILE_NAME);
  };

  const onFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-opening the same file
    if (!file) return;
    void file.text().then((text) => {
      const error = loadDocumentText(text);
      if (error !== null) window.alert(`${t('io.loadError')} ${error}`);
    });
  };

  return (
    <>
      <button type="button" className={styles.button} onClick={save} data-testid="doc-save">
        {t('io.save')}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => inputRef.current?.click()}
        data-testid="doc-open"
      >
        {t('io.open')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xml,.nomadim.xml"
        style={{ display: 'none' }}
        onChange={onFile}
        data-testid="doc-file-input"
      />
    </>
  );
}
