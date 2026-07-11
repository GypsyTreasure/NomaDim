/**
 * Minimal deterministic XML writer, private to `document/xml/`
 * (ARCHITECTURE §11: nothing outside this directory may build or parse XML
 * strings). Hand-built rather than fast-xml-parser's XMLBuilder because the
 * builder groups children by tag name, which would break the spec-shaped
 * mixed-child ordering inside `<entities>`; determinism here is exact by
 * construction — attributes emit in insertion order, children in array
 * order, callers pre-sort collections.
 */

export type XmlAttrValue = string | number | boolean;

export interface XmlElement {
  readonly tag: string;
  readonly attrs?: Readonly<Record<string, XmlAttrValue>>;
  readonly children?: readonly XmlElement[];
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Numbers serialize via String(), which round-trips doubles exactly. */
function formatValue(value: XmlAttrValue): string {
  return typeof value === 'string' ? escapeAttr(value) : String(value);
}

function writeElement(element: XmlElement, indent: string, out: string[]): void {
  const attrs = Object.entries(element.attrs ?? {})
    .map(([key, value]) => ` ${key}="${formatValue(value)}"`)
    .join('');

  const children = element.children ?? [];
  if (children.length === 0) {
    out.push(`${indent}<${element.tag}${attrs}/>`);
    return;
  }
  out.push(`${indent}<${element.tag}${attrs}>`);
  for (const child of children) {
    writeElement(child, `${indent}  `, out);
  }
  out.push(`${indent}</${element.tag}>`);
}

export function writeXml(root: XmlElement): string {
  const out: string[] = [];
  writeElement(root, '', out);
  return `${out.join('\n')}\n`;
}
