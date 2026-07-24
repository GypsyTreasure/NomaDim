import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProfileId } from '../../../core';
import type { SketchProfile } from '../../../sketch';
import { t, type TranslationKey } from '../../i18n/t';
import styles from './Timeline.module.css';

/** Reusable form pieces shared by the Extrude/Revolve dialogs. */

/** Default op-dialog position (px from top-left) — a consistent upper-left
 * anchor that leaves the centred model visible and orbitable behind it (#7). */
const DIALOG_DEFAULT = { x: 20, y: 88 };

export function DialogFrame(props: {
  title: string;
  okDisabled: boolean;
  onOk: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  // Draggable by its title bar (#4): starts at the same anchor every open, then
  // the user can move it anywhere to see the model. Position is clamped into
  // view on each move so it can't be lost off-screen.
  const [pos, setPos] = useState(DIALOG_DEFAULT);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent): void => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drag.current) return;
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 40;
    setPos({
      x: Math.min(Math.max(0, e.clientX - drag.current.dx), maxX),
      y: Math.min(Math.max(0, e.clientY - drag.current.dy), maxY),
    });
  };
  const endDrag = (e: React.PointerEvent): void => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Rendered through a portal to <body> so the dialog sizes against the whole
  // viewport, not whatever small container hosts the button (e.g. the Export
  // button lives in the compact actions menu, which clipped it to a few px).
  // The backdrop is pointer-events:none so the viewport behind stays orbitable.
  return createPortal(
    <div className={styles.dialogBackdrop}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label={props.title}
        style={{ position: 'absolute', left: pos.x, top: pos.y, margin: 0 }}
      >
        <h2
          className={styles.dialogTitle}
          style={{ cursor: 'move', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {props.title}
        </h2>
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
    </div>,
    document.body
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
