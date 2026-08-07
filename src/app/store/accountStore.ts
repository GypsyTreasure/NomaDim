import { create } from 'zustand';
import { getDeviceId, getDeviceLabel } from '../features/licensing/device';
import { isAccountServiceConfigured } from '../features/account/config';
import {
  fetchAccount,
  listDevices,
  login as loginRemote,
  register as registerRemote,
  requestLease,
  revokeDevice,
  signOutRemote,
  type AccountError,
  type AccountProfile,
  type DeviceInfo,
} from '../features/account/authClient';
import { type Result, ok, err } from '../../core';
import { useEntitlementStore } from './entitlementStore';

/**
 * Account session store (M13, ADR-0124). Holds the signed-in profile + opaque
 * session token, and orchestrates the ONLY network touchpoints: register / log
 * in (email + password), lease issuance/renewal, and device management. When
 * the account service isn't configured this store is inert and the app stays on
 * the pure offline paste-a-key path (M11). A leased Pro token flows into the
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
  /** Create a new account (email + password), then lease. */
  readonly register: (email: string, password: string) => Promise<Result<true, AccountError>>;
  /** Log in to an existing account (email + password), then lease. */
  readonly login: (email: string, password: string) => Promise<Result<true, AccountError>>;
  /** On load: restore a persisted session and refresh the lease. */
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

export const useAccountStore = create<AccountState>((set, get) => {
  /** Apply a successful auth result: persist session + profile, then lease. */
  async function onAuthed(session: string, account: AccountProfile): Promise<void> {
    writeLS(SESSION_KEY, session);
    writeLS(ACCOUNT_KEY, JSON.stringify(account));
    set({ session, account, status: 'idle', error: null });
    await get().refreshLease();
  }

  async function authFlow(
    call: () => Promise<Result<{ session: string; account: AccountProfile }, AccountError>>
  ): Promise<Result<true, AccountError>> {
    if (!isAccountServiceConfigured) return err({ kind: 'unconfigured' });
    set({ status: 'working', error: null });
    const res = await call();
    if (!res.ok) {
      set({ status: 'error', error: res.error });
      return err(res.error);
    }
    await onAuthed(res.value.session, res.value.account);
    return ok(true);
  }

  return {
    configured: isAccountServiceConfigured,
    account: readStoredAccount(),
    session: readLS(SESSION_KEY),
    status: 'idle',
    error: null,
    devices: [],

    register: (email, password) => authFlow(() => registerRemote(email, password)),
    login: (email, password) => authFlow(() => loginRemote(email, password)),

    init: async () => {
      if (!isAccountServiceConfigured) return;
      const session = get().session;
      if (!session) return;
      set({ status: 'working', error: null });

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
  };
});
