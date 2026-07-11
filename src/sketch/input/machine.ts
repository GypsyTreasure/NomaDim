/**
 * NumericInputMachine (MASTER_DOCUMENT F2, ARCHITECTURE §10): a PURE state
 * machine for Shapr3D-style floating numeric fields. Typing focuses the
 * first field, `Tab` cycles fields, `Enter` commits with typed values
 * overriding cursor position, `Esc` cancels. No DOM, no React — the app
 * layer feeds it key events and renders its state.
 *
 * Committed values are baked into geometry (ADR-0002): the machine emits
 * numbers once and holds no live links afterwards.
 */

export type FieldKind = 'length' | 'angle' | 'count';

export interface FieldDef {
  /** Stable field id, also the i18n label key suffix (app resolves `t()`). */
  readonly id: string;
  readonly kind: FieldKind;
}

export interface NumericInputState {
  readonly fields: readonly FieldDef[];
  /** Raw text per field ('' = untouched — cursor drives that dimension). */
  readonly values: readonly string[];
  /** Focused field index, or null when input is cursor-driven. */
  readonly activeIndex: number | null;
}

export type NumericInputEvent =
  | { readonly type: 'char'; readonly char: string }
  | { readonly type: 'backspace' }
  | { readonly type: 'tab' }
  | { readonly type: 'enter' }
  | { readonly type: 'escape' }
  | { readonly type: 'setFields'; readonly fields: readonly FieldDef[] }
  | { readonly type: 'clearValues' };

export type NumericInputEffect =
  | { readonly kind: 'commit'; readonly values: readonly (number | null)[] }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'none' };

export interface NumericInputTransition {
  readonly state: NumericInputState;
  readonly effect: NumericInputEffect;
}

const NONE: NumericInputEffect = { kind: 'none' };

export function initialInputState(fields: readonly FieldDef[]): NumericInputState {
  return { fields, values: fields.map(() => ''), activeIndex: null };
}

const ACCEPTED_CHARS = /^[0-9.-]$/;

function withValue(state: NumericInputState, index: number, text: string): NumericInputState {
  const values = state.values.map((v, i) => (i === index ? text : v));
  return { ...state, values };
}

/** Parses one field: null when untouched/unparseable (cursor value applies). */
export function parseField(def: FieldDef, text: string): number | null {
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  switch (def.kind) {
    case 'length':
      return value > 0 ? value : null;
    case 'angle':
      return value;
    case 'count':
      return Number.isInteger(value) && value >= 3 ? value : null;
    default: {
      const exhaustive: never = def.kind;
      return exhaustive;
    }
  }
}

export function parsedValues(state: NumericInputState): readonly (number | null)[] {
  return state.fields.map((def, i) => parseField(def, state.values[i] ?? ''));
}

export function reduceInput(
  state: NumericInputState,
  event: NumericInputEvent
): NumericInputTransition {
  switch (event.type) {
    case 'char': {
      if (!ACCEPTED_CHARS.test(event.char)) return { state, effect: NONE };
      if (state.fields.length === 0) return { state, effect: NONE };
      // Typing focuses field 1 (F2) and starts it fresh; typing into an
      // already-focused field appends.
      const index = state.activeIndex ?? 0;
      const current = state.activeIndex === null ? '' : (state.values[index] ?? '');
      const next = withValue({ ...state, activeIndex: index }, index, current + event.char);
      return { state: next, effect: NONE };
    }
    case 'backspace': {
      if (state.activeIndex === null) return { state, effect: NONE };
      const current = state.values[state.activeIndex] ?? '';
      return {
        state: withValue(state, state.activeIndex, current.slice(0, -1)),
        effect: NONE,
      };
    }
    case 'tab': {
      if (state.fields.length === 0) return { state, effect: NONE };
      const next = state.activeIndex === null ? 0 : (state.activeIndex + 1) % state.fields.length;
      return { state: { ...state, activeIndex: next }, effect: NONE };
    }
    case 'enter':
      return {
        state: initialInputState(state.fields),
        effect: { kind: 'commit', values: parsedValues(state) },
      };
    case 'escape':
      return { state: initialInputState(state.fields), effect: { kind: 'cancel' } };
    case 'setFields':
      return { state: initialInputState(event.fields), effect: NONE };
    case 'clearValues':
      return { state: initialInputState(state.fields), effect: NONE };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
