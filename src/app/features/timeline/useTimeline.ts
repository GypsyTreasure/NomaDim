import { useCallback, useState } from 'react';
import type { OpId } from '../../../core';
import { dependentOps, opDefinition, type OpType, type TimelineOp } from '../../../document';
import type { OpStatusReport } from '../../../kernel';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useKernelStore } from '../../store/kernelStore';
import { useSessionStore } from '../../store/sessionStore';
import { OP_FEATURES } from './registry';

/** Which op dialog is open, and whether it edits an existing op or creates one. */
export interface TimelineDialog {
  readonly type: OpType;
  readonly editing: TimelineOp | null;
}

export interface TimelineApi {
  readonly ops: readonly TimelineOp[];
  readonly rollbackIndex: number;
  readonly statuses: ReadonlyMap<OpId, OpStatusReport>;
  readonly dialog: TimelineDialog | null;
  readonly openCreate: (type: OpType) => void;
  readonly openEdit: (op: TimelineOp) => void;
  readonly closeDialog: () => void;
  readonly toggleSuppress: (op: TimelineOp) => void;
  readonly remove: (op: TimelineOp) => void;
  readonly rename: (op: TimelineOp) => void;
  readonly setRollback: (index: number) => void;
}

export function useTimeline(): TimelineApi {
  const document = useDocumentStore((s) => s.document);
  const statuses = useKernelStore((s) => s.statuses);
  const [dialog, setDialog] = useState<TimelineDialog | null>(null);

  const openCreate = useCallback((type: OpType) => {
    setDialog({ type, editing: null });
  }, []);
  const openEdit = useCallback((op: TimelineOp) => {
    // Ops with a dialog open it; a Sketch op re-enters its sketch for editing
    // (Fusion parity). Routed by registry data (producesSketch), not op.type.
    if (OP_FEATURES[op.type].dialog) {
      setDialog({ type: op.type, editing: op });
      return;
    }
    const sketchId = opDefinition(op).dependencies(op).producesSketch;
    if (sketchId) useSessionStore.getState().enterSketch(sketchId);
  }, []);
  const closeDialog = useCallback(() => {
    setDialog(null);
  }, []);

  const toggleSuppress = useCallback((op: TimelineOp) => {
    commandBus.dispatch({
      type: 'SetOpSuppressed',
      payload: { opId: op.id, suppressed: !op.suppressed },
    });
  }, []);

  const remove = useCallback((op: TimelineOp) => {
    const doc = useDocumentStore.getState().document;
    const dependents = dependentOps(doc, op.id);
    if (dependents.length > 0) {
      const names = dependents.map((d) => d.name).join(', ');
      // F1: deleting a producer would break consumers — confirm the cascade.
      if (!window.confirm(`Delete "${op.name}"? Dependent operations: ${names}`)) return;
    }
    commandBus.dispatch({ type: 'DeleteOp', payload: { opId: op.id } });
  }, []);

  const rename = useCallback((op: TimelineOp) => {
    const name = window.prompt('Rename operation', op.name);
    if (name !== null && name.trim() !== '') {
      commandBus.dispatch({ type: 'RenameOp', payload: { opId: op.id, name: name.trim() } });
    }
  }, []);

  const setRollback = useCallback((index: number) => {
    commandBus.dispatch({ type: 'SetRollback', payload: { index } });
  }, []);

  return {
    ops: document.ops,
    rollbackIndex: document.rollbackIndex,
    statuses,
    dialog,
    openCreate,
    openEdit,
    closeDialog,
    toggleSuppress,
    remove,
    rename,
    setRollback,
  };
}
