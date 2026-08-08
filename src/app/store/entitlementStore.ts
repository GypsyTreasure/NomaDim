import { create } from 'zustand';
import { type Result, ok, err } from '../../core';
import { evaluateLicense } from '../features/licensing/lease';
import { getDeviceId } from '../features/licensing/device';
import type { LicenseError, LicensePayload, Tier } from '../features/licensing/license';

/**
 * Entitlement store (M11 + M13): free vs pro, driven by an offline-verified
 * license. The token persists in localStorage and is re-evaluated on load, so
 * Pro works fully offline across sessions with no network call. Fails closed —
 * an absent, malformed, tampered, expired-past-grace, or wrong-device token
 * leaves the app in the (fully usable) free tier. Account leases (M13) add
 * device binding + an offline grace window via `evaluateLicense`; the actual
 * online renewal is orchestrated by the account layer, not here.
 */

const STORAGE_KEY = 'nomadim.license';

/** Per-tier capabilities consumed across the app (export gating, watermark). */
export interface Entitlements {
  readonly tier: Tier;
  readonly isPro: boolean;
  /** Free STL exports carry a watermark; Pro exports are clean. */
  readonly watermark: boolean;
  /** Exact formats (STEP/3MF) are Pro-only; STL is always available. */
  readonly canExportExact: boolean;
}

interface EntitlementStore {
  readonly tier: Tier;
  readonly license: LicensePayload | null;
  readonly entitlements: Entitlements;
  /**
   * Seat concurrency (ADR-0129): true when a valid Pro license is held but the
   * one active seat for this key is currently taken by ANOTHER device. Pro is
   * withheld (effective tier free) while blocked, but the license + token are
   * kept so the seat manager can reclaim it when the other device releases.
   */
  readonly seatBlocked: boolean;
  /** Verify + apply a pasted token; persists on success. */
  readonly activate: (token: string) => Promise<Result<LicensePayload, LicenseError>>;
  /** Drop Pro and clear the stored token (back to free). */
  readonly deactivate: () => void;
  /** Re-verify the persisted token on startup (call once on mount). */
  readonly restore: () => void;
  /** Seat manager hook: withhold / restore Pro based on the active-seat check. */
  readonly setSeatBlocked: (blocked: boolean) => void;
}

function entitlementsFor(tier: Tier): Entitlements {
  const isPro = tier === 'pro';
  return { tier, isPro, watermark: !isPro, canExportExact: isPro };
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* private-mode / storage-disabled — Pro just won't persist */
  }
}

export const useEntitlementStore = create<EntitlementStore>((set, get) => ({
  tier: 'free',
  license: null,
  entitlements: entitlementsFor('free'),
  seatBlocked: false,
  activate: async (token) => {
    const result = await evaluateLicense(token, getDeviceId());
    if (result.ok) {
      writeStoredToken(token);
      // A fresh activation re-opens the seat question; the manager (if seat
      // enforcement is configured) will claim and may set seatBlocked.
      set({
        tier: 'pro',
        license: result.value.payload,
        entitlements: entitlementsFor('pro'),
        seatBlocked: false,
      });
      return ok(result.value.payload);
    }
    return err(result.error);
  },
  deactivate: () => {
    writeStoredToken(null);
    set({
      tier: 'free',
      license: null,
      entitlements: entitlementsFor('free'),
      seatBlocked: false,
    });
  },
  restore: () => {
    const token = readStoredToken();
    if (token === null) return;
    void evaluateLicense(token, getDeviceId()).then((result) => {
      if (result.ok) {
        set({ tier: 'pro', license: result.value.payload, entitlements: entitlementsFor('pro') });
      } else {
        // A tampered/wrong-device/expired-past-grace token drops to free. We keep
        // it in storage only when it's a recoverable lapse the account layer can
        // renew (expired within-service) — but device/signature failures are
        // permanent here, so clear them.
        if (result.error.kind !== 'expired') writeStoredToken(null);
      }
    });
  },
  setSeatBlocked: (blocked) => {
    const { license } = get();
    // No license → nothing to gate. With a license, blocked withholds Pro while
    // keeping the license so we can reclaim the seat later.
    const proTier: Tier = license !== null && !blocked ? 'pro' : 'free';
    set({ seatBlocked: blocked, tier: proTier, entitlements: entitlementsFor(proTier) });
  },
}));

/** Reactive entitlements selector for feature gating across the app. */
export function useEntitlement(): Entitlements {
  return useEntitlementStore((s) => s.entitlements);
}
