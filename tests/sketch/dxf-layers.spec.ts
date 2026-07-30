import { describe, expect, it } from 'vitest';
import { parseDxf } from '../../src/sketch/import/dxf';
import { importLayers, type ImportPrimitive } from '../../src/sketch/import/types';

/**
 * DXF layer filtering (ADR-0088): every primitive carries its source layer
 * (group code 8), block members on layer "0" inherit their INSERT's layer, and
 * `importLayers` summarizes distinct layers with counts for the picker.
 */
const dxf = (lines: string[]): string => lines.join('\n');

describe('DXF layers', () => {
  it('stamps each primitive with its source layer and summarizes them', () => {
    const text = dxf([
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'Frame', '10', '0', '20', '0', '11', '10', '21', '0',
      '0', 'LINE', '8', 'Frame', '10', '10', '20', '0', '11', '10', '21', '10',
      '0', 'CIRCLE', '8', 'Glass', '10', '5', '20', '5', '40', '3',
      '0', 'ENDSEC', '0', 'EOF',
    ]); // prettier-ignore
    const { primitives } = parseDxf(text);
    expect(primitives.map((p) => p.layer).sort()).toEqual(['Frame', 'Frame', 'Glass']);
    expect(importLayers(primitives)).toEqual([
      { name: 'Frame', count: 2 },
      { name: 'Glass', count: 1 },
    ]);
  });

  it('block members on layer "0" inherit the INSERT layer', () => {
    const text = dxf([
      '0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '2', 'B', '10', '0', '20', '0',
      '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '5', '21', '0',
      '0', 'LINE', '8', 'Named', '10', '0', '20', '0', '11', '0', '21', '5',
      '0', 'ENDBLK',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '8', 'Profile', '2', 'B', '10', '0', '20', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ]); // prettier-ignore
    const { primitives } = parseDxf(text);
    // The "0"-layer member inherits "Profile"; the named member keeps "Named".
    expect(primitives.map((p) => p.layer).sort()).toEqual(['Named', 'Profile']);
  });

  it('a layer selection filters which primitives are kept', () => {
    const prims: ImportPrimitive[] = [
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, layer: 'A' },
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: 1 }, layer: 'B' },
      { kind: 'line', a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, layer: 'A' },
    ];
    const keep = new Set(['A']);
    expect(prims.filter((p) => keep.has(p.layer ?? '')).length).toBe(2);
  });
});
