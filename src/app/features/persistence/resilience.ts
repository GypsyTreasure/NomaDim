/**
 * Crash-loop guard (ADR-0110). On a memory-starved phone the WebKit renderer can
 * be OOM-killed mid-session; iOS reloads the tab ("a problem repeatedly
 * occurred"), the app restores the document and rebuilds the same heavy model,
 * and OOMs again — a reload loop that ends on a blank page. This counts boots
 * that never reach a stable state and, after a couple of failures, lets the app
 * come up in "safe mode": the autosaved document is still restored (so nothing
 * is lost and the user can Save), but the multi-MB 3D kernel is NOT auto-booted,
 * breaking the loop until the user taps to load it.
 *
 * The counter lives in `sessionStorage` — it survives a reload of the same tab
 * (including a crash-reload) but resets when the tab is closed, so a fresh visit
 * always starts in normal mode.
 */

const ATTEMPTS_KEY = 'nomadim.boot.attempts';
/** Two prior boots that never stabilized → the third comes up in safe mode. */
const SAFE_MODE_THRESHOLD = 3;

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

let attempts: number | null = null;

/**
 * The number of boots this tab has made without a `markBootStable()` in between
 * (this one included). Recorded once per page load and cached, so repeated calls
 * (and React StrictMode's double render) never double-count.
 */
export function bootAttempts(): number {
  if (attempts !== null) return attempts;
  const store = sessionStore();
  const prior = Number(store?.getItem(ATTEMPTS_KEY) ?? '0');
  attempts = (Number.isFinite(prior) && prior > 0 ? prior : 0) + 1;
  try {
    store?.setItem(ATTEMPTS_KEY, String(attempts));
  } catch {
    // sessionStorage blocked — degrade to normal mode (attempts stays low).
  }
  return attempts;
}

/** The app reached a stable, non-crashing state — clear the crash counter. */
export function markBootStable(): void {
  attempts = 0;
  try {
    sessionStore()?.removeItem(ATTEMPTS_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** True when boots keep failing before stabilizing — i.e. a crash-reload loop. */
export function isSafeMode(): boolean {
  return bootAttempts() >= SAFE_MODE_THRESHOLD;
}
