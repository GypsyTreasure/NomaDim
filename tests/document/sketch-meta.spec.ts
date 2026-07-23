import { describe, expect, it } from 'vitest';
import type { EntityId, OpId, PointId, SketchId } from '../../src/core';
import {
  applyCommand,
  applyTransaction,
  emptyDocument,
  getSketchMeta,
  type Command,
  type DocumentState,
  type ExtrudeOp,
} from '../../src/document';
import { detectProfiles } from '../../src/sketch';

/**
 * Sketch visibility (Fusion parity): a sketch's preview shows until a feature
 * consumes it, auto-hides on first use, and can be re-shown from the tree.
 * Visibility is lazily-materialized, undoable metadata — an unedited sketch
 * reports the default (visible), and the auto-hide rides in the SAME
 * transaction as the consuming op so one undo restores both.
 */

const sid = (id: string): SketchId => id as SketchId;

function apply(state: DocumentState, command: Command): DocumentState {
  const result = applyCommand(state, command);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.state;
}

/** A document holding one circle sketch (visible by default) but no feature yet. */
function circleSketch(): { doc: DocumentState; sketchId: SketchId } {
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
      points: [{ id: 'c' as PointId, x: 0, y: 0 }],
      entities: [
        {
          type: 'circle',
          id: 'e1' as EntityId,
          center: 'c' as PointId,
          r: 10,
          construction: false,
        },
      ],
    },
  });
  return { doc, sketchId };
}

function extrudeOf(doc: DocumentState, sketchId: SketchId, id: string): ExtrudeOp {
  const sketch = doc.sketches.find((s) => s.id === sketchId);
  if (!sketch) throw new Error('sketch missing');
  const profile = detectProfiles(sketch).profiles[0];
  if (!profile) throw new Error('profile missing');
  return {
    type: 'Extrude',
    id: id as OpId,
    name: id,
    suppressed: false,
    sketchId,
    profileIds: [profile.id],
    distanceMm: 5,
    direction: 'one-side',
    distance2Mm: 0,
    operation: 'NewBody',
    targetBodyId: null,
    wallThicknessMm: 0,
    asSurface: false,
    bodyId: `${id}-body` as never,
  };
}

describe('sketch visibility', () => {
  it('reports visible for a never-touched sketch', () => {
    const { doc, sketchId } = circleSketch();
    expect(getSketchMeta(doc, sketchId)).toEqual({ id: sketchId, visible: true });
    expect(doc.sketchMeta).toHaveLength(0); // lazily materialized
  });

  it('SetSketchVisible toggles and is undoable via the inverse patch', () => {
    const { doc, sketchId } = circleSketch();
    const result = applyCommand(doc, {
      type: 'SetSketchVisible',
      payload: { sketchId, visible: false },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(getSketchMeta(result.value.state, sketchId).visible).toBe(false);
    const patch = result.value.transaction.patches[0];
    expect(patch?.kind).toBe('replaceSketchMeta');
    if (patch?.kind === 'replaceSketchMeta') expect(patch.before).toEqual([]);

    // Forward then inverse restores visibility exactly.
    const forward = applyTransaction(doc, result.value.transaction);
    expect(getSketchMeta(forward, sketchId).visible).toBe(false);
  });

  it('auto-hides the sketch when a feature first consumes it (one transaction)', () => {
    const { doc, sketchId } = circleSketch();
    const result = applyCommand(doc, {
      type: 'AddOp',
      payload: { op: extrudeOf(doc, sketchId, 'ex1') },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(getSketchMeta(result.value.state, sketchId).visible).toBe(false);
    // The transaction bundles BOTH the timeline change and the auto-hide, so a
    // single undo restores the op AND the sketch's visibility.
    const kinds = result.value.transaction.patches.map((p) => p.kind);
    expect(kinds).toContain('replaceTimeline');
    expect(kinds).toContain('replaceSketchMeta');
  });

  it('stays shown when the user re-shows it and only EDITS the consuming op', () => {
    const { doc, sketchId } = circleSketch();
    const extrude = extrudeOf(doc, sketchId, 'ex1');
    const hidden = apply(doc, { type: 'AddOp', payload: { op: extrude } });
    // User re-shows the sketch, then tweaks the extrude's distance.
    const shown = apply(hidden, { type: 'SetSketchVisible', payload: { sketchId, visible: true } });
    const edited = apply(shown, {
      type: 'EditOp',
      payload: { op: { ...extrude, distanceMm: 12 } },
    });
    // The auto-hide fires ONCE, on the add — regenerating/editing the feature
    // never re-hides a sketch the user chose to bring back.
    expect(getSketchMeta(edited, sketchId).visible).toBe(true);
  });

  it('rejects SetSketchVisible for an unknown sketch', () => {
    const result = applyCommand(emptyDocument(), {
      type: 'SetSketchVisible',
      payload: { sketchId: sid('nope'), visible: false },
    });
    expect(result.ok).toBe(false);
  });
});
