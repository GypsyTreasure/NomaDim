/**
 * Free-tier STL watermark (M11). Stamps a short attribution into the STL
 * without touching a single triangle, so the mesh stays byte-for-byte
 * printable — Pro exports simply skip this. It is embedded where STL carries
 * free-form text:
 *  - **binary**: the 80-byte header (never starts with "solid", so parsers
 *    still detect binary correctly);
 *  - **ASCII**: the `solid <name>` token on the first (and closing) line.
 */

export const FREE_WATERMARK = 'Made with NomaDim (free) - nomadim';

/** Returns a new ArrayBuffer with the watermark stamped in; input untouched. */
export function applyStlWatermark(
  data: ArrayBuffer,
  format: 'binary' | 'ascii',
  text: string = FREE_WATERMARK
): ArrayBuffer {
  return format === 'ascii' ? asciiWatermark(data, text) : binaryWatermark(data, text);
}

function binaryWatermark(data: ArrayBuffer, text: string): ArrayBuffer {
  const out = data.slice(0);
  const view = new Uint8Array(out);
  const header = new TextEncoder().encode(text.slice(0, 79)); // keep < 80, never "solid…"
  view.fill(0, 0, 80);
  view.set(header.subarray(0, 80), 0);
  return out;
}

const SOLID_NAME = /^solid[^\n]*/;

function asciiWatermark(data: ArrayBuffer, text: string): ArrayBuffer {
  const stl = new TextDecoder().decode(data);
  const safe = text.replace(/[\r\n]+/g, ' ');
  const stamped = SOLID_NAME.test(stl)
    ? stl.replace(SOLID_NAME, `solid ${safe}`)
    : `solid ${safe}\n${stl}`;
  return new TextEncoder().encode(stamped).buffer;
}
