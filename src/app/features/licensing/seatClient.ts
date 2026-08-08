import { SEAT_SERVICE_URL, isSeatEnforced } from './seatConfig';

/**
 * Thin client for the license-seat service (ADR-0129). Enforces "one active
 * device per key at a time" via a claim + heartbeat + release protocol. The RAW
 * key never leaves the browser — we send only a SHA-256 hash of it (`keyId`),
 * so the server can referee concurrency without ever holding a usable key.
 */

export type SeatOutcome =
  | { readonly kind: 'granted'; readonly until: number }
  | { readonly kind: 'inUse'; readonly until: number }
  | { readonly kind: 'error' };

/** Opaque per-key id = base64url(SHA-256(token)); stable for a given key. */
export async function keyIdFor(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.trim()));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function post(path: string, keyId: string, deviceId: string): Promise<SeatOutcome> {
  if (!isSeatEnforced) return { kind: 'granted', until: 0 };
  try {
    const res = await fetch(`${SEAT_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyId, deviceId }),
    });
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { until?: number };
      return { kind: 'inUse', until: typeof body.until === 'number' ? body.until : 0 };
    }
    if (!res.ok) return { kind: 'error' };
    const body = (await res.json()) as { until?: number };
    return { kind: 'granted', until: typeof body.until === 'number' ? body.until : 0 };
  } catch {
    // Network failure → 'error'; the caller applies an offline grace rather than
    // locking a legitimate user out on a transient blip.
    return { kind: 'error' };
  }
}

/** Claim the seat for this device (at Pro activation / startup). */
export function claimSeat(keyId: string, deviceId: string): Promise<SeatOutcome> {
  return post('/session/claim', keyId, deviceId);
}

/** Refresh the seat while Pro is active (periodic). Same semantics as claim. */
export function heartbeatSeat(keyId: string, deviceId: string): Promise<SeatOutcome> {
  return post('/session/heartbeat', keyId, deviceId);
}

/** Release the seat (tab close / sign-out) so another device can take it promptly. */
export function releaseSeat(keyId: string, deviceId: string): void {
  if (!isSeatEnforced) return;
  const url = `${SEAT_SERVICE_URL}/session/release`;
  const payload = JSON.stringify({ keyId, deviceId });
  try {
    // sendBeacon survives page unload; fall back to a keepalive fetch.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      return;
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
    });
  } catch {
    /* best-effort; the server TTL will reclaim the seat anyway */
  }
}
