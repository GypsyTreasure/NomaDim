import { create } from 'zustand';

/**
 * Application settings (Admin panel, post-M12). User-level preferences that are
 * NOT part of a document: UI language, default export parameters, autosave
 * retention, and the export-filename naming pattern. Persisted to localStorage
 * (static-host safe — no backend) and re-hydrated on load. Kept deliberately
 * separate from the document model: changing a preference never mutates or
 * dirties the open project.
 */

/** Only English ships today; the field exists so the panel can offer it (F-i18n). */
export type AppLanguage = 'en';

export type StlFormat = 'binary' | 'ascii';

export interface Settings {
  readonly language: AppLanguage;
  /** Default STL export format offered by the export dialog. */
  readonly stlFormat: StlFormat;
  /** Default STL linear deflection (mm) and angular deflection (deg). */
  readonly stlLinearDeflectionMm: number;
  readonly stlAngularDeflectionDeg: number;
  /**
   * Autosave retention. `null` = keep the last project forever (default); a
   * positive number of days discards an autosaved project older than that, so
   * you return to a fresh empty document instead of a stale model.
   */
  readonly autosaveTtlDays: number | null;
  /** Export-filename pattern pieces (F7). base + project name + timestamp + revision. */
  readonly namingBase: string;
  readonly namingIncludeProjectName: boolean;
  readonly namingIncludeDate: boolean;
  readonly namingIncludeRevision: boolean;
  readonly namingRevision: number;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  stlFormat: 'binary',
  stlLinearDeflectionMm: 0.1,
  stlAngularDeflectionDeg: 15,
  autosaveTtlDays: null,
  namingBase: 'NomaDim',
  namingIncludeProjectName: true,
  namingIncludeDate: true,
  namingIncludeRevision: false,
  namingRevision: 1,
};

const STORAGE_KEY = 'nomadim.settings';

/** Coerces an untrusted parsed object to Settings, per-field, falling back to defaults. */
function sanitize(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
  return {
    language: 'en',
    stlFormat: r.stlFormat === 'ascii' ? 'ascii' : 'binary',
    stlLinearDeflectionMm: num(r.stlLinearDeflectionMm, DEFAULT_SETTINGS.stlLinearDeflectionMm),
    stlAngularDeflectionDeg: num(
      r.stlAngularDeflectionDeg,
      DEFAULT_SETTINGS.stlAngularDeflectionDeg
    ),
    autosaveTtlDays:
      r.autosaveTtlDays === null
        ? null
        : num(r.autosaveTtlDays, DEFAULT_SETTINGS.autosaveTtlDays ?? 0) || null,
    namingBase: str(r.namingBase, DEFAULT_SETTINGS.namingBase),
    namingIncludeProjectName: bool(r.namingIncludeProjectName, true),
    namingIncludeDate: bool(r.namingIncludeDate, true),
    namingIncludeRevision: bool(r.namingIncludeRevision, false),
    namingRevision: Math.max(1, Math.round(num(r.namingRevision, 1))),
  };
}

function load(): Settings {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    return text ? sanitize(JSON.parse(text)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS; // private mode / corrupt JSON → defaults
  }
}

function persist(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage disabled — settings live for this session only */
  }
}

interface SettingsStore {
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
  readonly reset: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: load(),
  update: (patch) => {
    const next = { ...get().settings, ...patch };
    persist(next);
    set({ settings: next });
  },
  reset: () => {
    persist(DEFAULT_SETTINGS);
    set({ settings: DEFAULT_SETTINGS });
  },
}));

/** Hook: the current settings object. */
export function useSettings(): Settings {
  return useSettingsStore((s) => s.settings);
}

/** Non-reactive read for callers outside React (export handlers, autosave). */
export function getSettings(): Settings {
  return useSettingsStore.getState().settings;
}
