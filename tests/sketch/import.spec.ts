import { describe, expect, it } from 'vitest';
import { parseDxf, parseReferenceFile, parseSvg, type ImportPrimitive } from '../../src/sketch';

/** Counts primitives by kind for concise assertions. */
function tally(prims: readonly ImportPrimitive[]): Record<ImportPrimitive['kind'], number> {
  const out: Record<ImportPrimitive['kind'], number> = {
    line: 0,
    circle: 0,
    arc: 0,
    polyline: 0,
  };
  for (const p of prims) out[p.kind] += 1;
  return out;
}

describe('parseSvg', () => {
  it('parses line, rect and circle with a Y flip about the viewBox', () => {
    const svg =
      '<svg viewBox="0 0 100 100">' +
      '<line x1="0" y1="0" x2="10" y2="0" />' +
      '<rect x="0" y="0" width="20" height="20" />' +
      '<circle cx="50" cy="50" r="5" />' +
      '</svg>';
    const { primitives, warnings } = parseSvg(svg);
    expect(tally(primitives)).toEqual({ line: 1, circle: 1, arc: 0, polyline: 1 });
    expect(warnings).toEqual([]);

    const line = primitives.find((p) => p.kind === 'line');
    // SVG y=0 flips to plane y=100 (viewBox height), y stays consistent.
    expect(line?.a).toEqual({ x: 0, y: 100 });
    expect(line?.b).toEqual({ x: 10, y: 100 });

    const circle = primitives.find((p) => p.kind === 'circle');
    expect(circle?.center).toEqual({ x: 50, y: 50 });
    expect(circle?.r).toBe(5);

    const rect = primitives.find((p) => p.kind === 'polyline');
    expect(rect?.closed).toBe(true);
    expect(rect?.points).toHaveLength(4);
  });

  it('samples a cubic Bézier path into a polyline', () => {
    const svg = '<svg viewBox="0 0 100 100"><path d="M0 0 C 0 10 10 10 10 0 Z" /></svg>';
    const { primitives } = parseSvg(svg);
    const poly = primitives.find((p) => p.kind === 'polyline');
    expect(poly).toBeDefined();
    // Start point + 24 cubic samples + Z closing point back to start.
    expect(poly?.points.length).toBeGreaterThan(20);
    expect(poly?.closed).toBe(true);
  });

  it('warns when transform attributes are present', () => {
    const svg =
      '<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="1" y2="1" transform="rotate(5)" /></svg>';
    const { warnings } = parseSvg(svg);
    expect(warnings.some((w) => w.includes('transform'))).toBe(true);
  });

  it('reports a missing root element', () => {
    const { primitives, warnings } = parseSvg('<not-svg/>');
    expect(primitives).toEqual([]);
    expect(warnings).toEqual(['No <svg> root element found.']);
  });
});

describe('parseDxf', () => {
  const dxf = [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '10',
    '0',
    '20',
    '0',
    '11',
    '10',
    '21',
    '0',
    '0',
    'CIRCLE',
    '10',
    '5',
    '20',
    '5',
    '40',
    '3',
    '0',
    'LWPOLYLINE',
    '70',
    '1',
    '10',
    '0',
    '20',
    '0',
    '10',
    '10',
    '20',
    '0',
    '10',
    '10',
    '20',
    '10',
    '0',
    'ARC',
    '10',
    '0',
    '20',
    '0',
    '40',
    '5',
    '50',
    '0',
    '51',
    '90',
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ].join('\n');

  it('parses LINE, CIRCLE, LWPOLYLINE and ARC entities', () => {
    const { primitives, warnings } = parseDxf(dxf);
    expect(tally(primitives)).toEqual({ line: 1, circle: 1, arc: 1, polyline: 1 });
    expect(warnings).toEqual([]);

    const poly = primitives.find((p) => p.kind === 'polyline');
    expect(poly?.closed).toBe(true);
    expect(poly?.points).toHaveLength(3);

    const arc = primitives.find((p) => p.kind === 'arc');
    expect(arc?.ccw).toBe(true);
    expect(arc?.start.x).toBeCloseTo(5); // r*cos(0)
    expect(arc?.end.y).toBeCloseTo(5); // r*sin(90°)
  });

  it('does not flip Y (DXF is already Y-up)', () => {
    const { primitives } = parseDxf(dxf);
    const line = primitives.find((p) => p.kind === 'line');
    expect(line?.a).toEqual({ x: 0, y: 0 });
    expect(line?.b).toEqual({ x: 10, y: 0 });
  });

  it('warns about unsupported entity types', () => {
    const withText = [
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'TEXT',
      '10',
      '0',
      '20',
      '0',
      '1',
      'hi',
      '0',
      'ENDSEC',
      '0',
      'EOF',
    ].join('\n');
    const { primitives, warnings } = parseDxf(withText);
    expect(primitives).toEqual([]);
    expect(warnings.some((w) => w.includes('TEXT'))).toBe(true);
  });
});

describe('parseReferenceFile', () => {
  it('dispatches by extension', () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="1" cy="1" r="1"/></svg>';
    expect(parseReferenceFile('art.svg', svg).primitives).toHaveLength(1);
  });

  it('sniffs SVG content when the extension is unknown', () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="1" cy="1" r="1"/></svg>';
    expect(parseReferenceFile('reference.txt', svg).primitives).toHaveLength(1);
  });
});
