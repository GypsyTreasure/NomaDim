/**
 * Account service configuration (M13, ADR-0123). The whole accounts feature is
 * gated on this single URL: when it's unset (the current static deploy) the app
 * shows NO accounts UI and behaves exactly like M11 — paste a key / GYP$Y,
 * fully offline. When the owner deploys the Cloudflare Worker and sets
 * `VITE_ACCOUNT_SERVICE_URL` at build time, Sign in with Google/GitHub appears.
 *
 * This is the ONLY place the app knows a backend exists; it is contacted solely
 * at sign-in / lease-renew, never at runtime, so prime directive #7 (no backend
 * at runtime) holds.
 */

const RAW = import.meta.env.VITE_ACCOUNT_SERVICE_URL;

/** Service base URL with any trailing slash trimmed; '' when unconfigured. */
export const ACCOUNT_SERVICE_URL = (RAW ?? '').replace(/\/+$/, '');

/** True once the owner has wired a real account service at build time. */
export const isAccountServiceConfigured = ACCOUNT_SERVICE_URL.length > 0;
