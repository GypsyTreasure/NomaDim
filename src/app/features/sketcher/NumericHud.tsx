import type { TranslationKey } from '../../i18n/en';
import { t } from '../../i18n/t';
import type { NumericInputState } from '../../../sketch';
import styles from './Sketcher.module.css';

/**
 * Floating numeric fields (MASTER_DOCUMENT F2). Keystrokes still flow through
 * the global handler in useSketcher (never DOM inputs), so Tab/Enter/Esc stay
 * exactly the machine's — but a field can now also be selected with the mouse
 * (`onFocus`), then typed into. Clicking blurs the button so the global key
 * handler keeps receiving digits (a focused button would swallow Enter/Space).
 */
export function NumericHud({
  input,
  onFocus,
}: {
  input: NumericInputState;
  onFocus?: (index: number) => void;
}): React.JSX.Element | null {
  if (input.fields.length === 0) return null;
  return (
    <div className={styles.hud} data-testid="numeric-hud">
      {input.fields.map((field, i) => (
        <button
          key={field.id}
          type="button"
          className={
            input.activeIndex === i
              ? `${styles.hudField ?? ''} ${styles.hudFieldActive ?? ''}`
              : styles.hudField
          }
          data-testid={`hud-field-${field.id}`}
          onClick={(e) => {
            onFocus?.(i);
            e.currentTarget.blur();
          }}
        >
          {t(`sketch.field.${field.id}` as TranslationKey)}
          <span className={styles.hudValue}>{input.values[i] === '' ? '—' : input.values[i]}</span>
        </button>
      ))}
    </div>
  );
}
