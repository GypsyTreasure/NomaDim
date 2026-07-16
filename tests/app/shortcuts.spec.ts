import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS } from '../../src/app/features/help/shortcuts';
import { en } from '../../src/app/i18n/en';

/**
 * The shortcuts catalog (F11) drives the help overlay. Every title/description
 * must resolve to a real EN string, and every row must carry a key chord.
 */

describe('SHORTCUT_GROUPS', () => {
  it('references only real translation keys', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(en[group.title]).toBeDefined();
      for (const item of group.items) {
        expect(en[item.desc]).toBeDefined();
      }
    }
  });

  it('every row has a non-empty key chord', () => {
    for (const group of SHORTCUT_GROUPS) {
      for (const item of group.items) {
        expect(item.keys.length).toBeGreaterThan(0);
      }
    }
  });

  it('lists the core tool hotkeys', () => {
    const allKeys = SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.keys));
    for (const chord of ['L', 'R', 'C', 'A', 'P', 'G']) {
      expect(allKeys).toContain(chord);
    }
  });
});
