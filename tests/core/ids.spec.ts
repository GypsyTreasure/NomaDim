import { describe, expect, it } from 'vitest';
import { createId, type OpId } from '../../src/core/ids';

describe('createId', () => {
  it('generates an 8-character id', () => {
    const id = createId<OpId>(new Set());
    expect(id).toHaveLength(8);
  });

  it('avoids collisions with existing ids', () => {
    const existing = new Set(['aaaaaaaa']);
    const id = createId<OpId>(existing);
    expect(existing.has(id)).toBe(false);
  });
});
