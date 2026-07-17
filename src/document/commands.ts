import {
  err,
  ok,
  ValidationError,
  type BodyId,
  type DimensionId,
  type EntityId,
  type PointId,
  type Result,
  type SketchId,
} from '../core';
import { findSketch, type DocumentState } from './model';
import { emptySketch } from './sketch/access';
import { getBodyMeta, upsertBodyMeta } from './bodies/access';
import type { BodyMeta } from './bodies/types';
import { getSketchMeta, upsertSketchMeta } from './sketch/meta';
import { referencedPointIds } from './sketch/roles';
import type {
  Sketch,
  SketchDimension,
  SketchEntity,
  SketchPlaneRef,
  SketchPoint,
} from './sketch/types';
import { validateSketch } from './sketch/validate';
import type { BodyMetaPatch, SketchMetaPatch, SketchPatch, Transaction } from './history';
import type { OpId } from '../core';
import { applyTimelineCommand, type TimelineCommand } from './timelineCommands';

/**
 * Commands (ARCHITECTURE §4, R1-R3): plain serializable `{ type, payload }`
 * objects — the ONLY way the document changes. Applying a command either
 * yields a new state plus exactly one undoable Transaction, or fails
 * atomically with a ValidationError. Dispatch lives in services/CommandBus;
 * this module is the pure validate+apply core.
 */

export type Command =
  | TimelineCommand
  | {
      readonly type: 'CreateSketch';
      /** `opId` mints the timeline SketchOp in the same transaction (commands stay serializable, R3). */
      readonly payload: { sketchId: SketchId; opId: OpId; name: string; plane: SketchPlaneRef };
    }
  | {
      readonly type: 'AddSketchGeometry';
      readonly payload: {
        sketchId: SketchId;
        /** NEW pool points only — shared endpoints reference existing ids. */
        points: readonly SketchPoint[];
        entities: readonly SketchEntity[];
      };
    }
  | {
      readonly type: 'MoveSketchPoints';
      readonly payload: {
        sketchId: SketchId;
        moves: readonly { pointId: PointId; x: number; y: number }[];
      };
    }
  | {
      readonly type: 'SetEntityConstruction';
      readonly payload: { sketchId: SketchId; entityId: EntityId; construction: boolean };
    }
  | {
      readonly type: 'SetCircleRadius';
      readonly payload: { sketchId: SketchId; entityId: EntityId; r: number };
    }
  | {
      readonly type: 'DeleteSketchEntities';
      readonly payload: { sketchId: SketchId; entityIds: readonly EntityId[] };
    }
  | {
      readonly type: 'AddSketchDimension';
      readonly payload: { sketchId: SketchId; dimension: SketchDimension };
    }
  | {
      readonly type: 'DeleteSketchDimensions';
      readonly payload: { sketchId: SketchId; dimensionIds: readonly DimensionId[] };
    }
  | { readonly type: 'RenameSketch'; readonly payload: { sketchId: SketchId; name: string } }
  | { readonly type: 'SetBodyName'; readonly payload: { bodyId: BodyId; name: string } }
  | { readonly type: 'SetBodyColor'; readonly payload: { bodyId: BodyId; color: string } }
  | { readonly type: 'SetBodyVisible'; readonly payload: { bodyId: BodyId; visible: boolean } }
  | {
      readonly type: 'SetSketchVisible';
      readonly payload: { sketchId: SketchId; visible: boolean };
    };

export interface CommandResult {
  readonly state: DocumentState;
  readonly transaction: Transaction;
}

function sketchReplacement(
  state: DocumentState,
  label: string,
  before: Sketch | null,
  after: Sketch | null,
  sketchId: string
): CommandResult {
  const patch: SketchPatch = { kind: 'replaceSketch', sketchId, before, after };
  const without = state.sketches.filter((s) => s.id !== sketchId);
  return {
    state: { ...state, sketches: after ? [...without, after] : without },
    transaction: { label, patches: [patch] },
  };
}

function requireSketch(state: DocumentState, sketchId: string): Result<Sketch, ValidationError> {
  const sketch = findSketch(state, sketchId);
  return sketch ? ok(sketch) : err(new ValidationError(`Unknown sketch "${sketchId}"`));
}

