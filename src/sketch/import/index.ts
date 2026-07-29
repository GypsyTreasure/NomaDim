import { parseDxf } from './dxf';
import { parseSvg } from './svg';
import type { ImportResult } from './types';

export type { ImportPrimitive, ImportResult } from './types';
export { parseSvg } from './svg';
export { parseDxf } from './dxf';

/** Parses a reference file by extension (falling back to content sniffing). */
export function parseReferenceFile(fileName: string, text: string): ImportResult {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.dxf')) return parseDxf(text);
  if (lower.endsWith('.svg')) return parseSvg(text);
  // Content sniff: SVG is XML with an <svg tag; DXF starts with a group code.
  if (/<svg[\s>]/i.test(text)) return parseSvg(text);
  return parseDxf(text);
}
