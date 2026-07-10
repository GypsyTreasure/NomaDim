/** Flat EN string catalog (CLAUDE.md: all user-visible strings via t('key') from day one). */
export const en = {
  'app.title': 'NomaDim',
  'viewport.zoomToFit': 'Zoom to Fit',
  'viewport.origin.xy': 'XY Plane',
  'viewport.origin.xz': 'XZ Plane',
  'viewport.origin.yz': 'YZ Plane',
} as const;

export type TranslationKey = keyof typeof en;
