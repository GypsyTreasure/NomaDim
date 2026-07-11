import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, ok } from '../../src/core/result';

describe('Result', () => {
  it('ok() produces a success result', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it('err() produces a failure result', () => {
    const result = err('boom');
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error).toBe('boom');
    }
  });
});
