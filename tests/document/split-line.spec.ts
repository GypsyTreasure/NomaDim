import { describe, expect, it } from 'vitest';
import type { EntityId, OpId, PointId, SketchId } from '../../src/core';
import {
  applyCommand,
  emptyDocument,
  findSketch,
  type Command,
  type DocumentState,
} from '../../src/document';
import { planLineSplit } from '../../src/sketch';

/**
 * SplitSketchLine command (#6, ADR-0099): applies a pre-computed split plan
 * (from `planLineSplit`) as one undoable transaction — the app's write path
 * for the Split tool.
 */

const sid = (id: string): SketchId => id as SketchId;
const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

function apply(state: DocumentState, command: Command): DocumentState {
  const result = applyCommand(state, command);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.state;
}

/** A sketch with a horizontal line crossed by a vertical line at (5,0). */
function crossingSketch(): { doc: DocumentState; sketchId: SketchId } {
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
        { id: pid('c'), x: 5, y: -5 },
        { id: pid('d'), x: 5, y: 5 },
      ],
      entities: [
        { type: 'line', id: eid('e1'), start: pid('a'), end: pid('b'), construction: false },
        { type: 'line', id: eid('e2'), start: pid('c'), end: pid('d'), construction: false },
      ],
    },
  });
  return { doc, sketchId };
}

describe('SplitSketchLine command', () => {
  it('applies a split plan, dividing both crossing lines at a shared joint', () => {
    const { doc, sketchId } = crossingSketch();
    const sketch = findSketch(doc, sketchId);
    expect(sketch).toBeDefined();
    if (!sketch) return;
    const plan = planLineSplit(sketch, eid('e1'));
    expect(plan).not.toBeNull();
    if (!plan) return;

    const next = apply(doc, {
      type: 'SplitSketchLine',
      payload: {
        sketchId,
        removeEntityIds: plan.removeEntityIds,
        addPoints: plan.addPoints,
        addEntities: plan.addEntities,
      },
    });
    const after = findSketch(next, sketchId);
    // e1 + e2 removed, four half-lines added; one new joint point.
    expect(after?.entities).toHaveLength(4);
    expect(after?.points).toHaveLength(5); // a,b,c,d + joint
  });

  it('is reversible via its transaction inverse (undoable)', () => {
    const { doc, sketchId } = crossingSketch();
    const sketch = findSketch(doc, sketchId);
    if (!sketch) return;
    const plan = planLineSplit(sketch, eid('e1'));
    if (!plan) return;
    const result = applyCommand(doc, {
      type: 'SplitSketchLine',
      payload: {
        sketchId,
        removeEntityIds: plan.removeEntityIds,
        addPoints: plan.addPoints,
        addEntities: plan.addEntities,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The transaction carries a patch so the change can be undone.
    expect(result.value.transaction.patches.length).toBeGreaterThan(0);
  });
});
