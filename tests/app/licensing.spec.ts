import { afterEach, describe, expect, it } from 'vitest';
import { verifyLicense } from '../../src/app/features/licensing/verify';
import { bytesToB64url, type LicensePayload } from '../../src/app/features/licensing/license';
import { useEntitlementStore } from '../../src/app/store/entitlementStore';

/**
 * M11 offline licensing: WebCrypto Ed25519 verification must accept a genuine
 * Pro token and fail closed on anything else. Tests mint a throwaway keypair
 * and verify against its public key — the real private key never exists here.
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

const basePayload: LicensePayload = {
  email: 'buyer@example.com',
  orderId: 'ORD-1',
  product: 'nomadim',
  tier: 'pro',
  issuedAt: '2026-01-01T00:00:00Z',
};

describe('verifyLicense', () => {
  it('accepts a genuine Pro token', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(priv, basePayload);
    const result = await verifyLicense(token, pubB64);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.email).toBe('buyer@example.com');
  });

  it('rejects a tampered payload (bad signature)', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(priv, basePayload);
    const [, sig] = token.split('.');
    const forged = bytesToB64url(
      new TextEncoder().encode(JSON.stringify({ ...basePayload, email: 'attacker@example.com' }))
    );
    const result = await verifyLicense(`${forged}.${sig ?? ''}`, pubB64);
    expect(result).toEqual({ ok: false, error: { kind: 'badSignature' } });
  });

  it('rejects a license signed by a different key', async () => {
    const a = await makeKeypair();
    const b = await makeKeypair();
    const token = await signToken(a.priv, basePayload);
    const result = await verifyLicense(token, b.pubB64);
    expect(result).toEqual({ ok: false, error: { kind: 'badSignature' } });
  });

  it('rejects the wrong product', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(priv, { ...basePayload, product: 'somethingelse' });
    const result = await verifyLicense(token, pubB64);
    expect(result).toEqual({ ok: false, error: { kind: 'wrongProduct' } });
  });

  it('rejects an expired license (fails closed)', async () => {
    const { priv, pubB64 } = await makeKeypair();
    const token = await signToken(priv, { ...basePayload, expiresAt: '2020-01-01T00:00:00Z' });
    const result = await verifyLicense(token, pubB64);
    expect(result).toEqual({ ok: false, error: { kind: 'expired' } });
  });

  it('rejects malformed input', async () => {
    expect((await verifyLicense('not-a-token')).ok).toBe(false);
    expect((await verifyLicense('')).ok).toBe(false);
  });
});

describe('entitlementStore', () => {
  afterEach(() => {
    useEntitlementStore.getState().deactivate();
  });

  it('defaults to a usable free tier (watermark on, no exact export)', () => {
    const e = useEntitlementStore.getState().entitlements;
    expect(e).toEqual({ tier: 'free', isPro: false, watermark: true, canExportExact: false });
  });

  it('activate() fails closed on an invalid token and stays free', async () => {
    const result = await useEntitlementStore.getState().activate('garbage.token');
    expect(result.ok).toBe(false);
    expect(useEntitlementStore.getState().tier).toBe('free');
  });
});
