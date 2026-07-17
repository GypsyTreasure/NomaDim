import { t } from '../../i18n/t';
import styles from './Logo.module.css';

/**
 * NomaDim logotype (BRAND.md): the geometric "N" mark — a plotted vector path
 * with a start node echoing a sketch origin — plus the wordmark. Inline SVG so
 * it inherits brand tokens and needs no network fetch (C1). The wordmark text
 * comes from the i18n catalog; the mark is decorative.
 */
export function Logo(): React.JSX.Element {
  return (
    <span className={styles.logo}>
      <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path
          className={styles.stroke}
          d="M8 23 L8 10 L13 10 L24 23 L24 10"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className={styles.node} cx="8" cy="10" r="2" />
      </svg>
      <span className={styles.wordmark} aria-hidden="true">
        NomaDim
      </span>
      <span className={styles.srOnly}>{t('app.title')}</span>
    </span>
  );
}
