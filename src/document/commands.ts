import {
  err,
  ok,
  ValidationError,
  type EntityId,
  type PointId,
  type Result,
  type SketchId,
} from '../core';
import { findSketch, type DocumentState } from './model';
import { emptySketch } from './sketch/access';
import { referencedPointIds } from './sketch/roles';
import type { Sketch, SketchEntity, SketchPlaneRef, SketchPoint } from './sketch/types';
import { validateSketch } from './sketch/validate';
import type { SketchPatch, Transaction } from './history';

/**
 * Commands (ARCHITECTURE §4, R1-R3): plain serializable `{ type, payload }`
 * objects — the ONLY way the document changes. Applying a command either
 * yields a new state plus exactly one undoable Transaction, or fails
 * atomically with a ValidationError. Dispatch lives in services/CommandBus;
 * this module is the pure validate+apply core.
 */

export type Command =
  | {
      readonly type: 'CreateSketch';
      readonly payload: { sketchId: SketchId; name: string; plane: SketchPlaneRef };
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
  | { readonly type: 'RenameSketch'; readonly payload: { sketchId: SketchId; name: string } };

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

export function applyCommand(
  state: DocumentState,
  command: Command
): Result<CommandResult, ValidationError> {
  switch (command.type) {
    case 'CreateSketch': {
      const { sketchId, name, plane } = command.payload;
      if (findSketch(state, sketchId)) {
        return err(new ValidationError(`Sketch "${sketchId}" already exists`));
      }
      const sketch = emptySketch(sketchId, name, plane);
      return ok(sketchReplacement(state, 'Create Sketch', null, sketch, sketchId));
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
      // Garbage-collect pool points no surviving entity references.
      const referenced = new Set<string>(entities.flatMap((e) => [...referencedPointIds(e)]));
      const after: Sketch = {
        ...before,
        entities,
        points: before.points.filter((p) => referenced.has(p.id)),
      };
      return commitSketchEdit(state, 'Delete', before, after);
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
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
