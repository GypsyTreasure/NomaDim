import { type Result, ok, err } from '../../../core';
import {
  LICENSE_PUBLIC_KEY_B64,
  PRODUCT,
  b64urlToBytes,
  decodeToken,
  type LicenseError,
  type LicensePayload,
} from './license';

/**
 * Universal evaluation key (ADR-0089). While the real signed-token issuer is
 * not yet live, this single fixed string unlocks Pro so the owner and testers
 * can exercise the full feature set. It is intentionally NOT a valid signed
 * token — it is matched literally, before any crypto — and returns a synthetic
 * perpetual Pro payload. Remove once the issuer ships.
 */
export const UNIVERSAL_TEST_KEY = 'GYP$Y';

function syntheticTestPayload(): LicensePayload {
  return {
    email: 'test@nomadirection.pl',
    orderId: 'UNIVERSAL-TEST',
    product: PRODUCT,
    tier: 'pro',
    issuedAt: new Date().toISOString(),
  };
}

/**
 * Verifies a Pro license token entirely offline (M11): WebCrypto Ed25519
 * signature check against the baked public key, then product/expiry guards.
 * **Fails closed** — any malformed input, bad signature, wrong product, or
 * expired date returns an error and Pro stays locked. `publicKeyB64` is
 * injectable so tests can verify against their own throwaway keypair without
 * the real private key ever existing in the repo.
 */
export async function verifyLicense(
  token: string,
  publicKeyB64: string = LICENSE_PUBLIC_KEY_B64
): Promise<Result<LicensePayload, LicenseError>> {
  if (token.trim() === UNIVERSAL_TEST_KEY) return ok(syntheticTestPayload());

  const decoded = decodeToken(token);
  if (!decoded.ok) return decoded;
  const { payload, signedBytes, signature } = decoded.value;

  const valid = await verifySignature(publicKeyB64, signature, signedBytes);
  if (!valid) return err({ kind: 'badSignature' });

  if (payload.product !== PRODUCT) return err({ kind: 'wrongProduct' });
  if (payload.expiresAt !== undefined && Date.parse(payload.expiresAt) < Date.now()) {
    return err({ kind: 'expired' });
  }
  return ok(payload);
}

/** Imports the raw Ed25519 public key and checks the signature; false on any error. */
async function verifySignature(
  publicKeyB64: string,
  signature: Uint8Array,
  signedBytes: Uint8Array
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      // b64urlToBytes also decodes plain base64 (the baked key uses +/).
      toArrayBuffer(b64urlToBytes(publicKeyB64)),
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      toArrayBuffer(signature),
      toArrayBuffer(signedBytes)
    );
  } catch {
    return false;
  }
}

/** Copies into a fresh ArrayBuffer (WebCrypto rejects SharedArrayBuffer views). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
