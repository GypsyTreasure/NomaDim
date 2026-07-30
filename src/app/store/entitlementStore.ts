import { create } from 'zustand';
import { type Result, ok, err } from '../../core';
import { verifyLicense } from '../features/licensing/verify';
import type { LicenseError, LicensePayload, Tier } from '../features/licensing/license';

/**
 * Entitlement store (M11): free vs pro, driven by an offline-verified license.
 * The token persists in localStorage and is re-verified on load, so Pro works
 * fully offline across sessions with no network call. Fails closed — an absent,
 * malformed, tampered, or expired token leaves the app in the (fully usable)
 * free tier.
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
  /** Verify + apply a pasted token; persists on success. */
  readonly activate: (token: string) => Promise<Result<LicensePayload, LicenseError>>;
  /** Drop Pro and clear the stored token (back to free). */
  readonly deactivate: () => void;
  /** Re-verify the persisted token on startup (call once on mount). */
  readonly restore: () => void;
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

export const useEntitlementStore = create<EntitlementStore>((set) => ({
  tier: 'free',
  license: null,
  entitlements: entitlementsFor('free'),
  activate: async (token) => {
    const result = await verifyLicense(token);
    if (result.ok) {
      writeStoredToken(token);
      set({ tier: 'pro', license: result.value, entitlements: entitlementsFor('pro') });
      return ok(result.value);
    }
    return err(result.error);
  },
  deactivate: () => {
    writeStoredToken(null);
    set({ tier: 'free', license: null, entitlements: entitlementsFor('free') });
  },
  restore: () => {
    const token = readStoredToken();
    if (token === null) return;
    void verifyLicense(token).then((result) => {
      if (result.ok) {
        set({ tier: 'pro', license: result.value, entitlements: entitlementsFor('pro') });
      } else {
        writeStoredToken(null); // drop a tampered/expired token
      }
    });
  },
}));

/** Reactive entitlements selector for feature gating across the app. */
export function useEntitlement(): Entitlements {
  return useEntitlementStore((s) => s.entitlements);
}
