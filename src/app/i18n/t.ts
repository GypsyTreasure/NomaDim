import { en, type TranslationKey } from './en';
import { de } from './de';
import { fr } from './fr';
import { uk } from './uk';
import { pl } from './pl';

export type { TranslationKey } from './en';

/**
 * In-house minimal i18n (ADR-0007, extended ADR-0126). English is the master
 * catalog; DE/FR/UK/PL are full mirrors typed `satisfies Record<TranslationKey,
 * string>`, so a missing key is a build error and every future string must be
 * translated to all five. No library dependency for this scope.
 *
 * `t()` reads a module-level active locale. The language is persisted in the
 * settings store; changing it reloads the page (settingsStore), so `t()` is
 * synchronous and always paints the right catalog from the first frame.
 */

export const LOCALES = ['en', 'de', 'fr', 'uk', 'pl'] as const;
export type Locale = (typeof LOCALES)[number];

/** Endonyms for the language picker (each shown in its own language). */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  uk: 'Українська',
  pl: 'Polski',
};

const CATALOGS: Record<Locale, Record<TranslationKey, string>> = { en, de, fr, uk, pl };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Read the persisted UI language directly from localStorage (the same key the
 * settings store uses) so the first paint is already localized — without
 * importing the store here (keeps this a dependency-free leaf).
 */
function initialLocale(): Locale {
  try {
    if (typeof localStorage === 'undefined') return 'en';
    const raw = localStorage.getItem('nomadim.settings');
    if (!raw) return 'en';
    const lang = (JSON.parse(raw) as { language?: unknown }).language;
    return isLocale(lang) ? lang : 'en';
  } catch {
    return 'en';
  }
}

let currentLocale: Locale = initialLocale();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/** Translate a key in the active locale, falling back to English. */
export function t(key: TranslationKey): string {
  return CATALOGS[currentLocale][key] || en[key];
}
