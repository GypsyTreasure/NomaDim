import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyTransaction,
  documentFromXml,
  documentToXml,
  emptyDocument,
  undo,
  type DocumentState,
} from '../../src/document';

/**
 * Project name (F7): document metadata mutated only through RenameDocument (one
 * write path), persisted on the `<nomadim>` root, undoable, and round-tripping
 * byte-safe (an unnamed document must not gain a `name` attribute).
 */
describe('project name', () => {
  it('round-trips a set name through the XML codec', () => {
    const doc: DocumentState = { ...emptyDocument(), name: 'My Bracket' };
    const parsed = documentFromXml(documentToXml(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.name).toBe('My Bracket');
  });

  it('omits the name attribute when blank and parses back to empty', () => {
    const xml = documentToXml(emptyDocument());
    expect(xml).not.toContain('name=');
    const parsed = documentFromXml(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.name).toBe('');
  });

  it('renames through the command + write path and is undoable', () => {
    const before = emptyDocument();
    const result = applyCommand(before, { type: 'RenameDocument', payload: { name: 'Widget' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.name).toBe('Widget');

    // Redo-apply is idempotent with the transaction; undo restores the old name.
    const forward = applyTransaction(before, result.value.transaction);
    expect(forward.name).toBe('Widget');
    const undone = undo(forward, { undoStack: [result.value.transaction], redoStack: [] });
    expect(undone?.state.name).toBe('');
  });
});
