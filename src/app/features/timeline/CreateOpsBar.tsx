import type { OpType } from '../../../document';
import { t } from '../../i18n/t';
import { withShortcut } from '../help/shortcuts';
import { IconButton } from '../ui/IconButton';
import { ToolbarGroup } from '../ui/ToolbarGroup';
import type { IconName } from '../icons/Icon';
import { useOpAvailability } from './opAvailability';
import { OP_FEATURES } from './registry';
import { CREATE_OP_GROUPS } from './createOpGroups';
import type { TimelineApi } from './useTimeline';

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
 * The modeling create ops as named ribbon groups, rendered inline in the top
 * bar beside the NomaDim logo (#5c) — no longer a separate strip below the
 * header. New Sketch is a standalone primary button in the always-visible bar
 * (App), so it survives the mobile hamburger collapse; each op keeps its
 * accessible name and guard tooltip (enabled → "Label (Shortcut)", disabled →
 * unmet-precondition reason, M9).
 */
export function CreateOpsBar({ timeline }: { timeline: TimelineApi }): React.JSX.Element {
  const availabilityOf = useOpAvailability();
  const opButton = (type: OpType): React.JSX.Element => {
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
  };
  return (
    <>
      {CREATE_OP_GROUPS.map((group) => (
        <ToolbarGroup key={group.labelKey} label={t(group.labelKey)} testid="create-ops-bar">
          {group.ops.map(opButton)}
        </ToolbarGroup>
      ))}
    </>
  );
}
