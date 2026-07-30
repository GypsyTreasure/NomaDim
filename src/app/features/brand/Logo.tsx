import { t } from '../../i18n/t';
import styles from './Logo.module.css';

/**
 * NomaDim logotype (BRAND.md) — mirrors the NomaDirection wordmark: "Noma" in
 * Barlow Light + "Dim" in Barlow Medium, tight tracking, with the brand red
 * node sitting just after the wordmark (the same red dot as the sketch/world
 * origin). Rendered as live text so the dot always lands at the true end of the
 * word regardless of the resolved font. The mark is decorative; the accessible
 * name comes from the i18n catalog.
 */
export function Logo(): React.JSX.Element {
  return (
    <span className={styles.logo}>
      <span className={styles.wordmark} aria-hidden="true">
        <span className={styles.noma}>Noma</span>
        <span className={styles.dim}>Dim</span>
      </span>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.srOnly}>{t('app.title')}</span>
    </span>
  );
}
