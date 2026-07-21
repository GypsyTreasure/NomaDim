import { useRef } from 'react';
import type { TranslationKey } from '../../i18n/en';
import { t } from '../../i18n/t';
import type { NumericInputState } from '../../../sketch';
import styles from './Sketcher.module.css';

/**
 * Floating numeric fields (MASTER_DOCUMENT F2). Each field is a real DOM
 * `<input inputmode="decimal">`, so tapping it raises the mobile soft keyboard
 * and its `input` events drive the machine (Android keyboards don't emit
 * reliable keydowns). Physical-keyboard entry still flows through the global
 * handler in useSketcher when no field is focused, so Tab/Enter/Esc semantics
 * are unchanged; here Enter/Esc/Tab on a focused field call the same actions.
 */
export function NumericHud({
  input,
  onFocus,
  onChangeField,
  onSubmit,
  onCancel,
  onCycle,
}: {
  input: NumericInputState;
  onFocus?: (index: number) => void;
  onChangeField?: (index: number, text: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  onCycle?: () => void;
}): React.JSX.Element | null {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  if (input.fields.length === 0) return null;
  return (
    <div className={styles.hud} data-testid="numeric-hud">
      {input.fields.map((field, i) => {
        const label = t(`sketch.field.${field.id}` as TranslationKey);
        return (
          <label
            key={field.id}
            className={
              input.activeIndex === i
                ? `${styles.hudField ?? ''} ${styles.hudFieldActive ?? ''}`
                : styles.hudField
            }
          >
            <span className={styles.hudLabel}>{label}</span>
            <input
              ref={(el) => {
                refs.current[i] = el;
              }}
              className={styles.hudInput}
              data-testid={`hud-field-${field.id}`}
              type="text"
              inputMode={field.kind === 'count' ? 'numeric' : 'decimal'}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="—"
              aria-label={label}
              value={input.values[i] ?? ''}
              onFocus={() => onFocus?.(i)}
              onChange={(e) => onChangeField?.(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSubmit?.();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancel?.();
                  e.currentTarget.blur();
                } else if (e.key === 'Tab') {
                  e.preventDefault();
                  onCycle?.();
                  refs.current[(i + 1) % input.fields.length]?.focus();
                }
              }}
            />
          </label>
        );
      })}
      {/* Explicit commit button (ADR-0054): the iOS `decimal` soft keypad has no
          Return key, so typed values could never be applied on a phone. This is
          the touch affordance for Enter. `onPointerDown`/`preventDefault` keeps
          the focused field from blurring before the commit. */}
      <button
        type="button"
        className={styles.hudCommit}
        data-testid="hud-commit"
        aria-label={t('sketch.hud.apply')}
        title={t('sketch.hud.apply')}
        onPointerDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => onSubmit?.()}
      >
        ✓
      </button>
    </div>
  );
}
