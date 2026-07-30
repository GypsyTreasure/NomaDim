import { describe, expect, it } from 'vitest';
import {
  buildExportBaseName,
  sanitizeNamePart,
  timestamp,
} from '../../src/app/features/naming/exportName';
import { DEFAULT_SETTINGS } from '../../src/app/store/settingsStore';

/** Export-filename builder (F7): pure, deterministic given settings + a clock. */
describe('export filename builder', () => {
  const now = new Date(2026, 6, 30, 11, 45); // local 2026-07-30 11:45

  it('sanitizes unsafe characters into single dashes', () => {
    expect(sanitizeNamePart('My Part / v2!')).toBe('My-Part-v2');
    expect(sanitizeNamePart('  spaced  ')).toBe('spaced');
    expect(sanitizeNamePart('a__b')).toBe('a__b'); // underscores are kept
  });

  it('stamps a filename-safe local timestamp', () => {
    expect(timestamp(now)).toBe('20260730-1145');
  });

  it('joins base + project name + date by default', () => {
    expect(buildExportBaseName('Bracket', DEFAULT_SETTINGS, now)).toBe(
      'NomaDim_Bracket_20260730-1145'
    );
  });

  it('omits the project name when blank', () => {
    expect(buildExportBaseName('', DEFAULT_SETTINGS, now)).toBe('NomaDim_20260730-1145');
  });

  it('includes the revision only when enabled', () => {
    const withRev = { ...DEFAULT_SETTINGS, namingIncludeRevision: true, namingRevision: 3 };
    expect(buildExportBaseName('Part', withRev, now)).toBe('NomaDim_Part_20260730-1145_r3');
  });

  it('falls back to "model" when every part is disabled/empty', () => {
    const bare = {
      ...DEFAULT_SETTINGS,
      namingBase: '',
      namingIncludeProjectName: false,
      namingIncludeDate: false,
      namingIncludeRevision: false,
    };
    expect(buildExportBaseName('', bare, now)).toBe('model');
  });
});
