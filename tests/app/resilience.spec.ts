import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Resilience from '../../src/app/features/persistence/resilience';

/**
 * Crash-loop guard (ADR-0110). The unit env is jsdom-free (node), so we install
 * a tiny in-memory `sessionStorage` on `window`. Each `freshModule()` clears the
 * module's cached count but keeps that storage — exactly how a tab reload
 * behaves — so the accumulation across "reloads" is what's under test.
 */
const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => {
    store.clear();
  },
  key: () => null,
  length: 0,
} as unknown as Storage;

beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window: { sessionStorage: Storage } }).window = {
    sessionStorage: storage,
  };
});

async function freshModule(): Promise<typeof Resilience> {
  vi.resetModules();
  return import('../../src/app/features/persistence/resilience');
}

describe('crash-loop guard', () => {
  it('a first boot is normal mode', async () => {
    const m = await freshModule();
    expect(m.bootAttempts()).toBe(1);
    expect(m.isSafeMode()).toBe(false);
  });

  it('caches within a load — repeated calls do not double-count', async () => {
    const m = await freshModule();
    expect(m.bootAttempts()).toBe(1);
    expect(m.bootAttempts()).toBe(1);
  });

  it('enters safe mode on the third consecutive unclean boot', async () => {
    let m = await freshModule();
    m.bootAttempts(); // load 1
    m = await freshModule();
    m.bootAttempts(); // load 2
    m = await freshModule(); // load 3
    expect(m.bootAttempts()).toBe(3);
    expect(m.isSafeMode()).toBe(true);
  });

  it('markBootStable clears the counter so the next boot is normal again', async () => {
    let m = await freshModule();
    m.bootAttempts();
    m = await freshModule();
    m.bootAttempts();
    m.markBootStable();
    m = await freshModule();
    expect(m.bootAttempts()).toBe(1);
    expect(m.isSafeMode()).toBe(false);
  });
});
