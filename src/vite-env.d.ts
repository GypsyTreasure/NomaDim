/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional cookieless-analytics script URL (M10) — landing only. */
  readonly VITE_ANALYTICS_SRC?: string;
  /** Optional analytics site domain passed to the snippet (M10). */
  readonly VITE_ANALYTICS_DOMAIN?: string;
  /**
   * Optional Sentry DSN (M12). When unset, error reporting is fully inert —
   * no handlers installed, no network. When set, uncaught errors are reported
   * PII-scrubbed unless the user has opted out. Off by default.
   */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
