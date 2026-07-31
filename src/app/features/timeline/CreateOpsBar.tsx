import type { OpType } from '../../../document';
import { t } from '../../i18n/t';
import { withShortcut } from '../help/shortcuts';
import { IconButton } from '../ui/IconButton';
import type { IconName } from '../icons/Icon';
import { useOpAvailability } from './opAvailability';
import { CREATABLE_OP_TYPES, OP_FEATURES } from './registry';
import type { TimelineApi } from './useTimeline';
import toolbarStyles from '../ui/Toolbar.module.css';
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

/** Icon per creatable op (ADR-0094). */
const OP_ICON: Partial<Record<OpType, IconName>> = {
  Extrude: 'extrude',
  Revolve: 'revolve',
  Fillet: 'fillet',
  Chamfer: 'chamfer',
  Combine: 'combine',
  CopyBody: 'copyBody',
  Mirror: 'mirror',
  Pattern: 'pattern',
  Shell: 'shell',
  Move: 'move',
};

/**
 * 3D-operation launcher (ADR-0094): New Sketch + every creatable op as icon
 * buttons in a compact two-row grid, docked at the top (below the header) in
 * modeling mode. The timeline history stays at the bottom. Accessible names and
 * guard tooltips match the old text bar — an enabled op reads "Label (Shortcut)"
 * and a disabled one carries its unmet-precondition reason (M9, gui-hardening).
 */
export function CreateOpsBar({
  timeline,
  onNewSketch,
}: {
  timeline: TimelineApi;
  onNewSketch: () => void;
}): React.JSX.Element {
  const availabilityOf = useOpAvailability();
  return (
    <div className={styles.createRowTop} data-testid="create-ops-bar">
      <div className={toolbarStyles.createGrid}>
        <IconButton
          icon="newSketch"
          label={t('sketch.newSketch')}
          shortcut="N"
          primary
          onClick={onNewSketch}
        />
        {CREATABLE_OP_TYPES.map((type) => {
          const availability = availabilityOf(type);
          const label = t(OP_FEATURES[type].labelKey);
          const title = availability.available
            ? withShortcut(label, OP_SHORTCUT[type])
            : t(availability.reasonKey ?? 'guard.needSketch');
          return (
            <IconButton
              key={type}
              icon={OP_ICON[type] ?? 'extrude'}
              label={label}
              title={title}
              disabled={!availability.available}
              onClick={() => {
                timeline.openCreate(type);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
