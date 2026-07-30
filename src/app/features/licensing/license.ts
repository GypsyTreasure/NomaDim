import { type Result, ok, err } from '../../../core';

/**
 * Offline license model (M11, ADR-pending). A Pro license is a compact signed
 * token — `base64url(payloadJSON).base64url(ed25519Signature)` — verified
 * entirely in the browser against a baked-in **public** key (WebCrypto
 * Ed25519). No network, no backend at runtime; the private key lives only in
 * the out-of-bundle issuer (`tools/license-issuer/`) and is never shipped.
 */

export type Tier = 'free' | 'pro';

export interface LicensePayload {
  /** Buyer email (shown in the license status). */
  readonly email: string;
  /** Merchant-of-Record order id (support/audit). */
  readonly orderId: string;
  /** Product guard — must equal `PRODUCT`. */
  readonly product: string;
  readonly tier: 'pro';
  /** ISO issue timestamp. */
  readonly issuedAt: string;
  /** Optional ISO expiry; absent = perpetual (the default, one-time license). */
  readonly expiresAt?: string;
}

export type LicenseErrorKind = 'malformed' | 'badSignature' | 'wrongProduct' | 'expired';

export interface LicenseError {
  readonly kind: LicenseErrorKind;
}

/** This product's id — a license for anything else is rejected. */
export const PRODUCT = 'nomadim';

/**
 * Baked Ed25519 **public** key (base64, raw 32 bytes). PLACEHOLDER — the owner
 * replaces this with their own via `tools/license-issuer/keygen`; the matching
 * private key is generated offline and never committed. Rotating the key only
 * requires swapping this constant.
 */
export const LICENSE_PUBLIC_KEY_B64 = 'i8LMVVTvljM/BI+qZhKpqhG1agrLHT9/M9eQ/j1m684=';

/** base64url (no padding) → bytes. */
export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** bytes → base64url (no padding). */
export function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Splits a token into its payload segment (as bytes for signing) + signature. */
export function decodeToken(
  token: string
): Result<
  { payload: LicensePayload; signedBytes: Uint8Array; signature: Uint8Array },
  LicenseError
> {
  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return err({ kind: 'malformed' });
  try {
    const payloadJson = new TextDecoder().decode(b64urlToBytes(parts[0]));
    const raw = JSON.parse(payloadJson) as Record<string, unknown>;
    // Validate the untrusted JSON shape before trusting it as a LicensePayload.
    if (
      typeof raw.email !== 'string' ||
      typeof raw.orderId !== 'string' ||
      typeof raw.product !== 'string' ||
      typeof raw.issuedAt !== 'string' ||
      raw.tier !== 'pro' ||
      (raw.expiresAt !== undefined && typeof raw.expiresAt !== 'string')
    ) {
      return err({ kind: 'malformed' });
    }
    const payload: LicensePayload = {
      email: raw.email,
      orderId: raw.orderId,
      product: raw.product,
      tier: 'pro',
      issuedAt: raw.issuedAt,
      ...(raw.expiresAt === undefined ? {} : { expiresAt: raw.expiresAt }),
    };
    return ok({
      payload,
      signedBytes: new TextEncoder().encode(parts[0]),
      signature: b64urlToBytes(parts[1]),
    });
  } catch {
    return err({ kind: 'malformed' });
  }
}
