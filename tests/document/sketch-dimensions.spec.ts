import { describe, expect, it } from 'vitest';
import type { DimensionId, EntityId, OpId, PointId, SketchId } from '../../src/core';
import {
  applyCommand,
  emptyDocument,
  findSketch,
  type Command,
  type DocumentState,
} from '../../src/document';

/**
 * Reference-dimension commands (solver-free, ADR-0002): AddSketchDimension
 * appends an associative annotation between two existing pool points;
 * DeleteSketchDimensions removes them; and the entity garbage-collector must
 * retain a point kept alive only by a dimension.
 */

const sid = (id: string): SketchId => id as SketchId;
const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;
const did = (id: string): DimensionId => id as DimensionId;

function apply(state: DocumentState, command: Command): DocumentState {
  const result = applyCommand(state, command);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.state;
}

/** One sketch with a single line (two pool points a, b). */
function lineSketch(): { doc: DocumentState; sketchId: SketchId } {
  const sketchId = sid('s1');
  let doc = apply(emptyDocument(), {
    type: 'CreateSketch',
    payload: {
      sketchId,
      opId: 'so1' as OpId,
      name: 'Sketch1',
      plane: { kind: 'origin', plane: 'XY' },
    },
  });
  doc = apply(doc, {
    type: 'AddSketchGeometry',
    payload: {
      sketchId,
      points: [
        { id: pid('a'), x: 0, y: 0 },
        { id: pid('b'), x: 10, y: 0 },
      ],
      entities: [
        { type: 'line', id: eid('e1'), start: pid('a'), end: pid('b'), construction: false },
      ],
    },
  });
  return { doc, sketchId };
}

describe('sketch dimension commands', () => {
  it('AddSketchDimension appends an associative dimension between two points', () => {
    const { doc, sketchId } = lineSketch();
    const next = apply(doc, {
      type: 'AddSketchDimension',
      payload: {
        sketchId,
        dimension: { id: did('d1'), kind: 'linear', a: pid('a'), b: pid('b'), offset: 8 },
      },
    });
    const sketch = findSketch(next, sketchId);
    expect(sketch?.dimensions).toHaveLength(1);
    expect(sketch?.dimensions[0]?.kind).toBe('linear');
  });

  it('rejects a dimension whose points are missing or equal', () => {
    const { doc, sketchId } = lineSketch();
    expect(
      applyCommand(doc, {
        type: 'AddSketchDimension',
        payload: {
          sketchId,
          dimension: { id: did('d1'), kind: 'linear', a: pid('a'), b: pid('zzz'), offset: 0 },
        },
      }).ok
    ).toBe(false);
    expect(
      applyCommand(doc, {
        type: 'AddSketchDimension',
        payload: {
          sketchId,
          dimension: { id: did('d2'), kind: 'linear', a: pid('a'), b: pid('a'), offset: 0 },
        },
      }).ok
    ).toBe(false);
  });

  it('DeleteSketchDimensions removes only the named dimensions', () => {
    const { doc, sketchId } = lineSketch();
    let next = apply(doc, {
      type: 'AddSketchDimension',
      payload: {
        sketchId,
        dimension: { id: did('d1'), kind: 'linear', a: pid('a'), b: pid('b'), offset: 8 },
      },
    });
    next = apply(next, {
      type: 'DeleteSketchDimensions',
      payload: { sketchId, dimensionIds: [did('d1')] },
    });
    expect(findSketch(next, sketchId)?.dimensions).toHaveLength(0);
  });

  it('deleting the line keeps points a dimension still references', () => {
    const { doc, sketchId } = lineSketch();
    let next = apply(doc, {
      type: 'AddSketchDimension',
      payload: {
        sketchId,
        dimension: { id: did('d1'), kind: 'horizontal', a: pid('a'), b: pid('b'), offset: 4 },
      },
    });
    next = apply(next, {
      type: 'DeleteSketchEntities',
      payload: { sketchId, entityIds: [eid('e1')] },
    });
    const sketch = findSketch(next, sketchId);
    // The line is gone, but both endpoints survive because the dimension holds them.
    expect(sketch?.entities).toHaveLength(0);
    expect(sketch?.points.map((p) => p.id).sort()).toEqual([pid('a'), pid('b')]);
    expect(sketch?.dimensions).toHaveLength(1);
  });
});
