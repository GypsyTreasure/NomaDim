import { type Result, ok, err } from '../../../core';
import { ACCOUNT_SERVICE_URL, isAccountServiceConfigured } from './config';

/**
 * Thin client for the account/license service (M13, ADR-0124). Every call is
 * user-initiated (register / log in) or a background lease renewal — NEVER on
 * the hot path — so the app still runs fully offline. All functions fail loudly
 * if the service isn't configured, so callers must guard on
 * `isAccountServiceConfigured`.
 *
 * Auth is a simple internal email + password scheme: the Worker hashes the
 * password (PBKDF2) and returns an opaque bearer session token, which the app
 * treats as opaque and stores locally. No third-party providers.
 */

export interface AccountProfile {
  readonly id: string;
  readonly email: string;
  /** Whether this account has a paid entitlement (drives lease issuance). */
  readonly paid: boolean;
}

export interface DeviceInfo {
  readonly deviceId: string;
  readonly label: string;
  readonly lastSeen: string;
  readonly current: boolean;
}

export type AccountErrorKind =
  | 'unconfigured'
  | 'network'
  | 'unauthorized'
  | 'notPaid'
  | 'emailTaken'
  | 'badCredentials'
  | 'invalidInput'
  | 'server';
export interface AccountError {
  readonly kind: AccountErrorKind;
  readonly message?: string;
}

function requireConfigured(): Result<true, AccountError> {
  if (!isAccountServiceConfigured) return err({ kind: 'unconfigured' });
  return ok(true);
}

/** Map an auth response status to an AccountError kind (register / login). */
function authErrorFor(status: number): AccountError {
  if (status === 401) return { kind: 'badCredentials' };
  if (status === 409) return { kind: 'emailTaken' };
  if (status === 400 || status === 422) return { kind: 'invalidInput' };
  return { kind: 'server', message: `HTTP ${String(status)}` };
}

async function postAuth(
  path: string,
  email: string,
  password: string
): Promise<Result<{ session: string; account: AccountProfile }, AccountError>> {
  const guard = requireConfigured();
  if (!guard.ok) return guard;
  try {
    const res = await fetch(`${ACCOUNT_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return err(authErrorFor(res.status));
    const body = (await res.json()) as { session: string; account: AccountProfile };
    return ok(body);
  } catch (e) {
    return err({ kind: 'network', message: e instanceof Error ? e.message : undefined });
  }
}

/** Create a new account with email + password. */
export function register(
  email: string,
  password: string
): Promise<Result<{ session: string; account: AccountProfile }, AccountError>> {
  return postAuth('/auth/register', email, password);
}

/** Log in to an existing account with email + password. */
export function login(
  email: string,
  password: string
): Promise<Result<{ session: string; account: AccountProfile }, AccountError>> {
  return postAuth('/auth/login', email, password);
}

async function authedJson<T>(
  path: string,
  session: string,
  init?: RequestInit
): Promise<Result<T, AccountError>> {
  const guard = requireConfigured();
  if (!guard.ok) return guard;
  try {
    const res = await fetch(`${ACCOUNT_SERVICE_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session}`,
      },
    });
    if (res.status === 401) return err({ kind: 'unauthorized' });
    if (res.status === 402) return err({ kind: 'notPaid' });
    if (!res.ok) return err({ kind: 'server', message: `HTTP ${String(res.status)}` });
    return ok((await res.json()) as T);
  } catch (e) {
    return err({ kind: 'network', message: e instanceof Error ? e.message : undefined });
  }
}

/** The signed-in account's profile. */
export function fetchAccount(session: string): Promise<Result<AccountProfile, AccountError>> {
  return authedJson<AccountProfile>('/account', session);
}

/**
 * Ask the service to issue a fresh device-bound Pro lease (~30 days). Returns
 * the signed token string (verified offline by the app). `notPaid` when the
 * account has no entitlement; the app then stays free.
 */
export async function requestLease(
  session: string,
  deviceId: string,
  deviceLabel: string
): Promise<Result<string, AccountError>> {
  const res = await authedJson<{ token: string }>('/license/lease', session, {
    method: 'POST',
    body: JSON.stringify({ deviceId, deviceLabel }),
  });
  return res.ok ? ok(res.value.token) : err(res.error);
}

/** Devices currently leased on this account (for the manage-devices list). */
export function listDevices(session: string): Promise<Result<DeviceInfo[], AccountError>> {
  return authedJson<DeviceInfo[]>('/devices', session);
}

/** Revoke a device's lease (frees a device slot; that device drops to free). */
export function revokeDevice(
  session: string,
  deviceId: string
): Promise<Result<{ ok: true }, AccountError>> {
  return authedJson<{ ok: true }>(`/devices/${encodeURIComponent(deviceId)}`, session, {
    method: 'DELETE',
  });
}

/** Invalidate the session server-side (best-effort). */
export async function signOutRemote(session: string): Promise<void> {
  if (!isAccountServiceConfigured) return;
  try {
    await fetch(`${ACCOUNT_SERVICE_URL}/auth/signout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session}` },
    });
  } catch {
    /* best-effort; local sign-out still proceeds */
  }
}
