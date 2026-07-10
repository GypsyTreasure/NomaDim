/** Flat EN string catalog (CLAUDE.md: all user-visible strings via t('key') from day one). */
export const en = {
  'app.title': 'NomaDim',
  'viewport.zoomToFit': 'Zoom to Fit',
  'viewport.origin.xy': 'XY Plane',
  'viewport.origin.xz': 'XZ Plane',
  'viewport.origin.yz': 'YZ Plane',
  'kernelDemo.status.loading': 'Loading kernel…',
  'kernelDemo.status.error': 'Kernel error:',
  'kernelDemo.exportStl': 'Export STL',
  'kernelDemo.dispose': 'Dispose Body',
  'kernelDemo.liveHandlesLabel': 'Live handles:',
} as const;

export type TranslationKey = keyof typeof en;
