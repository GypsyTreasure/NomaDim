import styles from './Toolbar.module.css';

/**
 * A named block of toolbar buttons — the MS-Office "ribbon group" idea (#5c):
 * related icons sit together under a small caption (Create, Modify, File, …),
 * so the single top ribbon reads as thematic sections instead of one long run
 * of icons. Decorative caption; each button keeps its own accessible name.
 */
export function ToolbarGroup({
  label,
  children,
  testid,
}: {
  label: string;
  children: React.ReactNode;
  testid?: string;
}): React.JSX.Element {
  return (
    <div className={styles.group} data-testid={testid}>
      <div className={styles.groupRow}>{children}</div>
      <span className={styles.groupLabel} aria-hidden="true">
        {label}
      </span>
    </div>
  );
}
