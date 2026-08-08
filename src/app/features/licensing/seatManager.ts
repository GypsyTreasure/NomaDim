import { useEntitlementStore } from '../../store/entitlementStore';
import { getDeviceId } from './device';
import { isSeatEnforced, SEAT_HEARTBEAT_MS } from './seatConfig';
import { claimSeat, heartbeatSeat, keyIdFor, releaseSeat, type SeatOutcome } from './seatClient';
import { UNIVERSAL_TEST_KEY } from './verify';

/**
 * Seat manager (ADR-0129). When seat enforcement is configured, keeps exactly
 * one active seat per Pro key: it claims the seat when a Pro license appears,
 * heartbeats to hold it, and releases it when the license goes away or the tab
 * closes. If another DEVICE holds the seat the store is put in `seatBlocked`
 * (Pro withheld) until it frees up; a network error is treated as an offline
 * grace (never locks a legitimate user out). The test key (GYP$Y) is exempt.
 *
 * Inert unless `isSeatEnforced` — so the default offline build never touches the
 * network (prime directive #7).
 */

const TOKEN_KEY = 'nomadim.license';

let started = false;
let activeToken: string | null = null;
let activeKeyId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function applyOutcome(outcome: SeatOutcome): void {
  const { setSeatBlocked } = useEntitlementStore.getState();
  if (outcome.kind === 'inUse') setSeatBlocked(true);
  else if (outcome.kind === 'granted') setSeatBlocked(false);
  // 'error' → offline grace: leave the current state untouched.
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function begin(token: string): Promise<void> {
  const keyId = await keyIdFor(token);
  activeKeyId = keyId;
  const deviceId = getDeviceId();
  applyOutcome(await claimSeat(keyId, deviceId));
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    void heartbeatSeat(keyId, deviceId).then(applyOutcome);
  }, SEAT_HEARTBEAT_MS);
}

function teardown(): void {
  stopHeartbeat();
  if (activeKeyId !== null) {
    releaseSeat(activeKeyId, getDeviceId());
    activeKeyId = null;
  }
}

/** Reconcile the seat with the current license (idempotent; loop-safe). */
function sync(): void {
  const { license } = useEntitlementStore.getState();
  const token = readToken();
  const eligible = license !== null && token !== null && token.trim() !== UNIVERSAL_TEST_KEY;
  const next = eligible ? token : null;
  if (next === activeToken) return; // no change in the key under enforcement

  teardown();
  activeToken = next;
  if (next !== null) {
    void begin(next);
  } else {
    useEntitlementStore.getState().setSeatBlocked(false);
  }
}

/** Start the seat lifecycle. No-op unless seat enforcement is configured. */
export function startSeatManager(): void {
  if (started || !isSeatEnforced) return;
  started = true;
  useEntitlementStore.subscribe(sync);
  sync();
  if (typeof window !== 'undefined') {
    // Release promptly on tab close so another device can take the seat without
    // waiting for the TTL to lapse.
    window.addEventListener('pagehide', () => {
      if (activeKeyId !== null) releaseSeat(activeKeyId, getDeviceId());
    });
  }
}
