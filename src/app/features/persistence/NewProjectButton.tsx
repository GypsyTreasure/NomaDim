import { useEffect, useState } from 'react';
import { emptyDocument, type DocumentState } from '../../../document';
import { t } from '../../i18n/t';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useSessionStore } from '../../store/sessionStore';
import { downloadDocument } from '../document-io/documentIO';
import { clearPersistedDocument } from './autosave';
import dialogStyles from './NewProject.module.css';
import styles from '../sketcher/Sketcher.module.css';

/**
 * New Project (F7): clears the current model AND its autosaved copy, starting
 * fresh. Because that discards work, a non-empty document first prompts to
 * export a `.nomadim.xml` — Export & New, Discard & New, or Cancel. Disabled
 * (and a no-op via its Shift+N shortcut) when the document is already empty.
 */

function isEmptyDocument(doc: DocumentState): boolean {
  return doc.sketches.length === 0 && doc.ops.length === 0;
}

export function NewProjectButton(): React.JSX.Element {
  const doc = useDocumentStore((s) => s.document);
  const empty = isEmptyDocument(doc);
  const [confirming, setConfirming] = useState(false);

  const requestNew = (): void => {
    if (isEmptyDocument(useDocumentStore.getState().document)) return;
    setConfirming(true);
  };

  const startFresh = (): void => {
    clearPersistedDocument();
    commandBus.loadDocument(emptyDocument());
    const session = useSessionStore.getState();
    session.exitSketch();
    session.setSelection([]);
    session.setSelectedBody(null);
    session.resetEdgePick();
    setConfirming(false);
  };

  // Shift+N starts a new project (master rule, ADR-0032); plain N is New Sketch.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || !event.shiftKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        requestNew();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  return (
    <>
      <button
        type="button"
        className={styles.button}
        title="Shift+N"
        disabled={empty}
        onClick={requestNew}
        data-testid="new-project"
      >
        {t('project.new')}
      </button>
      {confirming && (
        <div className={dialogStyles.backdrop} data-testid="new-project-dialog">
          <div
            className={dialogStyles.dialog}
            role="dialog"
            aria-modal="true"
            aria-label={t('project.new')}
          >
            <h2 className={dialogStyles.title}>{t('project.new')}</h2>
            <p className={dialogStyles.message}>{t('project.new.confirm')}</p>
            <div className={dialogStyles.actions}>
              <button
                type="button"
                className={`${styles.button ?? ''} ${styles.buttonActive ?? ''}`}
                data-testid="new-project-export"
                onClick={() => {
                  downloadDocument(doc);
                  startFresh();
                }}
              >
                {t('project.new.export')}
              </button>
              <button
                type="button"
                className={styles.button}
                data-testid="new-project-discard"
                onClick={startFresh}
              >
                {t('project.new.discard')}
              </button>
              <button
                type="button"
                className={styles.button}
                data-testid="new-project-cancel"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t('dialog.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
