import type { BodyId } from '../../../core';
import { t } from '../../i18n/t';
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
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const edgePicking = useSessionStore((s) => s.edgePicking);
  const setEdgePicking = useSessionStore((s) => s.setEdgePicking);
  const pickedCount = useSessionStore((s) => s.pickedEdges.length);

  return (
    <>
      <SelectRow<BodyId>
        labelKey="dialog.body"
        value={bodyId ?? ('' as BodyId)}
        options={targetOptions(liveBodyIds)}
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
            ? t('dialog.edges.pick')
            : `${String(pickedCount)} ${t('dialog.edges.count')}`}
        </button>
      </div>
    </>
  );
}
