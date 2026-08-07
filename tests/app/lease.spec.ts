import { describe, expect, it } from 'vitest';
import { evaluateLicense } from '../../src/app/features/licensing/lease';
import {
  DAY_MS,
  GRACE_DAYS,
  REFRESH_BEFORE_DAYS,
  bytesToB64url,
  decodeToken,
  type LicensePayload,
} from '../../src/app/features/licensing/license';

/**
 * M13 account leases: device-bound, offline-verified tokens with a grace
 * window. `evaluateLicense` verifies the Ed25519 signature offline and then
 * applies device binding + expiry-with-grace. Tests mint a throwaway keypair.
 */

async function makeKeypair(): Promise<{ priv: CryptoKey; pubB64: string }> {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { priv: kp.privateKey, pubB64: bytesToB64url(raw) };
}

async function signToken(priv: CryptoKey, payload: LicensePayload): Promise<string> {
  const seg = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, priv, new TextEncoder().encode(seg));
  return `${seg}.${bytesToB64url(new Uint8Array(sig))}`;
}

const DEVICE = 'device-abc';
const NOW = Date.parse('2026-06-01T00:00:00Z');

function lease(overrides: Partial<LicensePayload>): LicensePayload {
  return {
    email: 'buyer@example.com',
    orderId: 'acct:acc1',
    product: 'nomadim',
    tier: 'pro',
    issuedAt: '2026-05-01T00:00:00Z',
    accountId: 'acc1',
    deviceId: DEVICE,
    ...overrides,
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();

describe('license decode carries the M13 lease fields', () => {
  it('round-trips accountId / deviceId / deviceLabel', () => {
    const payload = lease({ deviceLabel: 'Chrome on macOS', expiresAt: iso(NOW) });
    const seg = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
    const decoded = decodeToken(`${seg}.AA`);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.payload.accountId).toBe('acc1');
      expect(decoded.value.payload.deviceId).toBe(DEVICE);
      expect(decoded.value.payload.deviceLabel).toBe('Chrome on macOS');
    }
  });
});

describe('evaluateLicense — device binding', () => {
  it('unlocks Pro on the matching device', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(priv, lease({ expiresAt: iso(NOW + 10 * DAY_MS) }));
    const res = await evaluateLicense(token, DEVICE, NOW, pubB64);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.inGrace).toBe(false);
  });

  it('rejects a lease copied to another device', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(priv, lease({ expiresAt: iso(NOW + 10 * DAY_MS) }));
    const res = await evaluateLicense(token, 'someone-elses-device', NOW, pubB64);
    expect(res).toEqual({ ok: false, error: { kind: 'badDevice' } });
  });
});

describe('evaluateLicense — grace window', () => {
  it('is active well before expiry and does not need refresh', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(priv, lease({ expiresAt: iso(NOW + 20 * DAY_MS) }));
    const res = await evaluateLicense(token, DEVICE, NOW, pubB64);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.needsRefresh).toBe(false);
  });

  it('flags needsRefresh within the refresh window (still active)', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(
      priv,
      lease({ expiresAt: iso(NOW + (REFRESH_BEFORE_DAYS - 1) * DAY_MS) })
    );
    const res = await evaluateLicense(token, DEVICE, NOW, pubB64);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.needsRefresh).toBe(true);
      expect(res.value.inGrace).toBe(false);
    }
  });

  it('keeps Pro during grace past expiry (offline safety) and flags refresh', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(priv, lease({ expiresAt: iso(NOW - 2 * DAY_MS) }));
    const res = await evaluateLicense(token, DEVICE, NOW, pubB64);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.inGrace).toBe(true);
      expect(res.value.needsRefresh).toBe(true);
    }
  });

  it('falls back to free once past the grace window', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(priv, lease({ expiresAt: iso(NOW - (GRACE_DAYS + 1) * DAY_MS) }));
    const res = await evaluateLicense(token, DEVICE, NOW, pubB64);
    expect(res).toEqual({ ok: false, error: { kind: 'expired' } });
  });
});

describe('evaluateLicense — legacy + eval key', () => {
  it('treats a perpetual key (no expiry, no device) as unlimited Pro', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(priv, {
      email: 'buyer@example.com',
      orderId: 'ORD-1',
      product: 'nomadim',
      tier: 'pro',
      issuedAt: '2026-01-01T00:00:00Z',
    });
    const res = await evaluateLicense(token, DEVICE, NOW, pubB64);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.needsRefresh).toBe(false);
  });

  it('GYP$Y still unlocks Pro (device-agnostic)', async () => {
    const res = await evaluateLicense('GYP$Y', DEVICE, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.payload.tier).toBe('pro');
  });
});
