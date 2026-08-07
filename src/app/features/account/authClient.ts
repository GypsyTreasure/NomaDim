import { type Result, ok, err } from '../../../core';
import { ACCOUNT_SERVICE_URL, isAccountServiceConfigured } from './config';

/**
 * Thin client for the account/license service (M13, ADR-0123). Every call is
 * user-initiated (sign-in) or a background lease renewal — NEVER on the hot
 * path — so the app still runs fully offline. All functions fail loudly if the
 * service isn't configured, so callers must guard on `isAccountServiceConfigured`.
 *
 * OAuth uses a redirect flow: `beginOAuth` sends the browser to the Worker,
 * which runs Google/GitHub OAuth and redirects back to the app with an opaque
 * session token in the URL fragment (`#session=…`, never a query so it doesn't
 * hit logs). `completeOAuthFromUrl` picks it up on load.
 */

export type OAuthProvider = 'google' | 'github';

export interface AccountProfile {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl?: string;
  readonly provider: OAuthProvider;
  /** Whether this account has a paid entitlement (drives lease issuance). */
  readonly paid: boolean;
}

export interface DeviceInfo {
  readonly deviceId: string;
  readonly label: string;
  readonly lastSeen: string;
  readonly current: boolean;
}

export type AccountErrorKind = 'unconfigured' | 'network' | 'unauthorized' | 'notPaid' | 'server';
export interface AccountError {
  readonly kind: AccountErrorKind;
  readonly message?: string;
}

function requireConfigured(): Result<true, AccountError> {
  if (!isAccountServiceConfigured) return err({ kind: 'unconfigured' });
  return ok(true);
}

/** Redirect the browser into the provider's OAuth flow via the service. */
export function beginOAuth(provider: OAuthProvider, deviceId: string): void {
  if (!isAccountServiceConfigured) return;
  const returnTo = `${window.location.origin}${window.location.pathname}`;
  const url = new URL(`${ACCOUNT_SERVICE_URL}/auth/${provider}/start`);
  url.searchParams.set('return', returnTo);
  url.searchParams.set('device', deviceId);
  window.location.assign(url.toString());
}

/**
 * If we just came back from OAuth, extract the session token from the URL
 * fragment and strip it from the address bar. Returns the token or null.
 */
export function completeOAuthFromUrl(): string | null {
  if (typeof window === 'undefined' || !window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const session = params.get('session');
  if (!session) return null;
  // Remove the fragment so a reload / share doesn't carry the session.
  const clean = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, '', clean);
  return session;
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
