import { describe, it, expect, beforeEach } from 'vitest';
import { keyIdFor } from '../../src/app/features/licensing/seatClient';
import { useEntitlementStore } from '../../src/app/store/entitlementStore';
import { UNIVERSAL_TEST_KEY } from '../../src/app/features/licensing/verify';

/**
 * Seat concurrency (ADR-0129). The seat client hashes the key to an opaque id
 * (raw key never sent), and the entitlement store withholds Pro while another
 * device holds the seat WITHOUT discarding the license, so the seat can be
 * reclaimed. Seat enforcement itself is off in tests (no VITE_LICENSE_SEAT_URL),
 * so no network is involved here.
 */
describe('license seat', () => {
  beforeEach(() => {
    useEntitlementStore.getState().deactivate();
  });

  it('keyIdFor is stable per key and differs across keys', async () => {
    const a1 = await keyIdFor('KEY-AAA');
    const a2 = await keyIdFor('  KEY-AAA  '); // trimmed → same id
    const b = await keyIdFor('KEY-BBB');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
  });

  it('seatBlocked withholds Pro but keeps the license, and lifts on unblock', async () => {
    const res = await useEntitlementStore.getState().activate(UNIVERSAL_TEST_KEY);
    expect(res.ok).toBe(true);
    expect(useEntitlementStore.getState().tier).toBe('pro');

    useEntitlementStore.getState().setSeatBlocked(true);
    let s = useEntitlementStore.getState();
    expect(s.seatBlocked).toBe(true);
    expect(s.tier).toBe('free'); // Pro withheld while another device holds the seat
    expect(s.entitlements.isPro).toBe(false);
    expect(s.license).not.toBeNull(); // …but the license is retained for reclaim

    useEntitlementStore.getState().setSeatBlocked(false);
    s = useEntitlementStore.getState();
    expect(s.seatBlocked).toBe(false);
    expect(s.tier).toBe('pro');
    expect(s.entitlements.isPro).toBe(true);
  });

  it('setSeatBlocked is inert without a license', () => {
    useEntitlementStore.getState().setSeatBlocked(true);
    const s = useEntitlementStore.getState();
    expect(s.tier).toBe('free');
    expect(s.license).toBeNull();
  });
});
