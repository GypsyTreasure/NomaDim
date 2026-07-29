import { describe, expect, it } from 'vitest';
import type { OpType } from '../../src/document';
import { opAvailability } from '../../src/app/features/timeline/opAvailability';

/**
 * M9 dead-button gating: every create-op is available only when its
 * precondition holds, and reports a reason when not. No op should render
 * enabled with an unmet precondition (Step-0 finding).
 */

const noModel = { hasSketch: false, bodyCount: 0 };
const sketchOnly = { hasSketch: true, bodyCount: 0 };
const oneBody = { hasSketch: true, bodyCount: 1 };
const twoBodies = { hasSketch: true, bodyCount: 2 };

describe('opAvailability', () => {
  it('Extrude/Revolve need a sketch', () => {
    for (const type of ['Extrude', 'Revolve'] as const) {
      expect(opAvailability(type, noModel)).toEqual({
        available: false,
        reasonKey: 'guard.needSketch',
      });
      expect(opAvailability(type, sketchOnly).available).toBe(true);
    }
  });

  it('body ops need at least one body', () => {
    const bodyOps: OpType[] = [
      'Fillet',
      'Chamfer',
      'CopyBody',
      'Mirror',
      'Pattern',
      'Shell',
      'Move',
    ];
    for (const type of bodyOps) {
      expect(opAvailability(type, sketchOnly)).toEqual({
        available: false,
        reasonKey: 'guard.needBody',
      });
      expect(opAvailability(type, oneBody).available).toBe(true);
    }
  });

  it('Combine needs two or more bodies', () => {
    expect(opAvailability('Combine', oneBody)).toEqual({
      available: false,
      reasonKey: 'guard.needTwoBodies',
    });
    expect(opAvailability('Combine', twoBodies).available).toBe(true);
  });

  it('no create-op is enabled with an empty document', () => {
    const creatable: OpType[] = [
      'Extrude',
      'Revolve',
      'Fillet',
      'Chamfer',
      'Combine',
      'CopyBody',
      'Mirror',
      'Pattern',
      'Shell',
      'Move',
    ];
    for (const type of creatable) {
      const a = opAvailability(type, noModel);
      expect(a.available).toBe(false);
      expect(a.reasonKey).toBeDefined();
    }
  });
});
