import { type Result, ok, err } from '../../../core';
import { verifyLicense } from './verify';
import {
  DAY_MS,
  GRACE_DAYS,
  LICENSE_PUBLIC_KEY_B64,
  REFRESH_BEFORE_DAYS,
  type LicenseError,
  type LicensePayload,
} from './license';

/**
 * Account-lease evaluation (M13, ADR-0123): the offline decision layer on top
 * of the raw signature check. It verifies the token entirely offline (Ed25519,
 * via `verifyLicense`) and then applies the two account-only rules that the pure
 * signature check leaves out:
 *
 *  - **Device binding** — a lease with a `deviceId` unlocks Pro ONLY on the
 *    matching device, so a copied token is inert elsewhere. Legacy keys and
 *    GYP$Y carry no `deviceId` and stay device-unlimited.
 *  - **Offline grace** — a lapsed lease keeps Pro for `GRACE_DAYS` past
 *    `expiresAt`, so being offline at renewal time never locks you out; past
 *    grace it falls back to free. `needsRefresh` flags when the app should try a
 *    silent online renewal (within `REFRESH_BEFORE_DAYS` of expiry, or in grace).
 *
 * No network here — renewal is the account layer's job; this stays pure and
 * fails closed.
 */

export interface LeaseStatus {
  readonly payload: LicensePayload;
  /** True while the lease is inside its grace window (past expiry, still Pro). */
  readonly inGrace: boolean;
  /** The app should attempt a silent online renewal (approaching/after expiry). */
  readonly needsRefresh: boolean;
}

/** Evaluate a token for THIS device at time `now`. Ok ⇒ Pro; err ⇒ stay free. */
export async function evaluateLicense(
  token: string,
  deviceId: string,
  now: number = Date.now(),
  publicKeyB64: string = LICENSE_PUBLIC_KEY_B64
): Promise<Result<LeaseStatus, LicenseError>> {
  // Verify signature + product offline, but let US own expiry (grace window).
  const verified = await verifyLicense(token, publicKeyB64, { ignoreExpiry: true });
  if (!verified.ok) return verified;
  const payload = verified.value;

  // Device binding: a bound lease is inert on a different device.
  if (payload.deviceId !== undefined && payload.deviceId !== deviceId) {
    return err({ kind: 'badDevice' });
  }

  // Perpetual (legacy key / GYP$Y): always Pro, never needs refresh.
  if (payload.expiresAt === undefined) {
    return ok({ payload, inGrace: false, needsRefresh: false });
  }

  const expiry = Date.parse(payload.expiresAt);
  if (Number.isNaN(expiry)) return err({ kind: 'malformed' });
  const graceEnd = expiry + GRACE_DAYS * DAY_MS;
  if (now > graceEnd) return err({ kind: 'expired' });

  const inGrace = now > expiry;
  const needsRefresh = now >= expiry - REFRESH_BEFORE_DAYS * DAY_MS;
  return ok({ payload, inGrace, needsRefresh });
}
