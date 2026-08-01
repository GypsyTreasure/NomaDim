import { forwardRef } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { ICON_ACRONYMS } from '../icons/acronyms';
import { withShortcut } from '../help/shortcuts';
import styles from './Toolbar.module.css';

/**
 * The one icon control used across every toolbar/menu (ADR-0090). Picture plus
 * a 2–3-letter acronym caption (#5b, ADR-0107) so a tool is findable at a
 * glance, and always accessible: `label` becomes the `aria-label` (so screen
 * readers and tests address it by name) and, with the optional `shortcut`, the
 * hover `title`. `active` shows the soft teal tint; `primary` the filled
 * entry-point style. Pass `hideAcronym` for the rare compact spot where the
 * caption would crowd (e.g. the view-cube nudge pad).
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
  /** Suppress the acronym caption in tight layouts. */
  hideAcronym?: boolean;
  /** Optional overlay (e.g. the live body count on Browser). */
  badge?: React.ReactNode;
  onClick?: () => void;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    shortcut,
    title,
    active,
    primary,
    disabled,
    ariaPressed,
    testid,
    hideAcronym,
    badge,
    onClick,
  },
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
      {!hideAcronym && (
        <span className={styles.acr} aria-hidden="true">
          {ICON_ACRONYMS[icon]}
        </span>
      )}
      {badge}
    </button>
  );
});
