import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { documentFromXml } from '../../src/document';
import { SAMPLES } from '../../src/app/features/samples/samples';

/**
 * M12 sample projects: every shipped `.nomadim.xml` must parse through the
 * document codec and carry a buildable Extrude (a profile-referencing op), so
 * "Load sample" always produces a real body.
 */

describe('sample projects', () => {
  for (const sample of SAMPLES) {
    it(`${sample.id} parses and has a profile-referencing Extrude`, () => {
      const xml = readFileSync(`public/samples/${sample.file}`, 'utf-8');
      const result = documentFromXml(xml);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // TS infers a type predicate here, narrowing `extrude` to the Extrude op.
      const extrude = result.value.ops.find((o) => o.type === 'Extrude');
      expect(extrude).toBeDefined();
      expect(extrude?.profileIds.length ?? 0).toBeGreaterThan(0);
      // Exactly one sketch + one extrude per sample.
      expect(result.value.sketches).toHaveLength(1);
    });
  }
});
