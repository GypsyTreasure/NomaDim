import { describe, it, expect, afterEach } from 'vitest';
import { en } from '../../src/app/i18n/en';
import { de } from '../../src/app/i18n/de';
import { fr } from '../../src/app/i18n/fr';
import { uk } from '../../src/app/i18n/uk';
import { pl } from '../../src/app/i18n/pl';
import { LOCALES, LOCALE_LABELS, getLocale, setLocale, t } from '../../src/app/i18n/t';

/**
 * i18n invariants (ADR-0126): the five catalogs stay in lockstep and `t()`
 * resolves the active locale with an English fallback. The `satisfies` typing
 * already enforces completeness at compile time; these guard it at runtime and
 * catch accidental empty strings.
 */
describe('i18n catalogs', () => {
  const enKeys = Object.keys(en).sort();
  const catalogs = { de, fr, uk, pl } as const;

  afterEach(() => {
    setLocale('en');
  });

  it('exposes exactly the five supported locales, each with a label', () => {
    expect([...LOCALES]).toEqual(['en', 'de', 'fr', 'uk', 'pl']);
    for (const loc of LOCALES) expect(LOCALE_LABELS[loc].length).toBeGreaterThan(0);
  });

  for (const [name, cat] of Object.entries(catalogs)) {
    it(`${name} has the same keys as en, all non-empty`, () => {
      expect(Object.keys(cat).sort()).toEqual(enKeys);
      for (const value of Object.values(cat)) expect(value.trim().length).toBeGreaterThan(0);
    });
  }

  it('t() returns the active locale, falling back to English', () => {
    setLocale('pl');
    expect(t('dialog.ok')).toBe(pl['dialog.ok']);
    expect(getLocale()).toBe('pl');
    setLocale('de');
    expect(t('op.extrude')).toBe(de['op.extrude']);
    setLocale('en');
    expect(t('op.extrude')).toBe(en['op.extrude']);
  });
});
