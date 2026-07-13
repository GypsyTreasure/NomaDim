import { OP_FEATURES } from './registry';
import type { TimelineApi } from './useTimeline';

/** Renders the active op's dialog from the feature registry (no per-op switch, R4). */
export function OpDialogHost({ timeline }: { timeline: TimelineApi }): React.JSX.Element | null {
  const dialog = timeline.dialog;
  if (!dialog) return null;
  const Dialog = OP_FEATURES[dialog.type].dialog;
  if (!Dialog) return null;
  return <Dialog editing={dialog.editing} onClose={timeline.closeDialog} />;
}
