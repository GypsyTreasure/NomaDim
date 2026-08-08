/**
 * License-seat service configuration (ADR-0129). Concurrency ("one active
 * session at a time") is impossible to enforce with a purely offline key, so it
 * is opt-in and gated on this single URL. Unset (the default static deploy) ⇒
 * a Pro key unlocks on every device with zero runtime network — exactly the
 * ADR-0125 offline model. Set ⇒ the app claims one seat per key at a time.
 *
 * Seat granularity is the DEVICE (the persisted `deviceId`), which every tab in
 * a browser profile shares — so multiple tabs on the same device all hold the
 * same seat, while a different device is blocked until the first releases or its
 * heartbeat lapses.
 */

const RAW = import.meta.env.VITE_LICENSE_SEAT_URL;

/** Seat service base URL with any trailing slash trimmed; '' when unconfigured. */
export const SEAT_SERVICE_URL = (RAW ?? '').replace(/\/+$/, '');

/** True once the owner has wired a seat service at build time (enables concurrency control). */
export const isSeatEnforced = SEAT_SERVICE_URL.length > 0;

/** Seat lease length; the server drops a seat this long after the last heartbeat. */
export const SEAT_TTL_MS = 120_000;
/** How often the holding device refreshes its seat while Pro is active. */
export const SEAT_HEARTBEAT_MS = 45_000;
