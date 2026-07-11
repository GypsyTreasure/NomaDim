import type { Result, ValidationError } from '../core';
import { ok } from '../core';
import {
  applyCommand,
  emptyHistory,
  pushTransaction,
  redo,
  undo,
  type Command,
  type DocumentState,
  type HistoryState,
} from '../document';

/**
 * The single write path (ARCHITECTURE §4): UI dispatches Commands here;
 * validation + Transaction application happen in document/; the store
 * updates through the injected host. Framework-free — app/store adapts
 * this to Zustand. Undo/redo re-emits through the same change notification
 * as the original transaction (R2: no second synchronization mechanism).
 */

export interface DocumentHost {
  getDocument(): DocumentState;
  setDocument(state: DocumentState): void;
}

type ChangeListener = (state: DocumentState) => void;

export class CommandBus {
  private history: HistoryState = emptyHistory;
  private readonly listeners = new Set<ChangeListener>();

  constructor(private readonly host: DocumentHost) {}

  dispatch(command: Command): Result<void, ValidationError> {
    const result = applyCommand(this.host.getDocument(), command);
    if (!result.ok) return result;
    this.history = pushTransaction(this.history, result.value.transaction);
    this.commit(result.value.state);
    return ok(undefined);
  }

  undo(): boolean {
    const result = undo(this.host.getDocument(), this.history);
    if (!result) return false;
    this.history = result.history;
    this.commit(result.state);
    return true;
  }

  redo(): boolean {
    const result = redo(this.host.getDocument(), this.history);
    if (!result) return false;
    this.history = result.history;
    this.commit(result.state);
    return true;
  }

  canUndo(): boolean {
    return this.history.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.history.redoStack.length > 0;
  }

  /** Change notifications — M3's dirty tracking/RegenScheduler subscribes here. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(state: DocumentState): void {
    this.host.setDocument(state);
    for (const listener of this.listeners) listener(state);
  }
}