/** Validate-then-replace: the shared tail of every sketch-mutating command. */
function commitSketchEdit(
  state: DocumentState,
  label: string,
  before: Sketch,
  after: Sketch
): Result<CommandResult, ValidationError> {
  const valid = validateSketch(after);
  if (!valid.ok) return valid;
  return ok(sketchReplacement(state, label, before, after, before.id));
}

/** Upserts one body's metadata (F8) as an undoable whole-list replacement. */
function setBodyMeta(
  state: DocumentState,
  label: string,
  bodyId: BodyId,
  patch: Partial<Pick<BodyMeta, 'name' | 'color' | 'visible'>>
): Result<CommandResult, ValidationError> {
  const next: BodyMeta = { ...getBodyMeta(state, bodyId), ...patch };
  const after = upsertBodyMeta(state, next);
  const bodyMetaPatch: BodyMetaPatch = {
    kind: 'replaceBodyMeta',
    before: state.bodyMeta,
    after,
  };
  return ok({
    state: { ...state, bodyMeta: after },
    transaction: { label, patches: [bodyMetaPatch] },
  });
}

/** Sets one sketch's visibility as an undoable whole-list replacement. */
function setSketchVisible(
  state: DocumentState,
  sketchId: SketchId,
  visible: boolean
): Result<CommandResult, ValidationError> {
  if (!findSketch(state, sketchId)) {
    return err(new ValidationError(`Unknown sketch "${sketchId}"`));
  }
  const after = upsertSketchMeta(state, { ...getSketchMeta(state, sketchId), visible });
  const patch: SketchMetaPatch = { kind: 'replaceSketchMeta', before: state.sketchMeta, after };
  return ok({
    state: { ...state, sketchMeta: after },
    transaction: { label: visible ? 'Show Sketch' : 'Hide Sketch', patches: [patch] },
  });
}

