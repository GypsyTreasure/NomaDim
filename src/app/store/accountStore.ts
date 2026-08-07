import { create } from 'zustand';
import { getDeviceId, getDeviceLabel } from '../features/licensing/device';
import { isAccountServiceConfigured } from '../features/account/config';
import {
  beginOAuth,
  completeOAuthFromUrl,
  fetchAccount,
  listDevices,
  requestLease,
  revokeDevice,
  signOutRemote,
  type AccountError,
  type AccountProfile,
  type DeviceInfo,
  type OAuthProvider,
} from '../features/account/authClient';
import { useEntitlementStore } from './entitlementStore';

/**
 * Account session store (M13, ADR-0123). Holds the signed-in profile + opaque
 * session token, and orchestrates the ONLY network touchpoints: sign-in
 * (OAuth redirect), lease issuance/renewal, and device management. When the
 * account service isn't configured this store is inert and the app stays on the
 * pure offline paste-a-key path (M11). A leased Pro token flows into the
 * entitlement store via `activate`, which then verifies it offline like any key.
 */

const SESSION_KEY = 'nomadim.session';
const ACCOUNT_KEY = 'nomadim.account';

type Status = 'idle' | 'working' | 'error';

interface AccountState {
  readonly configured: boolean;
  readonly account: AccountProfile | null;
  readonly session: string | null;
  readonly status: Status;
  readonly error: AccountError | null;
  readonly devices: readonly DeviceInfo[];
  /** Begin OAuth (redirects away). */
  readonly signIn: (provider: OAuthProvider) => void;
  /** On load: pick up an OAuth return, else restore a persisted session; then lease. */
  readonly init: () => Promise<void>;
  /** Ask the service for a fresh device-bound lease and apply it (Pro). */
  readonly refreshLease: () => Promise<void>;
  readonly loadDevices: () => Promise<void>;
  readonly revoke: (deviceId: string) => Promise<void>;
  readonly signOut: () => void;
}

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage disabled */
  }
}

function readStoredAccount(): AccountProfile | null {
  const raw = readLS(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AccountProfile;
  } catch {
    return null;
  }
}

export const useAccountStore = create<AccountState>((set, get) => ({
  configured: isAccountServiceConfigured,
  account: readStoredAccount(),
  session: readLS(SESSION_KEY),
  status: 'idle',
  error: null,
  devices: [],

  signIn: (provider) => {
    if (!isAccountServiceConfigured) return;
    beginOAuth(provider, getDeviceId());
  },

  init: async () => {
    if (!isAccountServiceConfigured) return;
    // A fresh OAuth return carries the session in the URL fragment.
    const fromUrl = completeOAuthFromUrl();
    const session = fromUrl ?? get().session;
    if (!session) return;
    if (fromUrl) writeLS(SESSION_KEY, fromUrl);
    set({ session, status: 'working', error: null });

    const profile = await fetchAccount(session);
    if (!profile.ok) {
      // A dead/expired session: forget it, stay free (offline grace may still
      // carry a valid local lease until it lapses).
      if (profile.error.kind === 'unauthorized') {
        writeLS(SESSION_KEY, null);
        writeLS(ACCOUNT_KEY, null);
        set({ session: null, account: null, status: 'idle' });
        return;
      }
      set({ status: 'error', error: profile.error });
      return;
    }
    writeLS(ACCOUNT_KEY, JSON.stringify(profile.value));
    set({ account: profile.value, status: 'idle' });
    await get().refreshLease();
  },

  refreshLease: async () => {
    const { session } = get();
    if (!session || !isAccountServiceConfigured) return;
    const leased = await requestLease(session, getDeviceId(), getDeviceLabel());
    if (leased.ok) {
      // Verified offline + persisted by the entitlement store.
      await useEntitlementStore.getState().activate(leased.value);
    } else if (leased.error.kind === 'notPaid') {
      set({ error: leased.error });
    }
    // Other errors (network/server): keep any existing local lease (grace).
  },

  loadDevices: async () => {
    const { session } = get();
    if (!session) return;
    const res = await listDevices(session);
    if (res.ok) set({ devices: res.value });
  },

  revoke: async (deviceId) => {
    const { session } = get();
    if (!session) return;
    const res = await revokeDevice(session, deviceId);
    if (res.ok) {
      await get().loadDevices();
      // Revoking THIS device drops us to free immediately.
      if (deviceId === getDeviceId()) useEntitlementStore.getState().deactivate();
    }
  },

  signOut: () => {
    const { session } = get();
    if (session) void signOutRemote(session);
    writeLS(SESSION_KEY, null);
    writeLS(ACCOUNT_KEY, null);
    set({ session: null, account: null, devices: [], status: 'idle', error: null });
    // Local lease is account-bound: drop Pro on sign-out.
    useEntitlementStore.getState().deactivate();
  },
}));
