import { describe, expect, it } from 'vitest';
import { ICON_ACRONYMS } from '../../src/app/features/icons/acronyms';

/**
 * Every toolbar icon carries a 2–3-letter acronym caption (#5b, ADR-0107). The
 * map is keyed by `IconName`, so TypeScript already guarantees completeness at
 * compile time; these tests guard the shape at runtime.
 */
describe('icon acronyms (#5b)', () => {
  const entries = Object.entries(ICON_ACRONYMS);

  it('every acronym is 2–3 uppercase letters', () => {
    for (const [name, acr] of entries) {
      expect(acr, name).toMatch(/^[A-Z]{2,3}$/);
    }
  });

  it('has a tag for the tools the owner named (line → LN, extrude → EXT)', () => {
    expect(ICON_ACRONYMS.line).toBe('LN');
    expect(ICON_ACRONYMS.extrude).toBe('EXT');
  });

  it('tags are reasonably distinct (few collisions across the icon set)', () => {
    const counts = new Map<string, number>();
    for (const [, acr] of entries) counts.set(acr, (counts.get(acr) ?? 0) + 1);
    const collisions = [...counts.values()].filter((n) => n > 1).length;
    expect(collisions).toBe(0);
  });
});
