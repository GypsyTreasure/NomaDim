import { describe, expect, it } from 'vitest';
import { applyStlWatermark, FREE_WATERMARK } from '../../src/app/features/licensing/watermark';

/**
 * M11 free-tier watermark: stamped into the STL's free-text region without
 * altering geometry. Pro exports skip it entirely (tested by not calling it).
 */

describe('applyStlWatermark', () => {
  it('stamps the binary 80-byte header without changing the triangle data', () => {
    // 80-byte header + 4-byte tri count (0) — a valid empty binary STL.
    const src = new ArrayBuffer(84);
    new DataView(src).setUint32(80, 0, true);
    const out = applyStlWatermark(src, 'binary');
    expect(out.byteLength).toBe(84);
    const header = new TextDecoder().decode(new Uint8Array(out, 0, 80)).replace(/\0+$/, '');
    expect(header).toContain('NomaDim');
    // Header must not begin with "solid" (keeps binary detection intact).
    expect(header.startsWith('solid')).toBe(false);
    // Triangle count preserved.
    expect(new DataView(out).getUint32(80, true)).toBe(0);
  });

  it('rewrites the ASCII solid name', () => {
    const ascii = 'solid part\nfacet normal 0 0 1\nendsolid part\n';
    const out = new TextDecoder().decode(
      applyStlWatermark(new TextEncoder().encode(ascii).buffer, 'ascii')
    );
    expect(out.startsWith(`solid ${FREE_WATERMARK}`)).toBe(true);
    expect(out).toContain('facet normal 0 0 1'); // geometry untouched
  });

  it('does not mutate the input buffer', () => {
    const src = new ArrayBuffer(84);
    const before = new Uint8Array(src.slice(0));
    applyStlWatermark(src, 'binary');
    expect(new Uint8Array(src)).toEqual(before);
  });
});
