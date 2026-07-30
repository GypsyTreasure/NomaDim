import { useState } from 'react';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { t } from '../../i18n/t';
import styles from './ProjectName.module.css';

/**
 * Project-name field in the header (F7). Shows the current project name and lets
 * the user rename it inline; the edit commits (on blur / Enter) through the
 * RenameDocument command — the one write path — so it is undoable and persisted
 * in the `.nomadim.xml`. Empty is allowed (exports fall back to a default name).
 */
export function ProjectNameField(): React.JSX.Element {
  const name = useDocumentStore((s) => s.document.name);
  const [draft, setDraft] = useState(name);
  // Re-sync the draft when the document's name changes underneath us (Open /
  // New / sample / undo-redo) — the React "adjust state during render" pattern,
  // no effect needed.
  const [syncedName, setSyncedName] = useState(name);
  if (name !== syncedName) {
    setSyncedName(name);
    setDraft(name);
  }

  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === name) return;
    commandBus.dispatch({ type: 'RenameDocument', payload: { name: trimmed } });
  };

  return (
    <input
      className={styles.field}
      value={draft}
      placeholder={t('project.namePlaceholder')}
      title={t('project.nameTitle')}
      aria-label={t('project.nameTitle')}
      data-testid="project-name"
      spellCheck={false}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setDraft(name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
