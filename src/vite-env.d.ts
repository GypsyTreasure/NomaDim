/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional cookieless-analytics script URL (M10) — landing only. */
  readonly VITE_ANALYTICS_SRC?: string;
  /** Optional analytics site domain passed to the snippet (M10). */
  readonly VITE_ANALYTICS_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
