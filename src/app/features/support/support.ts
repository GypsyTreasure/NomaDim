/**
 * In-app support channel (M12). A single email address, kept here so both the
 * help dialog and any future surface share one source of truth. Static-host
 * safe: a `mailto:` link opens the user's own client — no backend, no form.
 */
export const SUPPORT_EMAIL = 'kacperdubiel@gmail.com';

/** Prebuilt `mailto:` with a subject, so reports arrive pre-tagged. */
export function supportMailto(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
