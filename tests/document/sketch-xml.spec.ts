import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DimensionId, EntityId, PointId, SketchId } from '../../src/core/ids';
import type { Sketch } from '../../src/document';
import { sketchFromXml, sketchToXml } from '../../src/document/xml/sketchXml';

const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

const fixturePath = join(__dirname, '..', 'fixtures', 'sketch-bracket.xml');

function arcSketch(): Sketch {
  return {
    id: 'sk2' as SketchId,
    name: 'ArcSample',
    plane: { kind: 'origin', plane: 'XZ' },
    points: [
      { id: pid('c1'), x: 0, y: 0 },
      { id: pid('p1'), x: 10, y: 0 },
      { id: pid('p2'), x: 0, y: 10 },
      { id: pid('p3'), x: 5.25, y: -3.125 },
    ],
    entities: [
      {
        type: 'arc',
        id: eid('a1'),
        center: pid('c1'),
        start: pid('p1'),
        end: pid('p2'),
        ccw: true,
        construction: false,
      },
      { type: 'point', id: eid('q1'), point: pid('p3'), construction: true },
    ],
    constraints: [],
    dimensions: [],
  };
}

describe('sketch XML round-trip', () => {
  it('model → XML → model preserves everything, including shared endpoints', () => {
    const fixture = readFileSync(fixturePath, 'utf8');
    const parsed = sketchFromXml(fixture);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const sketch = parsed.value;
    // Shared endpoints stay shared point REFERENCES (C6): six boundary
    // lines chain through exactly six pool points, one per corner.
    const boundaryLines = sketch.entities.filter((e) => e.type === 'line');
    expect(boundaryLines).toHaveLength(6);
    const cornerIds = new Set(boundaryLines.flatMap((line) => [line.start, line.end]));
    expect(cornerIds.size).toBe(6);

    const rewritten = sketchToXml(sketch);
    const reparsed = sketchFromXml(rewritten);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.value).toEqual(sketch);
  });

  it('serialization is deterministic (fixture is byte-identical after round-trip)', () => {
    const fixture = readFileSync(fixturePath, 'utf8');
    const parsed = sketchFromXml(fixture);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(sketchToXml(parsed.value)).toBe(fixture);
  });

  it('round-trips arcs, point entities, construction flags, and non-XY planes', () => {
    const original = arcSketch();
    const xml = sketchToXml(original);
    const parsed = sketchFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(original);
  });

  it('round-trips face-based sketches with fingerprint + plane snapshot', () => {
    const original: Sketch = {
      ...arcSketch(),
      id: 'sk3' as SketchId,
      plane: {
        kind: 'face',
        fingerprint: 'fp-abc123',
        planeSnapshot: { origin: [0, 0, 10], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
      },
    };
    const xml = sketchToXml(original);
    expect(xml).toContain('plane="face"');
    expect(xml).toContain('<faceRef fingerprint="fp-abc123"/>');
    const parsed = sketchFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(original);
  });

  it('round-trips an axis (centerline) line, serializing axis="true"', () => {
    const original: Sketch = {
      id: 'skA' as SketchId,
      name: 'WithAxis',
      plane: { kind: 'origin', plane: 'XY' },
      points: [
        { id: pid('a'), x: 0, y: -20 },
        { id: pid('b'), x: 0, y: 20 },
      ],
      entities: [
        {
          type: 'line',
          id: eid('ax1'),
          start: pid('a'),
          end: pid('b'),
          construction: true,
          axis: true,
        },
      ],
      constraints: [],
      dimensions: [],
    };
    const xml = sketchToXml(original);
    expect(xml).toContain('axis="true"');
    const parsed = sketchFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(original);
  });

  it('round-trips reference dimensions of every kind, serializing <dimension>', () => {
    const did = (id: string): DimensionId => id as DimensionId;
    const original: Sketch = {
      id: 'skD' as SketchId,
      name: 'WithDimensions',
      plane: { kind: 'origin', plane: 'XY' },
      points: [
        { id: pid('c'), x: 0, y: 0 },
        { id: pid('p'), x: 10, y: 5 },
      ],
      entities: [],
      constraints: [],
      dimensions: [
        { id: did('d1'), kind: 'linear', a: pid('c'), b: pid('p'), offset: 8 },
        { id: did('d2'), kind: 'horizontal', a: pid('c'), b: pid('p'), offset: -4 },
        { id: did('d3'), kind: 'vertical', a: pid('c'), b: pid('p'), offset: 4 },
        { id: did('d4'), kind: 'angle', a: pid('c'), b: pid('p'), offset: 6 },
        { id: did('d5'), kind: 'radius', a: pid('c'), b: pid('p'), offset: 0 },
        { id: did('d6'), kind: 'diameter', a: pid('c'), b: pid('p'), offset: 0 },
      ],
    };
    const xml = sketchToXml(original);
    expect(xml).toContain('<dimension id="d1" kind="linear" a="c" b="p" offset="8"/>');
    const parsed = sketchFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(original);
  });

  it('round-trips a radial dimension carrying its entity ref (#1)', () => {
    const did = (id: string): DimensionId => id as DimensionId;
    const original: Sketch = {
      id: 'skR' as SketchId,
      name: 'RadialDim',
      plane: { kind: 'origin', plane: 'XY' },
      points: [{ id: pid('ctr'), x: 0, y: 0 }],
      entities: [
        { type: 'circle', id: 'c1' as EntityId, center: pid('ctr'), r: 5, construction: false },
      ],
      constraints: [],
      dimensions: [
        {
          id: did('d1'),
          kind: 'diameter',
          a: pid('ctr'),
          b: pid('ctr'),
          offset: 0,
          entityId: 'c1' as EntityId,
        },
      ],
    };
    const xml = sketchToXml(original);
    expect(xml).toContain('entity="c1"');
    const parsed = sketchFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(original);
  });

  it('rejects a dimension referencing a missing point (validation on import)', () => {
    const xml = [
      '<sketch id="s" plane="XY" name="n">',
      '  <points><point id="p1" x="0" y="0"/></points>',
      '  <entities/>',
      '  <constraints/>',
      '  <dimensions>',
      '    <dimension id="d1" kind="linear" a="p1" b="pMissing" offset="5"/>',
      '  </dimensions>',
      '</sketch>',
    ].join('\n');
    const result = sketchFromXml(xml);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toContain('missing point');
  });

  it('rejects malformed XML with ImportError', () => {
    for (const bad of [
      '<notASketch/>',
      '<sketch id="s" plane="XY"/>', // missing name + containers
      '<sketch id="s" plane="XY" name="n"><points><point id="p" x="oops" y="0"/></points><entities/></sketch>',
      '<sketch id="s" plane="ZZ" name="n"><points/><entities/></sketch>',
    ]) {
      const result = sketchFromXml(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.name).toBe('ImportError');
    }
  });

  it('rejects structurally invalid sketches (validation runs on import)', () => {
    const xml = [
      '<sketch id="s" plane="XY" name="n">',
      '  <points>',
      '    <point id="p1" x="0" y="0"/>',
      '  </points>',
      '  <entities>',
      '    <line id="e1" start="p1" end="pMissing" construction="false"/>',
      '  </entities>',
      '  <constraints/>',
      '  <dimensions/>',
      '</sketch>',
    ].join('\n');
    const result = sketchFromXml(xml);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toContain('missing point');
  });
});
