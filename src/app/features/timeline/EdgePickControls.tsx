import type { BodyId } from '../../../core';
import { edgeFingerprintKey } from '../../../kernel';
import { t } from '../../i18n/t';
import { useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { useSessionStore } from '../../store/sessionStore';
import { SelectRow } from './dialogShared';
import { targetOptions } from './dialogData';
import styles from './Timeline.module.css';

/**
 * Shared Fillet/Chamfer controls: target body picker + an edge-pick toggle
 * that flips the viewport into edge-selection mode (F4). Picked edges live in
 * the session store (the viewport writes them via raycast); the count shows
 * here.
 */
export function EdgePickControls({
  bodyId,
  onBodyChange,
}: {
  bodyId: BodyId | null;
  onBodyChange: (id: BodyId) => void;
}): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const edgePicking = useSessionStore((s) => s.edgePicking);
  const setEdgePicking = useSessionStore((s) => s.setEdgePicking);
  const pickedEdges = useSessionStore((s) => s.pickedEdges);
  const toggleEdge = useSessionStore((s) => s.toggleEdge);
  const setPickedEdges = useSessionStore((s) => s.setPickedEdges);

  return (
    <>
      <SelectRow<BodyId>
        labelKey="dialog.body"
        value={bodyId ?? ('' as BodyId)}
        options={targetOptions(document, liveBodyIds)}
        onChange={onBodyChange}
      />
      <div className={styles.field}>
        <span>{t('dialog.edges')}</span>
        <button
          type="button"
          className={`${styles.button ?? ''} ${edgePicking ? (styles.buttonPrimary ?? '') : ''}`}
          onClick={() => {
            setEdgePicking(!edgePicking);
          }}
          data-testid="edge-pick-toggle"
        >
          {edgePicking
            ? t('dialog.edges.done')
            : `${String(pickedEdges.length)} ${t('dialog.edges.count')}`}
        </button>
      </div>
      {/* Editable list of picked edges (#7): each can be removed individually so
          a mis-pick doesn't force starting the selection over. */}
      {pickedEdges.length > 0 && (
        <ul className={styles.edgeList} data-testid="edge-list">
          {pickedEdges.map((edge, i) => (
            <li key={edgeFingerprintKey(edge)} className={styles.edgeListItem}>
              <span>{`${t('dialog.edges.item')} ${String(i + 1)}`}</span>
              <button
                type="button"
                className={styles.edgeListRemove}
                title={t('dialog.edges.remove')}
                aria-label={t('dialog.edges.remove')}
                onClick={() => {
                  toggleEdge(edge); // present → removed
                }}
              >
                ×
              </button>
            </li>
          ))}
          <li className={styles.edgeListClear}>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setPickedEdges([]);
              }}
            >
              {t('dialog.edges.clear')}
            </button>
          </li>
        </ul>
      )}
    </>
  );
}
