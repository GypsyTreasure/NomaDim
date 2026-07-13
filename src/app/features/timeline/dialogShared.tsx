import type { ProfileId } from '../../../core';
import type { SketchProfile } from '../../../sketch';
import { t, type TranslationKey } from '../../i18n/t';
import styles from './Timeline.module.css';

/** Reusable form pieces shared by the Extrude/Revolve dialogs. */

export function DialogFrame(props: {
  title: string;
  okDisabled: boolean;
  onOk: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.dialogBackdrop}>
      <div className={styles.dialog} role="dialog" aria-label={props.title}>
        <h2 className={styles.dialogTitle}>{props.title}</h2>
        <div className={styles.dialogBody}>{props.children}</div>
        <div className={styles.dialogButtons}>
          <button type="button" className={styles.button} onClick={props.onCancel}>
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className={`${styles.button ?? ''} ${styles.buttonPrimary ?? ''}`}
            disabled={props.okDisabled}
            onClick={props.onOk}
          >
            {t('dialog.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NumberRow(props: {
  labelKey: TranslationKey;
  value: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className={styles.field}>
      <span>{t(props.labelKey)}</span>
      <input
        type="number"
        className={styles.input}
        value={Number.isFinite(props.value) ? props.value : ''}
        onChange={(e) => {
          props.onChange(Number.parseFloat(e.target.value));
        }}
      />
    </label>
  );
}

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function SelectRow<T extends string>(props: {
  labelKey: TranslationKey;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <label className={styles.field}>
      <span>{t(props.labelKey)}</span>
      <select
        className={styles.input}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value as T);
        }}
      >
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ProfileChecklist(props: {
  profiles: readonly SketchProfile[];
  selected: ReadonlySet<ProfileId>;
  onToggle: (id: ProfileId) => void;
}): React.JSX.Element {
  return (
    <fieldset className={styles.fieldset}>
      <legend>{t('dialog.profiles')}</legend>
      {props.profiles.map((profile) => (
        <label key={profile.id} className={styles.checkRow}>
          <input
            type="checkbox"
            checked={props.selected.has(profile.id)}
            onChange={() => {
              props.onToggle(profile.id);
            }}
          />
          <span>
            {profile.outer.area.toFixed(2)} mm²{' '}
            {profile.inner.length > 0 ? t('dialog.profile.withHoles') : ''}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
