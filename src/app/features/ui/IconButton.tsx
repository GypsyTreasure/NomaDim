import { forwardRef } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { withShortcut } from '../help/shortcuts';
import styles from './Toolbar.module.css';

/**
 * The one icon control used across every toolbar/menu (ADR-0090). Icon-only for
 * a minimal, uniform look, but always accessible: `label` becomes the
 * `aria-label` (so screen readers and tests address it by name) and, with the
 * optional `shortcut`, the hover `title`. `active` shows the soft teal tint;
 * `primary` the filled entry-point style.
 */
export interface IconButtonProps {
  icon: IconName;
  label: string;
  shortcut?: string;
  /** Tooltip override (e.g. a disabled-reason). Defaults to "label (shortcut)". */
  title?: string;
  active?: boolean;
  primary?: boolean;
  disabled?: boolean;
  ariaPressed?: boolean;
  testid?: string;
  /** Optional overlay (e.g. the live body count on Browser). */
  badge?: React.ReactNode;
  onClick?: () => void;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, shortcut, title, active, primary, disabled, ariaPressed, testid, badge, onClick },
  ref
) {
  const className = primary
    ? `${styles.iconBtn ?? ''} ${styles.iconBtnPrimary ?? ''}`
    : active
      ? `${styles.iconBtn ?? ''} ${styles.iconBtnActive ?? ''}`
      : (styles.iconBtn ?? '');
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      title={title ?? withShortcut(label, shortcut)}
      aria-label={label}
      aria-pressed={ariaPressed}
      disabled={disabled}
      data-testid={testid}
      onClick={onClick}
    >
      <Icon name={icon} />
      {badge}
    </button>
  );
});
