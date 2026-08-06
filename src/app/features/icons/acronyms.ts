import type { IconName } from './Icon';

/**
 * Two-to-three-letter tag shown under every toolbar icon (#5b) — a compact,
 * always-visible name so a tool is findable at a glance (Fusion/AutoCAD-style
 * captions), complementing the picture and the "label (shortcut)" tooltip.
 *
 * Keyed by `IconName` so the map is EXHAUSTIVE over the icon set — adding an
 * icon without a tag is a compile error, which is exactly the "every single
 * icon has an acronym" requirement enforced by the type system. Tags are
 * locale-independent UI glyphs (like the keyboard chords of ADR-0032), part of
 * the icon's visual identity rather than translatable content, so they live in
 * the icon system, not the i18n catalog (ADR-0107).
 */
export const ICON_ACRONYMS: Record<IconName, string> = {
  // Common / header
  browser: 'BRW',
  view: 'VW',
  measure: 'MSR',
  construct: 'CST',
  plane: 'PLN',
  axis: 'DAX',
  newProject: 'NEW',
  save: 'SAV',
  open: 'OPN',
  importStep: 'STP',
  exportStl: 'STL',
  projects: 'PRJ',
  settings: 'SET',
  license: 'LIC',
  help: 'HLP',
  menu: 'MNU',
  undo: 'UND',
  redo: 'RDO',
  // Sketch tools
  finish: 'FIN',
  select: 'SEL',
  change: 'CHG',
  dimension: 'DIM',
  split: 'SPL',
  stretch: 'STR',
  offset: 'OFS',
  line: 'LN',
  centerline: 'AX',
  rectangle: 'REC',
  rectangleCenter: 'RCC',
  circle: 'CIR',
  arc: 'ARC',
  arcCenter: 'ACC',
  point: 'PT',
  polygon: 'PLY',
  spline: 'SPN',
  construction: 'CNS',
  snap: 'SNP',
  ortho: 'ORT',
  intersect: 'INT',
  delete: 'DEL',
  importSketch: 'IMP',
  mirror: 'MIR',
  mirrorY: 'MRY',
  // 3D operations
  pattern: 'PAT',
  newSketch: 'SKT',
  extrude: 'EXT',
  revolve: 'REV',
  fillet: 'FIL',
  chamfer: 'CHM',
  combine: 'CMB',
  copyBody: 'CPY',
  shell: 'SHL',
  move: 'MOV',
};
