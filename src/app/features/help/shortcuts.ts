import type { TranslationKey } from '../../i18n/en';

/**
 * The keyboard-shortcuts catalog behind the help overlay (F11) and the project
 * master rule (ADR-0032): every menu button has a shortcut, and every shortcut
 * is listed here. Single source of truth for the "?" panel — kept in sync by
 * hand with the handlers (useSketcher, useModelingShortcuts, DocumentIO,
 * ExportStlButton, Viewport). Key chords are symbolic and locale-independent;
 * descriptions and section titles translate.
 */

export interface Shortcut {
  /** Display chord, e.g. "Ctrl+Z" or "Shift+R". */
  readonly keys: string;
  readonly desc: TranslationKey;
}

export interface ShortcutGroup {
  readonly title: TranslationKey;
  readonly items: readonly Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'help.group.general',
    items: [
      { keys: 'N', desc: 'help.newSketch' },
      { keys: 'Shift+N', desc: 'help.newProject' },
      { keys: 'M', desc: 'help.measure' },
      { keys: 'Ctrl+Z', desc: 'help.undo' },
      { keys: 'Ctrl+Y', desc: 'help.redo' },
      { keys: 'Ctrl+C', desc: 'help.copyBody' },
      { keys: 'Ctrl+V', desc: 'help.pasteBody' },
      { keys: '?', desc: 'help.toggleHelp' },
    ],
  },
  {
    title: 'help.group.model',
    items: [
      { keys: 'E', desc: 'help.extrude' },
      { keys: 'V', desc: 'help.revolve' },
      { keys: 'F', desc: 'help.fillet' },
      { keys: 'H', desc: 'help.chamfer' },
      { keys: 'B', desc: 'help.combine' },
      { keys: 'D', desc: 'help.copyOp' },
    ],
  },
  {
    title: 'help.group.document',
    items: [
      { keys: 'Ctrl+S', desc: 'help.save' },
      { keys: 'Ctrl+O', desc: 'help.open' },
      { keys: 'Ctrl+E', desc: 'help.export' },
    ],
  },
  {
    title: 'help.group.view',
    items: [
      { keys: 'Z', desc: 'help.zoomFit' },
      { keys: 'O', desc: 'help.projection' },
      { keys: '0', desc: 'help.viewHome' },
      { keys: '1', desc: 'help.viewFront' },
      { keys: '2', desc: 'help.viewBack' },
      { keys: '3', desc: 'help.viewLeft' },
      { keys: '4', desc: 'help.viewRight' },
      { keys: '5', desc: 'help.viewTop' },
      { keys: '6', desc: 'help.viewBottom' },
    ],
  },
  {
    title: 'help.group.sketchTools',
    items: [
      { keys: 'S', desc: 'help.tool.select' },
      { keys: 'M', desc: 'help.tool.change' },
      { keys: 'L', desc: 'help.tool.line' },
      { keys: 'I', desc: 'help.tool.axis' },
      { keys: 'R', desc: 'help.tool.rectangle' },
      { keys: 'Shift+R', desc: 'help.tool.rectangleCenter' },
      { keys: 'C', desc: 'help.tool.circle' },
      { keys: 'A', desc: 'help.tool.arc' },
      { keys: 'Shift+A', desc: 'help.tool.arcCenter' },
      { keys: 'P', desc: 'help.tool.point' },
      { keys: 'G', desc: 'help.tool.polygon' },
      { keys: 'D', desc: 'help.tool.dimension' },
      { keys: 'X', desc: 'help.construction' },
      { keys: 'Q', desc: 'help.snap' },
      { keys: 'J', desc: 'help.intersect' },
    ],
  },
  {
    title: 'help.group.sketchInput',
    items: [
      { keys: 'Tab', desc: 'help.tab' },
      { keys: 'Enter', desc: 'help.enter' },
      { keys: 'Esc', desc: 'help.esc' },
      { keys: 'Delete', desc: 'help.delete' },
      { keys: 'F', desc: 'help.finish' },
    ],
  },
];
