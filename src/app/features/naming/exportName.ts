import { getSettings, type Settings } from '../../store/settingsStore';
import { useDocumentStore } from '../../store/documentStore';

/**
 * Export-filename builder (F7, Admin panel). Every exported artifact — STL,
 * STEP, `.nomadim.xml` — is named from the project name plus the user's naming
 * pattern (base text · project name · date-time · revision). Pure and testable;
 * `exportFileName` is the live wrapper that reads the current document + settings
 * at click time.
 */

/** Keeps letters/digits/dash/underscore/dot; other runs collapse to a single '-'. */
export function sanitizeNamePart(part: string): string {
  return part
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Local `YYYYMMDD-HHmm` stamp (no separators that would be unsafe in a filename). */
export function timestamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${String(now.getFullYear())}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}`
  );
}

/**
 * The base filename (no extension) from a project name + settings. Falls back to
 * 'model' when every enabled part is empty, so exports always have a real name.
 */
export function buildExportBaseName(
  projectName: string,
  settings: Settings,
  now: Date = new Date()
): string {
  const parts: string[] = [];
  if (settings.namingBase) parts.push(settings.namingBase);
  if (settings.namingIncludeProjectName && projectName) parts.push(projectName);
  if (settings.namingIncludeDate) parts.push(timestamp(now));
  if (settings.namingIncludeRevision) parts.push(`r${String(settings.namingRevision)}`);
  const joined = parts.map(sanitizeNamePart).filter(Boolean).join('_');
  return joined || 'model';
}

/**
 * Live filename for the current project. `ext` includes the dot, e.g. '.stl' or
 * '.nomadim.xml'.
 */
export function exportFileName(ext: string): string {
  const name = useDocumentStore.getState().document.name;
  return `${buildExportBaseName(name, getSettings())}${ext}`;
}
