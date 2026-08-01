import { describe, expect, it } from 'vitest';
import { CREATABLE_OP_TYPES } from '../../src/app/features/timeline/registry';
import { groupedOpTypes } from '../../src/app/features/timeline/createOpGroups';

/**
 * The modeling ribbon (#5c) splits every creatable op into a thematic group.
 * This guards completeness: adding a creatable op without placing it in a
 * ribbon group (or listing an op twice) fails here — the same registry-
 * completeness discipline as the op registry itself.
 */
describe('modeling ribbon op groups (#5c)', () => {
  it('covers exactly the creatable op types, once each', () => {
    expect([...groupedOpTypes].sort()).toEqual([...CREATABLE_OP_TYPES].sort());
    expect(new Set(groupedOpTypes).size).toBe(groupedOpTypes.length);
  });
});
