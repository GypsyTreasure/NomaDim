import type { OpRunStatus } from '../../../kernel';
import type { OpType, TimelineOp } from '../../../document';
import { t } from '../../i18n/t';
import { withShortcut } from '../help/shortcuts';
import { useOpAvailability } from './opAvailability';
import { CREATABLE_OP_TYPES, OP_FEATURES } from './registry';
import type { TimelineApi } from './useTimeline';
import styles from './Timeline.module.css';

/** Create-op keyboard shortcut, shown as a tooltip (master rule, ADR-0032). */
const OP_SHORTCUT: Partial<Record<OpType, string>> = {
  Extrude: 'E',
  Revolve: 'V',
  Fillet: 'F',
  Chamfer: 'H',
  Combine: 'B',
  CopyBody: 'D',
  Mirror: 'I',
  Pattern: 'P',
  Shell: 'L',
  Move: 'T',
};

/** Effective chip status (suppressed overrides the last run result). */
function chipStatus(op: TimelineOp, reported: OpRunStatus | undefined): OpRunStatus {
  if (op.suppressed) return 'suppressed';
  return reported ?? 'ok';
}

function OpChip({
  op,
  index,
  active,
  timeline,
}: {
  op: TimelineOp;
  index: number;
  active: boolean;
  timeline: TimelineApi;
}): React.JSX.Element {
  const report = timeline.statuses.get(op.id);
  const status = chipStatus(op, report?.status);
  const feature = OP_FEATURES[op.type];
  const chipClass = `${styles.chip ?? ''} ${active ? '' : (styles.chipRolledBack ?? '')}`;
  // On error, the chip tooltip carries the reason so hovering a red chip
  // explains the failure (pairs with the toast, §7).
  const nameTitle =
    status === 'error' && report?.message
      ? `${t('timeline.status.error')}: ${report.message}`
      : t(feature.labelKey);
  return (
    <div className={chipClass} data-status={status} data-testid="timeline-chip">
      <button
        type="button"
        className={styles.chipName}
        onClick={() => {
          timeline.openEdit(op);
        }}
        title={nameTitle}
      >
        {op.name}
      </button>
      <div className={styles.chipActions}>
        <button
          type="button"
          title={op.suppressed ? t('timeline.unsuppress') : t('timeline.suppress')}
          onClick={() => {
            timeline.toggleSuppress(op);
          }}
        >
          {op.suppressed ? '○' : '●'}
        </button>
        <button
          type="button"
          title={t('timeline.rollbackHere')}
          onClick={() => {
            timeline.setRollback(index);
          }}
        >
          ⤒
        </button>
        <button
          type="button"
          title={t('timeline.rename')}
          onClick={() => {
            timeline.rename(op);
          }}
        >
          ✎
        </button>
        <button
          type="button"
          title={t('timeline.delete')}
          onClick={() => {
            timeline.remove(op);
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function TimelineBar({
  timeline,
  onNewSketch,
}: {
  timeline: TimelineApi;
  onNewSketch: () => void;
}): React.JSX.Element {
  const availabilityOf = useOpAvailability();
  return (
    <div className={styles.bar} data-testid="timeline-bar">
      <div className={styles.createRow}>
        {/* New Sketch leads the operations row — the step before any 3D op. */}
        <button
          type="button"
          className={`${styles.button ?? ''} ${styles.buttonPrimary ?? ''}`}
          title={withShortcut(t('sketch.newSketch'), 'N')}
          onClick={onNewSketch}
        >
          {t('sketch.newSketch')}
        </button>
        {CREATABLE_OP_TYPES.map((type) => {
          const availability = availabilityOf(type);
          const label = t(OP_FEATURES[type].labelKey);
          // Enabled → "Label (Shortcut)"; disabled → the unmet-precondition
          // reason, so hovering a greyed op explains why (M9: no dead buttons).
          const title = availability.available
            ? withShortcut(label, OP_SHORTCUT[type])
            : t(availability.reasonKey ?? 'guard.needSketch');
          return (
            <button
              key={type}
              type="button"
              className={styles.button}
              title={title}
              disabled={!availability.available}
              onClick={() => {
                timeline.openCreate(type);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className={styles.chips}>
        {timeline.ops.map((op, index) => (
          <OpChip
            key={op.id}
            op={op}
            index={index}
            active={index < timeline.rollbackIndex}
            timeline={timeline}
          />
        ))}
        <button
          type="button"
          className={styles.rollbackEnd}
          title={t('timeline.rollbackToEnd')}
          onClick={() => {
            timeline.setRollback(timeline.ops.length);
          }}
        >
          ⏵
        </button>
      </div>
    </div>
  );
}
