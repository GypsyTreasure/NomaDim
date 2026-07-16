import type { BodyId } from '../../../core';
import {
  bodyDisplayName,
  dependentOps,
  getBodyMeta,
  getSketchMeta,
  opDefinition,
  type TimelineOp,
} from '../../../document';
import { t } from '../../i18n/t';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { useSessionStore } from '../../store/sessionStore';
import styles from './Browser.module.css';

/** The op that produces a given body (its creating feature, F8 delete target). */
function producingOp(ops: readonly TimelineOp[], bodyId: BodyId): TimelineOp | undefined {
  return ops.find((op) => opDefinition(op).dependencies(op).producesBodies.includes(bodyId));
}

const PLANES = [
  { id: 'XY', label: t('viewport.origin.xy') },
  { id: 'XZ', label: t('viewport.origin.xz') },
  { id: 'YZ', label: t('viewport.origin.yz') },
] as const;

/**
 * Browser tree (F8): Origin plane toggles, Sketches (click to edit), and
 * Bodies with eye / rename / colour / delete. Selection syncs with the
 * viewport through the session store; edits go through the command bus (R1).
 */
export function BrowserTree(): React.JSX.Element {
  const document = useDocumentStore((s) => s.document);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const selectedBodyId = useSessionStore((s) => s.selectedBodyId);
  const planeVisibility = useSessionStore((s) => s.planeVisibility);

  const renameBody = (bodyId: BodyId, current: string): void => {
    const name = window.prompt(t('tree.body.rename'), current);
    if (name !== null && name.trim() !== '') {
      commandBus.dispatch({ type: 'SetBodyName', payload: { bodyId, name: name.trim() } });
    }
  };

  const deleteBody = (bodyId: BodyId): void => {
    const op = producingOp(document.ops, bodyId);
    if (!op) return;
    const dependents = dependentOps(document, op.id);
    if (dependents.length > 0) {
      const names = dependents.map((d) => d.name).join(', ');
      if (!window.confirm(`Delete "${op.name}"? Dependent operations: ${names}`)) return;
    }
    commandBus.dispatch({ type: 'DeleteOp', payload: { opId: op.id } });
  };

  return (
    <div className={styles.tree} data-testid="browser-tree">
      <section className={styles.section}>
        <h3 className={styles.heading}>{t('tree.origin')}</h3>
        {PLANES.map((plane) => (
          <label key={plane.id} className={styles.row}>
            <input
              type="checkbox"
              checked={planeVisibility[plane.id]}
              onChange={() => {
                useSessionStore.getState().togglePlane(plane.id);
              }}
            />
            <span>{plane.label}</span>
          </label>
        ))}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>{t('tree.sketches')}</h3>
        {document.sketches.length === 0 && <div className={styles.row}>{t('tree.empty')}</div>}
        {document.sketches.map((sketch) => {
          const visible = getSketchMeta(document, sketch.id).visible;
          return (
            <div key={sketch.id} className={styles.bodyRow ?? ''} data-testid="tree-sketch">
              <input
                type="checkbox"
                title={visible ? t('tree.sketch.hide') : t('tree.sketch.show')}
                checked={visible}
                onChange={(e) => {
                  commandBus.dispatch({
                    type: 'SetSketchVisible',
                    payload: { sketchId: sketch.id, visible: e.target.checked },
                  });
                }}
              />
              <button
                type="button"
                className={styles.itemButton}
                onClick={() => {
                  useSessionStore.getState().enterSketch(sketch.id);
                }}
              >
                {sketch.name}
              </button>
            </div>
          );
        })}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>{t('tree.bodies')}</h3>
        {liveBodyIds.length === 0 && <div className={styles.row}>{t('tree.empty')}</div>}
        {liveBodyIds.map((bodyId) => {
          const meta = getBodyMeta(document, bodyId);
          const displayName = bodyDisplayName(document, bodyId);
          const selected = bodyId === selectedBodyId;
          return (
            <div
              key={bodyId}
              className={`${styles.bodyRow ?? ''} ${selected ? (styles.selected ?? '') : ''}`}
              data-testid="tree-body"
            >
              <input
                type="checkbox"
                title={meta.visible ? t('tree.body.hide') : t('tree.body.show')}
                checked={meta.visible}
                onChange={(e) => {
                  commandBus.dispatch({
                    type: 'SetBodyVisible',
                    payload: { bodyId, visible: e.target.checked },
                  });
                }}
              />
              <input
                type="color"
                className={styles.swatch}
                value={meta.color}
                onChange={(e) => {
                  commandBus.dispatch({
                    type: 'SetBodyColor',
                    payload: { bodyId, color: e.target.value },
                  });
                }}
              />
              <button
                type="button"
                className={styles.itemButton}
                onClick={() => {
                  useSessionStore.getState().setSelectedBody(bodyId);
                }}
                onDoubleClick={() => {
                  renameBody(bodyId, displayName);
                }}
              >
                {displayName}
              </button>
              <button
                type="button"
                className={styles.iconButton}
                title={t('tree.body.delete')}
                onClick={() => {
                  deleteBody(bodyId);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
