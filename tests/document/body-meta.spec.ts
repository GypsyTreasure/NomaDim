import { describe, expect, it } from 'vitest';
import type { BodyId } from '../../src/core/ids';
import {
  applyCommand,
  applyTransaction,
  DEFAULT_BODY_COLOR,
  emptyDocument,
  getBodyMeta,
  type Command,
  type DocumentState,
} from '../../src/document';

/**
 * Body metadata commands (F8): name/colour/visibility are lazily
 * materialized, undoable whole-list replacements. An unedited body reports
 * defaults; the inverse patch restores the prior list exactly.
 */

const bid = (id: string): BodyId => id as BodyId;

function apply(state: DocumentState, command: Command): DocumentState {
  const result = applyCommand(state, command);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.state;
}

describe('body metadata', () => {
  it('reports defaults for an unedited body', () => {
    const meta = getBodyMeta(emptyDocument(), bid('b1'));
    expect(meta).toEqual({ id: 'b1', name: 'b1', color: DEFAULT_BODY_COLOR, visible: true });
  });

  it('applies name / colour / visibility and materializes one entry', () => {
    let doc = emptyDocument();
    doc = apply(doc, { type: 'SetBodyName', payload: { bodyId: bid('b1'), name: 'Base' } });
    doc = apply(doc, { type: 'SetBodyColor', payload: { bodyId: bid('b1'), color: '#ff0000' } });
    doc = apply(doc, { type: 'SetBodyVisible', payload: { bodyId: bid('b1'), visible: false } });

    expect(doc.bodyMeta).toHaveLength(1);
    expect(getBodyMeta(doc, bid('b1'))).toEqual({
      id: 'b1',
      name: 'Base',
      color: '#ff0000',
      visible: false,
    });
  });

  it('is undoable via the inverse transaction patch', () => {
    const doc0 = emptyDocument();
    const result = applyCommand(doc0, {
      type: 'SetBodyName',
      payload: { bodyId: bid('b1'), name: 'Renamed' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Forward applies, inverse (undo) restores the empty list.
    const forward = applyTransaction(doc0, result.value.transaction);
    expect(getBodyMeta(forward, bid('b1')).name).toBe('Renamed');

    const patch = result.value.transaction.patches[0];
    expect(patch?.kind).toBe('replaceBodyMeta');
    if (patch?.kind === 'replaceBodyMeta') {
      expect(patch.before).toEqual([]);
    }
  });
});
