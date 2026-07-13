/**
 * Shared helpers over fast-xml-parser's raw output, private to
 * `document/xml/` and the op codecs (ARCHITECTURE §11: XML never leaks past
 * the codec layer — these helpers keep the parsed shape `unknown`-typed at
 * every boundary).
 */

export type Raw = Record<string, unknown>;

export function asRaw(value: unknown): Raw | null {
  return typeof value === 'object' && value !== null ? (value as Raw) : null;
}

export function asRawArray(value: unknown): Raw[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((item) => {
    const raw = asRaw(item);
    return raw ? [raw] : [];
  });
}

export function strAttr(raw: Raw, name: string): string | null {
  const value = raw[`@_${name}`];
  return typeof value === 'string' ? value : null;
}

export function numAttr(raw: Raw, name: string): number | null {
  const text = strAttr(raw, name);
  if (text === null) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function boolAttr(raw: Raw, name: string): boolean | null {
  const text = strAttr(raw, name);
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}