export function applyCommand(
  state: DocumentState,
  command: Command
): Result<CommandResult, ValidationError> {
  switch (command.type) {
    // Timeline commands (F1) — delegated to the registry-driven applier.
    case 'AddOp':
    case 'EditOp':
    case 'SetOpSuppressed':
    case 'DeleteOp':
    case 'RenameOp':
    case 'SetRollback':
      return applyTimelineCommand(state, command);

    case 'CreateSketch': {
      const { sketchId, opId, name, plane } = command.payload;
      if (findSketch(state, sketchId)) {
        return err(new ValidationError(`Sketch "${sketchId}" already exists`));
      }
      if (state.ops.some((op) => op.id === opId)) {
        return err(new ValidationError(`Op "${opId}" already exists`));
      }
      // One transaction, two patches: the sketch AND its timeline op appear
      // (and undo) together — a sketch is a timeline citizen (§7).
      const sketch = emptySketch(sketchId, name, plane);
      const withSketch = sketchReplacement(state, 'Create Sketch', null, sketch, sketchId);
      const opResult = applyTimelineCommand(withSketch.state, {
        type: 'AddOp',
        payload: {
          op: { type: 'Sketch', id: opId, name, suppressed: false, sketchId },
        },
      });
      if (!opResult.ok) return opResult;
      return ok({
        state: opResult.value.state,
        transaction: {
          label: 'Create Sketch',
          patches: [...withSketch.transaction.patches, ...opResult.value.transaction.patches],
        },
      });
    }
    case 'AddSketchGeometry': {
      const found = requireSketch(state, command.payload.sketchId);
      if (!found.ok) return found;
      const before = found.value;
      const after: Sketch = {
        ...before,
        points: [...before.points, ...command.payload.points],
        entities: [...before.entities, ...command.payload.entities],
      };
      return commitSketchEdit(state, 'Add Geometry', before, after);
    }
    case 'MoveSketchPoints': {
      const found = requireSketch(state, command.payload.sketchId);
      if (!found.ok) return found;
      const before = found.value;
      const moves = new Map(command.payload.moves.map((m) => [m.pointId, m]));
      for (const pointId of moves.keys()) {
        if (!before.points.some((p) => p.id === pointId)) {
          return err(new ValidationError(`Unknown point "${pointId}"`));
        }
      }
      const after: Sketch = {
        ...before,
        points: before.points.map((p) => {
          const move = moves.get(p.id);
          return move ? { ...p, x: move.x, y: move.y } : p;
        }),
      };
      return commitSketchEdit(state, 'Move Points', before, after);
    }
    case 'SetEntityConstruction': {
      const found = requireSketch(state, command.payload.sketchId);
      if (!found.ok) return found;
      const before = found.value;
      const { entityId, construction } = command.payload;
      if (!before.entities.some((e) => e.id === entityId)) {
        return err(new ValidationError(`Unknown entity "${entityId}"`));
      }
      const after: Sketch = {
        ...before,
        entities: before.entities.map((e) => (e.id === entityId ? { ...e, construction } : e)),
      };
      return commitSketchEdit(state, 'Toggle Construction', before, after);
    }
    case 'SetCircleRadius': {
      const found = requireSketch(state, command.payload.sketchId);
      if (!found.ok) return found;
      const before = found.value;
      const { entityId, r } = command.payload;
      const target = before.entities.find((e) => e.id === entityId);
      if (target?.type !== 'circle') {
        return err(new ValidationError(`Entity "${entityId}" is not a circle`));
      }
      const after: Sketch = {
        ...before,
        entities: before.entities.map((e) =>
          e.id === entityId && e.type === 'circle' ? { ...e, r } : e
        ),
      };
      return commitSketchEdit(state, 'Edit Radius', before, after);
    }
    case 'DeleteSketchEntities': {
      const found = requireSketch(state, command.payload.sketchId);
      if (!found.ok) return found;
      const before = found.value;
      const doomed = new Set<string>(command.payload.entityIds);
      const entities = before.entities.filter((e) => !doomed.has(e.id));
      // Garbage-collect pool points no surviving entity OR dimension references.
      const referenced = new Set<string>(entities.flatMap((e) => [...referencedPointIds(e)]));
      for (const d of before.dimensions) {
        referenced.add(d.a);
        referenced.add(d.b);
      }
      const after: Sketch = {
        ...before,
        entities,
        points: before.points.filter((p) => referenced.has(p.id)),
      };
      return commitSketchEdit(state, 'Delete', before, after);
    }
    case 'AddSketchDimension': {
      const found = requireSketch(state, command.payload.sketchId);
      if (!found.ok) return found;
      const before = found.value;
      const { dimension } = command.payload;
      const pointIds = new Set(before.points.map((p) => p.id));
      if (!pointIds.has(dimension.a) || !pointIds.has(dimension.b)) {
        return err(new ValidationError('Dimension references an unknown point'));
      }
      if (dimension.a === dimension.b) {
        return err(new ValidationError('Dimension needs two distinct points'));
      }
      const after: Sketch = { ...before, dimensions: [...before.dimensions, dimension] };
      return commitSketchEdit(state, 'Add Dimension', before, after);
    }
    case 'DeleteSketchDimensions': {
      const found = requireSketch(state, command.payload.sketchId);
      if (!found.ok) return found;
      const before = found.value;
      const doomed = new Set<string>(command.payload.dimensionIds);
      const after: Sketch = {
        ...before,
        dimensions: before.dimensions.filter((d) => !doomed.has(d.id)),
      };
      return commitSketchEdit(state, 'Delete Dimension', before, after);
    }
    case 'RenameSketch': {
      const found = requireSketch(state, command.payload.sketchId);
      if (!found.ok) return found;
      const before = found.value;
      return commitSketchEdit(state, 'Rename Sketch', before, {
        ...before,
        name: command.payload.name,
      });
    }
    case 'SetBodyName':
      return setBodyMeta(state, 'Rename Body', command.payload.bodyId, {
        name: command.payload.name,
      });
    case 'SetBodyColor':
      return setBodyMeta(state, 'Set Body Colour', command.payload.bodyId, {
        color: command.payload.color,
      });
    case 'SetBodyVisible':
      return setBodyMeta(
        state,
        command.payload.visible ? 'Show Body' : 'Hide Body',
        command.payload.bodyId,
        {
          visible: command.payload.visible,
        }
      );
    case 'SetSketchVisible':
      return setSketchVisible(state, command.payload.sketchId, command.payload.visible);
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
