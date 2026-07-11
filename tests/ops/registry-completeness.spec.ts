import { describe, expect, it } from 'vitest';
import { OP_DEFINITIONS, OP_TYPES, type OpType } from '../../src/document';
import { OP_EXECUTORS } from '../../src/kernel-worker/executors/registry';
import { OP_PLAN_RESOLVERS } from '../../src/services';
import { OP_FEATURES } from '../../src/app/features/timeline/registry';

/**
 * Registry completeness (ARCHITECTURE §7, R9): every OpType must appear in
 * ALL registries — document codec/deps, worker executor, main-thread plan
 * resolver, and app feature — so no operation can be half-implemented. A new
 * OpType that forgets any registry fails here rather than at runtime.
 */

const sorted = (types: readonly OpType[]): OpType[] => [...types].sort();

describe('op registry completeness', () => {
  const expected = sorted(OP_TYPES);

  it('has a non-empty canonical OpType list', () => {
    expect(expected.length).toBeGreaterThan(0);
  });

  it('document OP_DEFINITIONS covers every OpType, keyed consistently', () => {
    expect(sorted(Object.keys(OP_DEFINITIONS) as OpType[])).toEqual(expected);
    for (const type of OP_TYPES) expect(OP_DEFINITIONS[type].type).toBe(type);
  });

  it('worker OP_EXECUTORS covers every OpType', () => {
    expect(sorted(Object.keys(OP_EXECUTORS) as OpType[])).toEqual(expected);
  });

  it('services OP_PLAN_RESOLVERS covers every OpType', () => {
    expect(sorted(Object.keys(OP_PLAN_RESOLVERS) as OpType[])).toEqual(expected);
  });

  it('app OP_FEATURES covers every OpType', () => {
    expect(sorted(Object.keys(OP_FEATURES) as OpType[])).toEqual(expected);
    for (const type of OP_TYPES) expect(OP_FEATURES[type].type).toBe(type);
  });

  it('xml tags are unique per OpType (timeline codec relies on tag → type)', () => {
    const tags = OP_TYPES.map((type) => OP_DEFINITIONS[type].xmlTag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
