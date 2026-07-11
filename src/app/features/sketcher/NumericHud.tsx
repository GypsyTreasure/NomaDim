import type { TranslationKey } from '../../i18n/en';
import { t } from '../../i18n/t';
import type { NumericInputState } from '../../../sketch';
import styles from './Sketcher.module.css';

/**
 * Floating numeric fields (MASTER_DOCUMENT F2). Display-only mirror of the
 * NumericInputMachine — keystrokes flow through the global handler in
 * useSketcher, never through DOM inputs, so Tab/Enter/Esc semantics stay
 * exactly the machine's.
 */
export function NumericHud({ input }: { input: NumericInputState }): React.JSX.Element | null {
  if (input.fields.length === 0) return null;
  return (
    <div className={styles.hud} data-testid="numeric-hud">
      {input.fields.map((field, i) => (
        <span
          key={field.id}
          className={
            input.activeIndex === i
              ? `${styles.hudField ?? ''} ${styles.hudFieldActive ?? ''}`
              : styles.hudField
          }
          data-testid={`hud-field-${field.id}`}
        >
          {t(`sketch.field.${field.id}` as TranslationKey)}
          <span className={styles.hudValue}>{input.values[i] === '' ? '—' : input.values[i]}</span>
        </span>
      ))}
    </div>
  );
}
