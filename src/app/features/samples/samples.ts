import type { TranslationKey } from '../../i18n/en';
import { loadDocumentText } from '../document-io/documentIO';

/**
 * Built-in sample projects (M12). Each is a `.nomadim.xml` fixture in
 * `public/samples/` loaded through the ordinary document load path
 * (`loadDocumentText` → the one write path → full regen) — no new write path.
 */

export interface SampleProject {
  readonly id: string;
  readonly file: string;
  readonly nameKey: TranslationKey;
  readonly descKey: TranslationKey;
}

export const SAMPLES: readonly SampleProject[] = [
  { id: 'plate', file: 'plate.nomadim.xml', nameKey: 'sample.plate', descKey: 'sample.plate.desc' },
  {
    id: 'plate-with-hole',
    file: 'plate-with-hole.nomadim.xml',
    nameKey: 'sample.plateHole',
    descKey: 'sample.plateHole.desc',
  },
  { id: 'bar', file: 'bar.nomadim.xml', nameKey: 'sample.bar', descKey: 'sample.bar.desc' },
];

/** The sample offered as the first-run tutorial project. */
export const TUTORIAL_SAMPLE_ID = 'plate-with-hole';

/** Fetches a sample and loads it through the write path. Returns an error string or null. */
export async function loadSample(file: string): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/${file}`);
    if (!res.ok) return `HTTP ${String(res.status)}`;
    return loadDocumentText(await res.text());
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
