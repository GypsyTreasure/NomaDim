import type { TranslationKey } from '../../i18n/en';

/**
 * The keyboard-shortcuts catalog behind the help overlay (F11). Single source
 * of truth for the "?" panel — kept in sync by hand with the handlers in
 * `useGlobalShortcuts` (global) and `useSketcher` (sketch mode). Key chords are
 * symbolic and locale-independent; descriptions and section titles translate.
 */

export interface Shortcut {
  /** Display chord, e.g. "Ctrl+Z" or "Tab". */
  readonly keys: string;
  readonly desc: TranslationKey;
}

export interface ShortcutGroup {
  readonly title: TranslationKey;
  readonly items: readonly Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'help.group.global',
    items: [
      { keys: 'Ctrl+Z', desc: 'help.undo' },
      { keys: 'Ctrl+Y', desc: 'help.redo' },
      { keys: 'Ctrl+C', desc: 'help.copyBody' },
      { keys: 'Ctrl+V', desc: 'help.pasteBody' },
      { keys: '?', desc: 'help.toggleHelp' },
    ],
  },
  {
    title: 'help.group.sketchTools',
    items: [
      { keys: 'L', desc: 'help.tool.line' },
      { keys: 'R', desc: 'help.tool.rectangle' },
      { keys: 'C', desc: 'help.tool.circle' },
      { keys: 'A', desc: 'help.tool.arc' },
      { keys: 'P', desc: 'help.tool.point' },
      { keys: 'G', desc: 'help.tool.polygon' },
      { keys: 'X', desc: 'help.construction' },
    ],
  },
  {
    title: 'help.group.sketchInput',
    items: [
      { keys: 'Tab', desc: 'help.tab' },
      { keys: 'Enter', desc: 'help.enter' },
      { keys: 'Esc', desc: 'help.esc' },
      { keys: 'Delete', desc: 'help.delete' },
    ],
  },
];
