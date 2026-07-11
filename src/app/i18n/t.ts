import { en, type TranslationKey } from './en';

/**
 * In-house minimal translation function (ADR-0007). EN-only catalog for v1;
 * a PL catalog drops in at v1.1 by adding a second flat map here — no
 * library dependency needed for this scope.
 */
export function t(key: TranslationKey): string {
  return en[key];
}
