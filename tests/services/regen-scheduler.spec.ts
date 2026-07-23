import { describe, expect, it } from 'vitest';
import type { BodyId, OpId, SketchId } from '../../src/core';
import {
  applyCommand,
  emptyDocument,
  type Command,
  type DocumentState,
  type ExtrudeOp,
} from '../../src/document';
import { detectProfiles } from '../../src/sketch';
import { buildRegenPlan, computeFromIndex } from '../../src/services';

/**
 * M3 acceptance (MASTER_DOCUMENT §8): "editing a sketch entity regenerates
 * the solid correctly." Proven deterministically at the regen-plan boundary
 * — the exact contract the worker consumes: dirty tracking finds the edited
 * op, and the rebuilt plan carries the NEW profile geometry (the worker then
 * builds the updated solid, proven by the executor golden tests). Also
 * covers rollback truncation and suppressed-input skipping (§9).
 */

const sid = (id: string): SketchId => id as SketchId;

/** Applies a command, asserting success, and returns the next document. */
function apply(state: DocumentState, command: Command): DocumentState {
  const result = applyCommand(state, command);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.state;
}

/** A document with one circle sketch and an extrude of its profile. */
function sketchAndExtrude(radius: number): {
  doc: DocumentState;
  extrudeId: OpId;
  sketchId: SketchId;
} {
  const sketchId = sid('s1');
  const sketchOpId = 'so1' as OpId;
  let doc = apply(emptyDocument(), {
    type: 'CreateSketch',
    payload: {
      sketchId,
      opId: sketchOpId,
      name: 'Sketch1',
      plane: { kind: 'origin', plane: 'XY' },
    },
  });
  doc = apply(doc, {
    type: 'AddSketchGeometry',
    payload: {
      sketchId,
      points: [{ id: 'c' as never, x: 0, y: 0 }],
      entities: [
        { type: 'circle', id: 'e1' as never, center: 'c' as never, r: radius, construction: false },
      ],
    },
  });

  const sketch = doc.sketches[0];
  if (!sketch) throw new Error('sketch missing');
  const profile = detectProfiles(sketch).profiles[0];
  if (!profile) throw new Error('profile missing');
  const profileId = profile.id;
  const extrudeId = 'ex1' as OpId;
  const extrude: ExtrudeOp = {
    type: 'Extrude',
    id: extrudeId,
    name: 'Extrude1',
    suppressed: false,
    sketchId,
    profileIds: [profileId],
    distanceMm: 5,
    direction: 'one-side',
    distance2Mm: 0,
    operation: 'NewBody',
    targetBodyId: null,
    wallThicknessMm: 0,
    asSurface: false,
    bodyId: 'b1' as BodyId,
  };
  doc = apply(doc, { type: 'AddOp', payload: { op: extrude } });
  return { doc, extrudeId, sketchId };
}

/** Reads the extrude PlanOp's single outer circle radius from a plan. */
function planCircleRadius(doc: DocumentState, extrudeId: OpId): number | null {
  const plan = buildRegenPlan(doc);
  const planOp = plan.ops.find((o) => o.op.id === extrudeId);
  const outer = planOp?.profiles[0]?.outer[0];
  return outer?.kind === 'circle' ? outer.r : null;
}

describe('regen plan + dirty tracking (M3 acceptance)', () => {
  it('editing the sketch entity rebuilds the plan with the new profile geometry', () => {
    const { doc, extrudeId, sketchId } = sketchAndExtrude(10);
    expect(planCircleRadius(doc, extrudeId)).toBeCloseTo(10, 6);

    // Edit the circle radius — the exact acceptance action.
    const edited = apply(doc, {
      type: 'SetCircleRadius',
      payload: { sketchId, entityId: 'e1' as never, r: 15 },
    });

    // Dirty tracking flags from the sketch op (index 0), so the worker replays
    // from there and the extrude re-runs against the changed profile.
    expect(computeFromIndex(doc, edited)).toBe(0);
    expect(planCircleRadius(edited, extrudeId)).toBeCloseTo(15, 6);
  });

  it('suppressing the sketch op marks the downstream extrude inputsSuppressed', () => {
    const { doc, extrudeId } = sketchAndExtrude(10);
    const suppressed = apply(doc, {
      type: 'SetOpSuppressed',
      payload: { opId: 'so1' as OpId, suppressed: true },
    });
    const plan = buildRegenPlan(suppressed);
    const planOp = plan.ops.find((o) => o.op.id === extrudeId);
    expect(planOp?.inputsSuppressed).toBe(true);
  });

  it('rollback marker truncates the plan to the active prefix (F1)', () => {
    const { doc, extrudeId } = sketchAndExtrude(10);
    // Roll back before the extrude (marker index 1 = only the sketch op).
    const rolled = apply(doc, { type: 'SetRollback', payload: { index: 1 } });
    const plan = buildRegenPlan(rolled);
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops.some((o) => o.op.id === extrudeId)).toBe(false);
    // Marker moved down from 2 → 1, so replay starts at the lower marker.
    expect(computeFromIndex(doc, rolled)).toBe(1);
  });

  it('an unrelated later edit does not dirty earlier ops', () => {
    const { doc } = sketchAndExtrude(10);
    // Renaming the extrude changes only its own op object (index 1).
    const renamed = apply(doc, {
      type: 'RenameOp',
      payload: { opId: 'ex1' as OpId, name: 'Boss' },
    });
    expect(computeFromIndex(doc, renamed)).toBe(1);
  });
});
