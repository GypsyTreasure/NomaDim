import { useEffect, useRef } from 'react';
import { t } from '../../i18n/t';
import { useDocumentStore } from '../../store/documentStore';
import { pushToast } from '../../store/toastStore';
import { IconButton } from '../ui/IconButton';
import { downloadDocument, loadDocumentText } from './documentIO';
import { exportFileName } from '../naming/exportName';

/**
 * Save / Open a `.nomadim.xml` document (F7): Save serializes the current
 * document; Open (file picker or drag-drop, via `loadDocumentText`) parses,
 * validates, and replaces the document through the bus — triggering a full
 * regen. A newer schema version is rejected (ADR-0007).
 */

export function DocumentIO(): React.JSX.Element {
  const doc = useDocumentStore((s) => s.document);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = (): void => {
    downloadDocument(doc, exportFileName('.nomadim.xml'));
  };

  // Ctrl+S / Ctrl+O shortcuts (master rule, ADR-0032). Rebinds `save` each
  // render so it always serializes the current document.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === 's') {
        event.preventDefault();
        save();
      } else if (event.key === 'o') {
        event.preventDefault();
        inputRef.current?.click();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  const onFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-opening the same file
    if (!file) return;
    void file.text().then((text) => {
      const error = loadDocumentText(text);
      if (error !== null) pushToast(`${t('io.loadError')} ${error}`, 'error');
    });
  };

  return (
    <>
      <IconButton
        icon="save"
        label={t('io.save')}
        shortcut="Ctrl+S"
        onClick={save}
        testid="doc-save"
      />
      <IconButton
        icon="open"
        label={t('io.open')}
        shortcut="Ctrl+O"
        onClick={() => inputRef.current?.click()}
        testid="doc-open"
      />
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
