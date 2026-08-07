/**
 * Per-device identity (M13, ADR-0123). An account lease is bound to a device via
 * this id, so a copied token is inert on another machine. The id is a random
 * UUID minted once and persisted in localStorage — NOT a hardware fingerprint
 * (privacy + no fingerprinting libraries), so it's per-browser-profile. Losing
 * it (cleared storage) just means the next sign-in re-leases a "new" device,
 * which the account's device cap governs.
 */

const DEVICE_ID_KEY = 'nomadim.deviceId';

/** Stable device id for this browser profile — created on first use. */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = mintId();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // Storage disabled (private mode): a per-session id — Pro won't persist,
    // which is the same failure mode as the license token itself.
    return mintId();
  }
}

function mintId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without randomUUID.
  return `dev-${Math.random().toString(36).slice(2)}-${String(Date.now())}`;
}

/** Best-effort human-readable device name for the account's device list. */
export function getDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua)
      ? 'macOS'
      : /Android/i.test(ua)
        ? 'Android'
        : /iPhone|iPad|iPod/i.test(ua)
          ? 'iOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'device';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Chrome\//i.test(ua)
      ? 'Chrome'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : 'browser';
  return `${browser} on ${os}`;
}
