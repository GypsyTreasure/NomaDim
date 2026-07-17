import { describe, expect, it } from 'vitest';
import {
  fieldsForTool,
  initialInputState,
  parseField,
  parsedValues,
  reduceInput,
  LINE_FIELDS,
  LINE_FIELDS_CHAINED,
  type NumericInputEvent,
  type NumericInputState,
} from '../../src/sketch';

function run(state: NumericInputState, ...events: NumericInputEvent[]) {
  let s = state;
  let lastEffect: ReturnType<typeof reduceInput>['effect'] = { kind: 'none' };
  for (const e of events) {
    const t = reduceInput(s, e);
    s = t.state;
    lastEffect = t.effect;
  }
  return { state: s, effect: lastEffect };
}

const type = (text: string): NumericInputEvent[] =>
  Array.from(text, (char) => ({ type: 'char', char }) as const);

describe('NumericInputMachine transitions (MASTER_DOCUMENT F2)', () => {
  it('typing focuses field 1 and appends characters', () => {
    const { state } = run(initialInputState(LINE_FIELDS), ...type('42.5'));
    expect(state.activeIndex).toBe(0);
    expect(state.values).toEqual(['42.5', '']);
  });

  it('ignores non-numeric characters', () => {
    const { state } = run(initialInputState(LINE_FIELDS), ...type('4x2'));
    expect(state.values).toEqual(['42', '']);
  });

  it('Tab cycles fields and wraps', () => {
    const s0 = initialInputState(LINE_FIELDS_CHAINED);
    const s1 = run(s0, { type: 'tab' }).state;
    expect(s1.activeIndex).toBe(0);
    const s2 = run(s1, { type: 'tab' }, { type: 'tab' }).state;
    expect(s2.activeIndex).toBe(2);
    expect(run(s2, { type: 'tab' }).state.activeIndex).toBe(0); // wrap
  });

  it('focus selects a field by index (mouse), then typing writes it', () => {
    const s0 = initialInputState(LINE_FIELDS_CHAINED);
    const s1 = run(s0, { type: 'focus', index: 2 }).state;
    expect(s1.activeIndex).toBe(2);
    expect(run(s1, ...type('30')).state.values).toEqual(['', '', '30']);
  });

  it('focus ignores an out-of-range index', () => {
    const s0 = initialInputState(LINE_FIELDS);
    expect(run(s0, { type: 'focus', index: 5 }).state.activeIndex).toBeNull();
    expect(run(s0, { type: 'focus', index: -1 }).state.activeIndex).toBeNull();
  });

  it('coord fields accept negative and zero (start-point entry)', () => {
    const coord = { id: 'startX', kind: 'coord' } as const;
    expect(parseField(coord, '-12.5')).toBe(-12.5);
    expect(parseField(coord, '0')).toBe(0);
    expect(parseField(coord, '')).toBeNull();
  });

  it('Tab then typing writes the newly focused field', () => {
    const { state } = run(
      initialInputState(LINE_FIELDS),
      ...type('40'),
      { type: 'tab' },
      ...type('90')
    );
    expect(state.values).toEqual(['40', '90']);
  });

  it('backspace edits the active field only', () => {
    const { state } = run(initialInputState(LINE_FIELDS), ...type('425'), { type: 'backspace' });
    expect(state.values).toEqual(['42', '']);
    // Backspace with no focus is a no-op.
    const untouched = run(initialInputState(LINE_FIELDS), { type: 'backspace' });
    expect(untouched.state.values).toEqual(['', '']);
  });

  it('Enter commits typed values, null for untouched fields, and resets', () => {
    const { state, effect } = run(initialInputState(LINE_FIELDS), ...type('40'), {
      type: 'enter',
    });
    expect(effect).toEqual({ kind: 'commit', values: [40, null] });
    expect(state.values).toEqual(['', '']);
    expect(state.activeIndex).toBeNull();
  });

  it('Escape cancels and resets', () => {
    const { state, effect } = run(initialInputState(LINE_FIELDS), ...type('40'), {
      type: 'escape',
    });
    expect(effect).toEqual({ kind: 'cancel' });
    expect(state.values).toEqual(['', '']);
  });

  it('length fields reject non-positive values; angles accept negatives', () => {
    const negLength = run(initialInputState(LINE_FIELDS), ...type('-5'), { type: 'enter' });
    expect(negLength.effect).toEqual({ kind: 'commit', values: [null, null] });

    const negAngle = run(
      initialInputState(LINE_FIELDS),
      { type: 'tab' },
      { type: 'tab' },
      ...type('-45'),
      { type: 'enter' }
    );
    expect(negAngle.effect).toEqual({ kind: 'commit', values: [null, -45] });
  });

  it('count fields require integers >= 3 (polygon sides)', () => {
    const fields = fieldsForTool('polygon');
    const bad = run(initialInputState(fields), ...type('2'), { type: 'enter' });
    expect(bad.effect).toEqual({ kind: 'commit', values: [null, null] });
    const good = run(initialInputState(fields), ...type('6'), { type: 'enter' });
    expect(good.effect).toEqual({ kind: 'commit', values: [6, null] });
  });

  it('setFields swaps definitions and clears values (chained line gains angleRel)', () => {
    const { state } = run(initialInputState(LINE_FIELDS), ...type('40'), {
      type: 'setFields',
      fields: LINE_FIELDS_CHAINED,
    });
    expect(state.fields.map((f) => f.id)).toEqual(['length', 'angleAbs', 'angleRel']);
    expect(state.values).toEqual(['', '', '']);
    expect(state.activeIndex).toBeNull();
  });

  it('clearValues keeps fields (next chained segment)', () => {
    const { state } = run(initialInputState(LINE_FIELDS_CHAINED), ...type('40'), {
      type: 'clearValues',
    });
    expect(state.fields).toBe(LINE_FIELDS_CHAINED);
    expect(state.values).toEqual(['', '', '']);
  });

  it('typing with zero fields (point tool) is inert', () => {
    const { state, effect } = run(initialInputState(fieldsForTool('point')), ...type('5'), {
      type: 'tab',
    });
    expect(state.activeIndex).toBeNull();
    expect(effect).toEqual({ kind: 'none' });
  });

  it('unparseable text commits as null', () => {
    const { effect } = run(initialInputState(LINE_FIELDS), ...type('4.2.5'), { type: 'enter' });
    expect(effect).toEqual({ kind: 'commit', values: [null, null] });
  });

  it('parsedValues previews without committing', () => {
    const { state } = run(
      initialInputState(LINE_FIELDS),
      ...type('12'),
      { type: 'tab' },
      ...type('30')
    );
    expect(parsedValues(state)).toEqual([12, 30]);
  });
});

describe('fieldsForTool (MASTER_DOCUMENT F2 field sets)', () => {
  it('matches the spec per tool', () => {
    expect(fieldsForTool('line').map((f) => f.id)).toEqual(['length', 'angleAbs']);
    expect(fieldsForTool('line', true).map((f) => f.id)).toEqual([
      'length',
      'angleAbs',
      'angleRel',
    ]);
    expect(fieldsForTool('rectangle-2p').map((f) => f.id)).toEqual(['width', 'height']);
    expect(fieldsForTool('rectangle-center').map((f) => f.id)).toEqual(['width', 'height']);
    expect(fieldsForTool('circle-center-diameter').map((f) => f.id)).toEqual(['diameter']);
    expect(fieldsForTool('arc-3p').map((f) => f.id)).toEqual(['radius']);
    expect(fieldsForTool('arc-center').map((f) => f.id)).toEqual(['radius', 'angle']);
    expect(fieldsForTool('polygon').map((f) => f.id)).toEqual(['sides', 'diameter']);
    expect(fieldsForTool('point')).toEqual([]);
  });
});
