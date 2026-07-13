import type { TimelineOp } from '../../../document';

/**
 * Shared props for an op's create/edit dialog. The app feature registry
 * (registry.ts) keys one dialog component per OpType (ARCHITECTURE §7);
 * `editing` is the op being modified, or null when creating a new one.
 */
export interface OpDialogProps {
  readonly editing: TimelineOp | null;
  readonly onClose: () => void;
}
