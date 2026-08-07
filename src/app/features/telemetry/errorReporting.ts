/**
 * Opt-in crash reporting (M12). Dependency-free and static-host safe: no SDK is
 * bundled and nothing runs unless a Sentry DSN is configured at build time via
 * `VITE_SENTRY_DSN`. Even then the user can opt out (a localStorage flag), and
 * every payload is PII-scrubbed — no design data, no user text, file paths
 * reduced to basenames. Reports go to Sentry's stateless store endpoint over a
 * single HTTPS POST; NomaDim itself never gains a runtime backend.
 */

const OPT_OUT_KEY = 'nomadim.errorReporting';
const MAX_MESSAGE_LEN = 500;

interface Dsn {
  readonly host: string;
  readonly projectId: string;
  readonly publicKey: string;
}

/** Parse a Sentry DSN (`https://<key>@<host>/<projectId>`). Returns null if malformed. */
function parseDsn(raw: string): Dsn | null {
  try {
    const url = new URL(raw);
    const projectId = url.pathname.replace(/^\//, '');
    if (!url.username || !url.host || !projectId) return null;
    return { host: url.host, projectId, publicKey: url.username };
  } catch {
    return null;
  }
}

/**
 * The user has opted IN iff the flag is explicitly 'on'. Default: OFF — GDPR
 * treats crash telemetry as non-essential, so it requires prior consent (ADR-0128),
 * never runs until the user turns it on in Settings.
 */
function optedIn(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === 'on';
  } catch {
    return false;
  }
}

/** True when a valid DSN was configured at build time — i.e. reporting can exist at all. */
export function isErrorReportingAvailable(): boolean {
  const raw = import.meta.env.VITE_SENTRY_DSN;
  return raw !== undefined && raw !== '' && parseDsn(raw) !== null;
}

/** Current effective state: available AND the user explicitly opted in. */
export function isErrorReportingEnabled(): boolean {
  return isErrorReportingAvailable() && optedIn();
}

/** Persist the user's crash-reporting preference. */
export function setErrorReporting(enabled: boolean): void {
  try {
    window.localStorage.setItem(OPT_OUT_KEY, enabled ? 'on' : 'off');
  } catch {
    /* storage disabled — preference is session-only, nothing to persist */
  }
}

/** Strip everything but the basename from a stack/file reference, dropping query strings. */
function scrubStack(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  return stack
    .split('\n')
    .slice(0, 20)
    .map((line) => line.replace(/(?:[a-z]+:\/\/[^\s)]*\/|\/[^\s)]*\/)([^\s/)?]+)/gi, '$1'))
    .join('\n');
}

function buildPayload(error: Error): string {
  return JSON.stringify({
    platform: 'javascript',
    level: 'error',
    exception: {
      values: [
        {
          type: error.name,
          value: error.message.slice(0, MAX_MESSAGE_LEN),
          stacktrace: { frames: [] },
        },
      ],
    },
    // A scrubbed stack goes in extra (not user-facing content), never breadcrumbs.
    extra: { stack: scrubStack(error.stack) },
  });
}

function report(dsn: Dsn, error: Error): void {
  const endpoint = `https://${dsn.host}/api/${dsn.projectId}/store/?sentry_key=${dsn.publicKey}&sentry_version=7`;
  try {
    void fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: buildPayload(error),
    }).catch(() => {
      /* reporting is best-effort — a failed report must never surface to the user */
    });
  } catch {
    /* fetch unavailable or blocked — swallow */
  }
}

/**
 * Install global crash reporting. No-op unless a DSN is configured AND the user
 * has explicitly opted in (GDPR consent, ADR-0128). Safe to call once at startup.
 */
export function initErrorReporting(): void {
  const raw = import.meta.env.VITE_SENTRY_DSN;
  if (raw === undefined || raw === '' || !optedIn()) return;
  const dsn = parseDsn(raw);
  if (dsn === null) return;

  window.addEventListener('error', (event) => {
    if (event.error instanceof Error) report(dsn, event.error);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    if (reason instanceof Error) report(dsn, reason);
  });
}
