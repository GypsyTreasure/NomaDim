import { err, ok, ValidationError, type OpId, type Result } from '../core';
import type { DocumentState } from './model';
import type { TimelineOp } from './ops/types';
import { opDefinition } from './ops/registry';
import type { Transaction, TimelineSnapshot } from './history';

/**
 * Timeline commands (F1): insert-at-marker, edit, suppress, delete, rename,
 * rollback. All are whole-timeline patches; validation runs through the op
 * registry (R10 — no per-op logic here).
 */

export type TimelineCommand =
  | { readonly type: 'AddOp'; readonly payload: { op: TimelineOp } }
  | { readonly type: 'EditOp'; readonly payload: { op: TimelineOp } }
  | {
      readonly type: 'SetOpSuppressed';
      readonly payload: { opId: OpId; suppressed: boolean };
    }
  | { readonly type: 'DeleteOp'; readonly payload: { opId: OpId } }
  | { readonly type: 'RenameOp'; readonly payload: { opId: OpId; name: string } }
  | { readonly type: 'SetRollback'; readonly payload: { index: number } };

export interface TimelineCommandResult {
  readonly state: DocumentState;
  readonly transaction: Transaction;
}

function snapshot(state: DocumentState): TimelineSnapshot {
  return { ops: state.ops, rollbackIndex: state.rollbackIndex };
}

function commitTimeline(
  state: DocumentState,
  label: string,
  ops: readonly TimelineOp[],
  rollbackIndex: number
): TimelineCommandResult {
  const nextState: DocumentState = { ...state, ops, rollbackIndex };
  return {
    state: nextState,
    transaction: {
      label,
      patches: [
        { kind: 'replaceTimeline', before: snapshot(state), after: snapshot(nextState) },
      ],
    },
  };
}

function findOpIndex(state: DocumentState, opId: OpId): number {
  return state.ops.findIndex((op) => op.id === opId);
}

export function applyTimelineCommand(
  state: DocumentState,
  command: TimelineCommand
): Result<TimelineCommandResult, ValidationError> {
  switch (command.type) {
    case 'AddOp': {
      const { op } = command.payload;
      if (state.ops.some((o) => o.id === op.id)) {
        return err(new ValidationError(`Op "${op.id}" already exists`));
      }
      const valid = opDefinition(op).validate(op, state);
      if (!valid.ok) return valid;
      // F1: new ops insert AT the rollback marker; the marker advances past them.
      const ops = [
        ...state.ops.slice(0, state.rollbackIndex),
        op,
        ...state.ops.slice(state.rollbackIndex),
      ];
      return ok(commitTimeline(state, 'Add Operation', ops, state.rollbackIndex + 1));
    }
    case 'EditOp': {
      const { op } = command.payload;
      const index = findOpIndex(state, op.id);
      if (index < 0) return err(new ValidationError(`Unknown op "${op.id}"`));
      const existing = state.ops[index];
      if (existing && existing.type !== op.type) {
        return err(new ValidationError(`Op "${op.id}" cannot change type`));
      }
      const valid = opDefinition(op).validate(op, state);
      if (!valid.ok) return valid;
      const ops = state.ops.map((o, i) => (i === index ? op : o));
      return ok(commitTimeline(state, 'Edit Operation', ops, state.rollbackIndex));
    }
    case 'SetOpSuppressed': {
      const index = findOpIndex(state, command.payload.opId);
      if (index < 0) return err(new ValidationError(`Unknown op "${command.payload.opId}"`));
      const ops = state.ops.map((o, i) =>
        i === index ? { ...o, suppressed: command.payload.suppressed } : o
      );
      return ok(commitTimeline(state, 'Suppress', ops, state.rollbackIndex));
    }
    case 'DeleteOp': {
      const index = findOpIndex(state, command.payload.opId);
      if (index < 0) return err(new ValidationError(`Unknown op "${command.payload.opId}"`));
      const ops = state.ops.filter((_, i) => i !== index);
      const rollbackIndex =
        index < state.rollbackIndex ? state.rollbackIndex - 1 : state.rollbackIndex;
      return ok(commitTimeline(state, 'Delete Operation', ops, rollbackIndex));
    }
    case 'RenameOp': {
      const index = findOpIndex(state, command.payload.opId);
      if (index < 0) return err(new ValidationError(`Unknown op "${command.payload.opId}"`));
      const ops = state.ops.map((o, i) =>
        i === index ? { ...o, name: command.payload.name } : o
      );
      return ok(commitTimeline(state, 'Rename Operation', ops, state.rollbackIndex));
    }
    case 'SetRollback': {
      const index = command.payload.index;
      if (!Number.isInteger(index) || index < 0 || index > state.ops.length) {
        return err(new ValidationError(`Rollback index ${String(index)} out of range`));
      }
      return ok(commitTimeline(state, 'Move Rollback Marker', state.ops, index));
    }
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

/** Ops that consume anything `opId` produces (F1 delete warning, app-side). */
export function dependentOps(state: DocumentState, opId: OpId): readonly TimelineOp[] {
  const target = state.ops.find((op) => op.id === opId);
  if (!target) return [];
  const produced = new Set(opDefinition(target).dependencies(target).producesBodies);
  const targetSketchId = target.type === 'Sketch' ? target.sketchId : null;
  return state.ops.filter((op) => {
    if (op.id === opId) return false;
    const deps = opDefinition(op).dependencies(op);
    return (
      deps.consumesBodies.some((b) => produced.has(b)) ||
      (targetSketchId !== null && deps.consumesSketch === targetSketchId)
    );
  });
}
